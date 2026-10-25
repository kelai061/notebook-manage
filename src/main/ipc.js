'use strict';
/**
 * ipc.js — Electron 主进程 IPC 授权通信中心
 * 
 * 核心机制：
 * 1. 严格实现 contracts.js 中定义的 19 个授权 IPC 通道。
 * 2. 统一出参契约：成功返回 { ok: true, ...data }，失败返回 { ok: false, error: err.message, code: err.code }。
 * 3. 深度打通本地原生能力：系统文件对话框 dialog.showOpenDialog、系统剪贴板 clipboard.writeText、外部目录联动 shell.openPath。
 * 4. 驱动多视图同步：在写操作完成时通过 notifyRenderer('workspace:changed', payload) 广播事件。
 */

const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, dialog, clipboard, shell, BrowserWindow } = require('electron');

const contracts = require('../shared/contracts');
const agentPrompt = require('./agentPrompt');
const updater = require('./updater');

/**
 * 注册主进程全部 19 个 IPC 通道处理器
 * @param {object} context 依赖注入对象 { getWorkspaceRoot, notifyRenderer, store, getStore }
 */
function register(context = {}) {
  const notifyRenderer = (channel, payload) => {
    if (typeof context.notifyRenderer === 'function') {
      if (channel === 'workspace:changed') {
        context.notifyRenderer(channel, { action: payload?.action, revision: getStoreInstance()?.peek().revision });
      } else {
        context.notifyRenderer(channel, payload);
      }
    }
  };

  function getStoreInstance() {
    if (typeof context.getStore === 'function') {
      return context.getStore();
    }
    return context.store;
  }

  // 包装统一响应
  const handleSafe = (channel, handler) => {
    ipcMain.handle(channel, async (_event, payload = {}) => {
      try {
        const store = getStoreInstance();
        if (!store) {
          throw new Error('工作区存储实例未初始化');
        }
        const data = await handler(payload, store);
        return { ok: true, ...data };
      } catch (err) {
        console.error(`[IPC Error] 通道 ${channel} 执行失败:`, err);
        return {
          ok: false,
          error: err.message || '内部服务异常',
          code: err.code || 'IPC_EXECUTION_ERROR',
          retryable:Boolean(err.retryable || err.code==='REVISION_CONFLICT'),
          currentRevision:err.currentRevision
        };
      }
    });
  };

  // ============================================================
  // 1. 工作区管理通道 (workspace:*)
  // ============================================================

  // 1.1 获取工作区最新状态、版本号与统计指标
  handleSafe('workspace:get', async (_payload, store) => {
    const state = store.getState();
    const activePhase = contracts.computeTaskPhase(state);
    const stats = {
      pagesCount: (state.pages || []).length,
      cardsCount: (state.cards || []).length,
      synthesisDone: Boolean(state.synthesis && state.synthesis.completedAt)
    };
    return {
      revision: state.revision || 1,
      activePhase,
      stats,
      state,
      runtime: {
        mode: 'desktop-ipc',
        rootDir: store.rootDir
      }
    };
  });

  for (const [channel, method] of [
    ['batch:rename','renameBatch'],
    ['batch:delete','deleteBatch'],
    ['page:delete','deletePage'],
    ['page:saveCards','savePageCards'],
    ['correction:request','requestCorrection'],
    ['correction:resolve','resolveCorrection'],
    ['batch:switch','switchBatch'],
    ['page:update','updatePage'],
    ['region:update','updateRegion'],
    ['region:delete','deleteRegion'],
    ['knowledge:saveRelations','saveKnowledgeRelations'],
    ['batch:new','newBatch'],
    ['archive:restore','restoreArchive']
  ]) {
    handleSafe(channel, async (payload, store) => { const result=store[method](payload); const state=store.getState(); notifyRenderer('workspace:changed',{action:method,state}); return {result,state}; });
  }

  handleSafe('image:get', async payload => ({image:await context.imageCache.get(payload)}));

  handleSafe('workspace:peek', async (_payload,store)=>store.peek());
  handleSafe('canvas:save', async (payload,store)=>{
    const canvas=store.saveCanvas(payload);
    notifyRenderer('workspace:changed',{action:'saveCanvas'});
    return {canvas,revision:store.peek().revision};
  });
  handleSafe('canvas:delete', async (payload,store)=>{
    const result=store.deleteCanvas(payload);
    notifyRenderer('workspace:changed',{action:'deleteCanvas'});
    return {...result,revision:store.peek().revision};
  });
  handleSafe('batch:archive', async (payload,store)=>{
    const archive=store.archiveBatch(payload);
    notifyRenderer('workspace:changed',{action:'archiveBatch'});
    return {archive,revision:store.peek().revision};
  });
  handleSafe('archive:list', async (_payload,store)=>({archives:store.listArchives()}));

  // 1.2 重置为示例笔记
  handleSafe('workspace:resetDemo', async (payload, store) => {
    const nextState = store.resetToDemo(payload);
    notifyRenderer('workspace:changed', { action: 'resetDemo', state: nextState });
    return { state: nextState };
  });

  // 1.3 导出工作区完整快照 (JSON + Markdown)
  handleSafe('workspace:exportSnapshot', async (payload, store) => {
    if (typeof store.exportSnapshot === 'function') {
      const result = store.exportSnapshot(payload?.targetDir);
      return { ...result };
    }
    return { error: 'store 未提供 exportSnapshot' };
  });

  // ============================================================
  // 2. 原纸与分区通道 (page:*)
  // ============================================================

  // 2.1 弹出原生系统文件对话框导入图片
  handleSafe('page:importDialog', async (payload, store) => {
    let filePaths = [];

    // 若处于自动化无人值守模式，且传入了 mockFiles，则直接使用 mockFiles
    const isAutomated = process.argv.includes('--papercard-automated');
    if (isAutomated && Array.isArray(payload.mockFiles) && payload.mockFiles.length > 0) {
      filePaths = payload.mockFiles;
    } else {
      const win = BrowserWindow.getFocusedWindow();
      const openProps = Array.isArray(payload?.properties) ? payload.properties : ['openFile', 'multiSelections'];

      const result = await dialog.showOpenDialog(win, {
        title: '选择手写笔记照片或扫描件',
        properties: openProps,
        filters: [
          { name: '手写扫描件与图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] },
          { name: '全部文件', extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true, importedPages: [], state: store.getState() };
      }
      filePaths = result.filePaths;
    }

    let importedPages = [];
    if (typeof store.importLocalFiles === 'function') {
      importedPages = store.importLocalFiles(filePaths);
    } else {
      for (const fp of filePaths) {
        const p = store.importPage({
          title: path.basename(fp),
          imagePath: fp,
          width: 1200,
          height: 1600
        });
        importedPages.push(p);
      }
    }

    notifyRenderer('workspace:changed', { action: 'importLocalFiles', pages: importedPages });
    return {
      canceled: false,
      importedPages,
      state: store.getState()
    };
  });

  // 2.2 直接导入单张纸张
  handleSafe('page:import', async (payload, store) => {
    const page = store.importPage({...payload,newBatch:true});
    notifyRenderer('workspace:changed', { action: 'importPage', page });
    return { page, state: store.getState() };
  });

  // 2.3 保存单页分区结果 (Phase 1: page_partition)
  handleSafe('page:savePartition', async (payload, store) => {
    const page = store.savePagePartition(payload);
    notifyRenderer('workspace:changed', { action: 'savePagePartition', page });
    return { page, state: store.getState() };
  });

  // 2.4 裁切原纸特定区域生成 SVG 切片
  handleSafe('page:cropRegion', async (payload, store) => {
    if (typeof store.cropRegion === 'function') {
      const cropRes = store.cropRegion(payload);
      return { ...cropRes, state: store.getState() };
    }
    return { error: 'store 未提供 cropRegion' };
  });

  // ============================================================
  // 3. 卡片生命周期管理通道 (card:*)
  // ============================================================

  // 3.1 保存分区填入的卡片 (Phase 2: region_card_fill)
  handleSafe('card:save', async (payload, store) => {
    const card = store.saveRegionCard(payload);
    notifyRenderer('workspace:changed', { action: 'saveRegionCard', card });
    return { card, state: store.getState() };
  });

  // 3.2 更新卡片内容（四层内容模型、字号层级、重绘规则）
  handleSafe('card:update', async (payload, store) => {
    const cardId = payload.cardId;
    const patch = payload.patch || payload;
    const expectedRevision = payload.expectedRevision ?? patch.expectedRevision;
    const card = store.updateCard(cardId, patch, expectedRevision);
    notifyRenderer('workspace:changed', { action: 'updateCard', card });
    return { card, state: store.getState() };
  });

  // 3.3 手动新建卡片
  handleSafe('card:add', async (payload, store) => {
    const card = store.addCard(payload);
    notifyRenderer('workspace:changed', { action: 'addCard', card });
    return { card, state: store.getState() };
  });

  // 3.4 删除卡片
  handleSafe('card:delete', async (payload, store) => {
    const cardId = payload.cardId;
    const expectedRevision = payload.expectedRevision;
    const success = store.deleteCard(cardId, expectedRevision);
    notifyRenderer('workspace:changed', { action: 'deleteCard', cardId });
    return { success, cardId, state: store.getState() };
  });

  // 3.5 拆分卡片 (card:split)
  handleSafe('card:split', async (payload, store) => {
    if (typeof store.splitCard === 'function') {
      const splitRes = store.splitCard(payload);
      notifyRenderer('workspace:changed', { action: 'splitCard', ...splitRes });
      return { ...splitRes, state: store.getState() };
    }
    return { error: 'store 未提供 splitCard' };
  });

  // 3.6 合并卡片 (card:merge)
  handleSafe('card:merge', async (payload, store) => {
    if (typeof store.mergeCards === 'function') {
      const mergeRes = store.mergeCards(payload);
      notifyRenderer('workspace:changed', { action: 'mergeCards', ...mergeRes });
      return { ...mergeRes, state: store.getState() };
    }
    return { error: 'store 未提供 mergeCards' };
  });

  // ============================================================
  // 4. 全局合成与自由画布排布通道 (synthesis:* / canvas:*)
  // ============================================================

  // 4.1 保存全局合成 (Phase 3: global_synthesis)
  handleSafe('synthesis:save', async (payload, store) => {
    const synthesis = store.saveGlobalSynthesis(payload);
    notifyRenderer('workspace:changed', { action: 'saveGlobalSynthesis', synthesis });
    return { synthesis, state: store.getState() };
  });

  // 4.2 批量保存画布中卡片坐标排布
  handleSafe('canvas:updateLayout', async (payload, store) => {
    const positions = payload.positions || payload;
    const expectedRevision = payload.expectedRevision;
    const layout = store.updateCanvasLayout(positions, expectedRevision,payload.canvasId);
    notifyRenderer('workspace:changed', { action: 'updateCanvasLayout', layout });
    return { layout,canvasId:payload.canvasId,revision:store.peek().revision };
  });

  // ============================================================
  // 5. 智能体协同与系统集成通道 (agent:* / clipboard / shell)
  // ============================================================

  // 5.1 生成供外部 Agent 调用的完整任务指令，并写入原生剪贴板（对标 SkillAtelier）
  handleSafe('agent:generatePrompt', async (payload, store) => {
    const promptFn = agentPrompt.generateAgentTaskPrompt || agentPrompt.buildAgentInstruction;
    const res = promptFn({
      store,
      stage: payload.stage,
      correctionOnly: payload.correctionOnly,
      mode: payload.mode,
      pageId: payload.pageId,
      pageIds: payload.pageIds,
      targetPageIds: payload.targetPageIds,
      autoPartition: payload.autoPartition !== undefined ? Boolean(payload.autoPartition) : false
    });
    const promptText = res.text || res.promptText || '';

    // 原生系统剪贴板写入
    clipboard.writeText(promptText);

    return {
      ...res,
      promptText,
      taskIndexFile: res.taskFile,
      taskFile: res.taskFile,
      copiedToClipboard: true
    };
  });

  // 5.2 查询当前 Agent 任务索引与进度状态
  handleSafe('agent:taskStatus', async (_payload, store) => {
    const tasksDir = store.tasksDir;
    const progressFile = path.join(tasksDir, 'progress.json');
    const indexFile = path.join(tasksDir, 'index.json');

    let progress = null;
    let index = null;

    if (fs.existsSync(progressFile)) {
      try {
        progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
      } catch {}
    }
    if (fs.existsSync(indexFile)) {
      try {
        index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      } catch {}
    }

    const activePhase = contracts.computeTaskPhase(store.getState());
    return {
      phase: activePhase,
      progress,
      index
    };
  });

  // 5.3 写入原生系统剪贴板
  handleSafe('clipboard:write', async (payload) => {
    const text = String(payload?.text || '');
    clipboard.writeText(text);
    return { success: true };
  });

  // 5.4 调用系统外壳打开本地目录或文件
  handleSafe('shell:openPath', async (payload) => {
    const targetPath = payload?.path || payload;
    if (typeof targetPath !== 'string' || !targetPath.trim()) {
      throw new Error('shell:openPath 需要提供有效的 path 字符串');
    }
    const errMessage = await shell.openPath(path.resolve(targetPath));
    if (errMessage) {
      throw new Error(errMessage);
    }
    return { success: true };
  });

  // ============================================================
  // 6. 软件内同步更新通道 (updater:*)
  // ============================================================

  // 6.1 检查 GitHub Releases 最新版本与更新说明
  handleSafe('updater:check', async (payload) => {
    return updater.checkForUpdates({
      ...payload,
      notifyRenderer
    });
  });

  // 6.2 下载更新包至临时目录，并广播下载进度
  handleSafe('updater:download', async (payload) => {
    const downloadUrl = payload?.url || payload?.downloadUrl;
    return updater.downloadUpdate(downloadUrl, {
      ...payload,
      notifyRenderer,
      onProgress: (progress) => {
        notifyRenderer('updater:progress', progress);
      }
    });
  });

  // 6.3 运行安装程序并启动更新
  handleSafe('updater:install', async (payload) => {
    const filePath = payload?.filePath || payload?.path;
    return updater.installUpdate(filePath, payload);
  });
}

module.exports = {
  register
};
