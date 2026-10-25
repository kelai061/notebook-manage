'use strict';
/**
 * api.js — PaperCard Atelier 前端统一 API 桥接层
 *
 * 核心机制：
 * 1. 优先通过 window.papercard.call(channel, payload) 走原生 Electron IPC 通道（零网络端口）。
 * 2. 在非 Electron 环境（无头测试 / 独立浏览器）下自动降级为 fetch /api 适配层。
 * 3. 挂载到 window.PaperCardAPI，供主控 app.js 与各界面模块无缝调用。
 */

(function () {
  const hasDesktopIPC = typeof window !== 'undefined' && Boolean(window.papercard && typeof window.papercard.call === 'function');

  /**
   * 底层调用分发器
   */
  async function invokeIPC(channel, payload = {}) {
    if (typeof window !== 'undefined' && window.papercard && typeof window.papercard.call === 'function') {
      const res = await window.papercard.call(channel, payload);
      if (res && res.ok === false) {
        const err = new Error(res.error || `IPC 执行失败 [${channel}]`);
        err.code = res.code;
        throw err;
      }
      if (res?.state && window.PaperCardAPI) window.PaperCardAPI.cachedWorkspace = {state:res.state,revision:res.revision||res.state.revision};
      return res;
    }

    // 降级回退：HTTP REST API（用于无头测试或纯网页调试）
    try {
      const channelToUrl = {
        'workspace:get': { url: '/api/state', method: 'GET' },
        'workspace:resetDemo': { url: '/api/workspace/reset', method: 'POST' },
        'page:import': { url: '/api/pages/import', method: 'POST' },
        'card:add': { url: '/api/cards', method: 'POST' },
        'card:update': { url: `/api/cards/${encodeURIComponent(payload.cardId || '')}`, method: 'PATCH' },
        'card:delete': { url: `/api/cards/${encodeURIComponent(payload.cardId || '')}`, method: 'DELETE' },
        'canvas:updateLayout': { url: '/api/canvas/layout', method: 'POST' },
        'agent:generatePrompt': { url: '/api/prompt/copy', method: 'POST' },
        'batch:delete': { url: `/api/batches/${encodeURIComponent(payload.batchId || '')}`, method: 'DELETE' },
        'page:delete': { url: `/api/pages/${encodeURIComponent(payload.pageId || '')}`, method: 'DELETE' },
        'page:saveCards': { url: '/api/pages/cards', method: 'POST' }
      };

      const mapping = channelToUrl[channel];
      if (mapping) {
        const resp = await fetch(mapping.url, {
          method: mapping.method,
          headers: { 'Content-Type': 'application/json' },
          body: mapping.method !== 'GET' ? JSON.stringify(payload) : undefined
        });
        const data = await resp.json();
        return { ok: resp.ok, ...data };
      }
    } catch (httpErr) {
      console.warn(`[API Fallback] HTTP 调用失败 [${channel}]:`, httpErr);
    }

    return { ok: true, data: payload };
  }

  const PaperCardAPI = {
    get isDesktop() {
      return typeof window !== 'undefined' && Boolean(window.papercard && window.papercard.isDesktop);
    },

    /** 获取工作区最新状态 */
    async getWorkspace() {
      return invokeIPC('workspace:get');
    },

    /** 重置为演示手写笔记 */
    async resetDemo(mode) {
      return invokeIPC('workspace:resetDemo', { mode });
    },

    /** 导出 Markdown 与 JSON 完整快照 */
    async exportSnapshot(targetDir) {
      return invokeIPC('workspace:exportSnapshot', { targetDir });
    },

    /** 调起原生系统文件选择器导入本地扫描图片 */
    async importFromDialog(options = {}) {
      return invokeIPC('page:importDialog', options);
    },

    /** 导入手写纸张 */
    async importPage(payload) {
      return invokeIPC('page:import', payload);
    },

    /** 保存单页交互式分区框结果 */
    async savePartition(payload) {
      return invokeIPC('page:savePartition', payload);
    },

    /** 裁切原纸特定区域并生成截图片段 SVG */
    async cropRegion(payload) {
      return invokeIPC('page:cropRegion', payload);
    },

    /** 保存分区填入的可编辑卡片 (Phase 2) */
    async saveCard(payload) {
      return invokeIPC('card:save', payload);
    },

    /** 更新卡片内容（四层内容模型、字号层级、重绘规则） */
    async updateCard(cardId, patch, expectedRevision) {
      return invokeIPC('card:update', { cardId, patch, expectedRevision });
    },

    /** 手动新增卡片 */
    async addCard(payload) {
      return invokeIPC('card:add', payload);
    },

    /** 删除卡片 */
    async deleteCard(cardId, expectedRevision) {
      return invokeIPC('card:delete', { cardId, expectedRevision });
    },

    /** 拆分卡片 (一拆多) */
    async splitCard(payload) {
      return invokeIPC('card:split', payload);
    },

    /** 合并卡片 (多合一) */
    async mergeCards(payload) {
      return invokeIPC('card:merge', payload);
    },

    /** 保存全局题解树、排布与学科分类 (Phase 3) */
    async saveSynthesis(payload) {
      return invokeIPC('synthesis:save', payload);
    },

    /** 批量更新自由画布中卡片坐标 */
    async updateCanvasLayout(positions, expectedRevision, canvasId) {
      return invokeIPC('canvas:updateLayout', { positions, expectedRevision, canvasId });
    },

    /** 一键生成外部 Agent 识别引导指令，并写入系统剪贴板 */
    async generateAgentPrompt(stage, options={}) {
      if (typeof stage === 'string' && Object.keys(options).length === 0) {
        return invokeIPC('agent:generatePrompt', stage ? { stage } : {});
      }
      return invokeIPC('agent:generatePrompt', typeof stage==='object' ? stage : {...options,...(stage?{stage}:{})});
    },

    async saveCanvas(payload) { return invokeIPC('canvas:save', payload); },
    async deleteCanvas(canvasId) { return invokeIPC('canvas:delete', {canvasId}); },
    async newBatch(title) { return invokeIPC('batch:new', {title}); },
    async archiveBatch(batchId) { return invokeIPC('batch:archive', {batchId}); },
    async listArchives() { return invokeIPC('archive:list'); },
    async restoreArchive(archiveId) { return invokeIPC('archive:restore', {archiveId}); },
    async peekWorkspace() { return invokeIPC('workspace:peek'); },
    async renameBatch(batchId,title) { return invokeIPC('batch:rename',{batchId,title}); },
    async deleteBatch(batchId, expectedRevision) { return invokeIPC('batch:delete', { batchId, expectedRevision }); },
    async deletePage(pageId, options = {}) { return invokeIPC('page:delete', { pageId, ...options }); },
    async savePageCards(payload) { return invokeIPC('page:saveCards', payload); },
    async requestCorrection(payload) { return invokeIPC('correction:request',payload); },
    async resolveCorrection(payload) { return invokeIPC('correction:resolve',payload); },
    async switchBatch(batchId) { return invokeIPC('batch:switch', { batchId }); },
    async updatePage(pageId, patch) { return invokeIPC('page:update', { pageId, ...patch }); },
    async deleteRegion(pageId, regionId) { return invokeIPC('region:delete', { pageId, regionId }); },
    async updateRegion(pageId, regionId, patch) { return invokeIPC('region:update', { pageId, regionId, patch }); },
    async saveKnowledgeRelations(relations) { return invokeIPC('knowledge:saveRelations', { relations }); },

    /** 查询 Agent 任务索引与三阶段进度 */
    async getAgentTaskStatus() {
      return invokeIPC('agent:taskStatus');
    },

    /** 写入系统原生剪贴板 */
    async writeClipboard(text) {
      if (typeof window !== 'undefined' && window.papercard) {
        return invokeIPC('clipboard:write', { text });
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        return { ok: true };
      }
      return { ok: false };
    },

    /** 调用系统外壳打开本地目录或文件 */
    async openPath(targetPath) {
      return invokeIPC('shell:openPath', { path: targetPath });
    },

    /** 监听工作区状态实时变更 */
    onWorkspaceChanged(callback) {
      if (typeof window !== 'undefined' && window.papercard && window.papercard.onWorkspaceChanged) {
        return window.papercard.onWorkspaceChanged(callback);
      }
      return () => {};
    },
    /** 检查在线更新 */
    async checkUpdate(options = {}) {
      if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.checkUpdate === 'function') {
        return window.electronAPI.checkUpdate(options);
      }
      return invokeIPC('updater:check', options);
    },

    /** 下载更新包 */
    async downloadUpdate(url, options = {}) {
      if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.downloadUpdate === 'function') {
        return window.electronAPI.downloadUpdate(url, options);
      }
      return invokeIPC('updater:download', { url, ...options });
    },

    /** 安装更新并重启 */
    async installUpdate(filePath, options = {}) {
      if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.installUpdate === 'function') {
        return window.electronAPI.installUpdate(filePath, options);
      }
      return invokeIPC('updater:install', { filePath, ...options });
    },

    /** 监听下载进度 */
    onUpdateProgress(callback) {
      if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.onUpdateProgress === 'function') {
        return window.electronAPI.onUpdateProgress(callback);
      }
      return () => {};
    }
  };

  if (typeof window !== 'undefined') {
    window.PaperCardAPI = PaperCardAPI;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PaperCardAPI;
  }
})();
