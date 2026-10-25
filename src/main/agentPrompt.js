'use strict';
/**
 * agentPrompt.js — 智能体指令生成器与任务索引打包服务
 *
 * 对标 SkillAtelier（agentTranslation.js + translationTasks.js）：
 *   - 负责生成可在 UI 右上角一键复制的完整智能体执行指令。
 *   - 在本地落盘任务索引 index.json 与进度追踪 progress.json。
 *   - 强约束外部 Agent 遵循「逐页识别分区 → 逐区填充可编辑卡片与关联推测 → 全局题解关联排布与分类」的三阶段铁律。
 *   - 支持无全局 Node 环境下的 Electron 运行时兜底 (ELECTRON_RUN_AS_NODE=1)。
 */

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const contracts = require('../shared/contracts');

/**
 * 拷贝文本至 Windows 系统剪贴板
 */
function copyToWindowsClipboard(text) {
  if (typeof text !== 'string') return false;
  try {
    const ps = cp.spawnSync('powershell', ['-NoProfile', '-Command', '$Input | Set-Clipboard'], {
      input: text,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    });
    if (ps.status === 0) return true;
  } catch {}

  try {
    const clip = cp.spawnSync('clip', [], {
      input: text,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    });
    return clip.status === 0;
  } catch {
    return false;
  }
}

/**
 * 构建供外部 Agent 执行的完整引导提示词与任务索引文件
 * 支持传 ws 实例，或 { store, cliPath } 配置对象
 */
function buildAgentInstruction(wsOrOptions, stageArg, optsArg) {
  let opts = wsOrOptions?.getState ? { store: wsOrOptions } : { ...(wsOrOptions || {}) };
  if (typeof stageArg === 'string') opts.stage = stageArg;
  if (optsArg && typeof optsArg === 'object') Object.assign(opts, optsArg);
  const ws = opts?.store;
  if (!ws?.getState) throw new Error('需要WorkspaceStore');
  const full = ws.getState();
  const stage = opts.stage || (wsOrOptions?.getState ? 'workflow' : 'recognition');
  const global = stage === 'knowledge_synthesis', batchId = global ? null : opts.batchId || full.activeBatchId;
  if (!['recognition', 'workflow', 'page_partition', 'region_card_fill', 'global_synthesis', 'knowledge_synthesis', 'completed'].includes(stage)) throw new Error('无效阶段');
  const batch = full.batches.find(b => b.batchId === batchId);
  if (!global && !batch) throw new Error('请先导入纸张或选择工作批');
  const state = global ? full : { ...full, activeBatchId: batchId, pages: full.pages.filter(p => p.batchId === batchId), cards: full.cards.filter(c => c.batchId === batchId), synthesis: batch.synthesis };
  const phase = contracts.computeTaskPhase(state);
  const taskId = require('node:crypto').randomUUID();
  const cliPath = path.resolve(opts.cliPath || path.join(__dirname, '../cli/noteTasks.js'));
  const skillPath = path.resolve(__dirname, '../../skills/papercard-agent/SKILL.md');
  const bundledNode = path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe');
  const nodePath = fs.existsSync(bundledNode) ? bundledNode : process.execPath.toLowerCase().includes('node') ? process.execPath : 'node';
  fs.mkdirSync(ws.tasksDir, { recursive: true });
  const taskFile = path.join(ws.tasksDir, 'task-' + taskId + '.json');
  const targetPageIds = Array.isArray(opts.targetPageIds) ? opts.targetPageIds : Array.isArray(opts.pageIds) ? opts.pageIds : opts.pageId ? [opts.pageId] : undefined;
  const isModify = Boolean(opts.mode === 'modify' || (targetPageIds && targetPageIds.length > 0));
  const hasUserRegions = state.pages.some(p => p.regions && p.regions.length > 0);
  const autoPartition = opts.autoPartition !== undefined ? Boolean(opts.autoPartition) : stage === 'workflow' ? true : !hasUserRegions;
  const singleRegion = opts.singleRegion !== undefined ? Boolean(opts.singleRegion) : autoPartition;
  const task = {
    version: 3,
    taskId,
    workspaceRoot: ws.rootDir,
    scope: global ? 'knowledge' : 'batch',
    batchId,
    stage: stage === 'workflow' ? undefined : stage,
    correctionOnly: Boolean(opts.correctionOnly || isModify),
    autoPartition,
    singleRegion,
    targetPageIds: targetPageIds || undefined,
    cliPath,
    nodePath,
    skillPath,
    createdAt: Date.now()
  };
  fs.writeFileSync(taskFile, JSON.stringify(task, null, 2), { flag: 'wx' });
  // A shortcut can change; the immutable task path above never changes or resets.
  const indexPath = path.join(ws.tasksDir, 'index.json');
  let legacyIndex = false;
  if (fs.existsSync(indexPath)) { try { legacyIndex = !JSON.parse(fs.readFileSync(indexPath, 'utf8').replace(/^\uFEFF/, '')).shortcut; } catch { legacyIndex = true; } }
  fs.writeFileSync(legacyIndex ? path.join(ws.tasksDir, 'latest-task.json') : indexPath, JSON.stringify({ ...task, taskFile, shortcut: true }, null, 2));
  const q = value => "'" + String(value).replaceAll("'", "''") + "'";
  const command = op => `& ${q(nodePath)} ${q(cliPath)} ${op} ${q(taskFile)}`;
  const worker = 'worker-' + taskId.slice(0, 8);
  const rules = {
    recognition: '人工框选为主、按整页上下文识别：框选由用户亲自完成，绝不无端自动乱画框。AI 必须观察同一张完整原纸图像（结合各框选编号与坐标方位）来识别内容、把握整页上下文及同页各框选之间的关联。原纸上的红笔内容（或分区上的 redPenHint/aiHint）作为给 AI 的提示词（无红笔提示时留空 ""，绝不强行推理或编造）。为了节省 Token 并保持页面上下文连贯性，请在处理完一个完整页面后按页提交（page_card_fill）更新本页所有框选卡片；所有待处理页填完即停止，禁止自动做 global_synthesis。已有卡片不重复识别；仅显式未解决 corrections 返回 reprocess:true 时重处理，保留 cardId 和已有 regionId。',
    workflow: '旧兼容全流程，严格逐页分区→逐区填写→全局整理。',
    page_partition: '旧兼容单分区阶段。识别当前任务批次全部页的可见边界，填写pageSummary与regions，不进入写卡和整理。',
    region_card_fill: '旧兼容单写卡阶段。先确认本任务批次所有页已有分区，再逐区忠实填写，不进入整理。',
    global_synthesis: '仅整理本任务批次已有卡片的证据关联、排布与分类，禁止引用其他批次卡片或改写正文。',
    knowledge_synthesis: '这是显式全库任务。主要使用subject/course/chapter目录、搜索索引、多个有限主题画布及knowledge/index.md。taxonomyAssignments仅改分类；canvases新建/明确ID增量修改，scope=knowledge，cardIds只包含主题有限成员；relations有证据才upsert，保留人工关系。禁止全卡大图和连接所有卡，禁止无证据线，不改原正文。',
    completed: '当前识别已完成，只有用户标记correction后才重新识别。'
  };
  const modifyNotice = isModify && targetPageIds ? `\n【重要】本次为指定页面修改/重处理任务（目标页面：${targetPageIds.join(', ')}），框选已由用户确定，请直接观察整张原纸并按页提交（page_card_fill）更新本页所有框选的卡片内容。\n` : '';
  const text = `先阅读本项目智能体技能：${skillPath}\n任务ID：${taskId}\n不可变任务文件：${taskFile}\n固定作用域：${global ? '全部知识库' : batchId + '「' + batch.title + '」'}，界面导入或切换批次不会改变本任务。不要调用batch:switch，不要修改任务JSON或使用index.json代替此文件。\n${rules[stage]}${modifyNotice}\n${(opts.correctionOnly || isModify) ? '本任务correctionOnly:true，只处理用户标记纠错或指定修改页面，不处理其他未标记页面。' : ''}\n忠实转录文字、公式和排版，不推理、不补全、不编造；无法辨认标记[无法辨认]或unreadable:true；不理解图形保留截图，重绘是可选插件。原纸上的红笔内容（或分区/页面上的 redPenHint/aiHint）作为给 AI 的提示词（原纸上无红笔提示时留空 ""，绝不强行推理或编造）。\n以下是PowerShell可直接执行的本地命令（优先明确Node路径，避免系统node shim）：\n${command('claim')} ${q(worker)}\n${command('next')}\n根据next的status/target/phase/revision和schemaExample写UTF-8 JSON文件，随后：\n${command('commit')} '载荷文件.json'\n读取claim返回的lease.leaseId；载荷须包含agentId:${worker}和该leaseId，expectedRevision使用刚获取的revision，operationId采用任务ID+目标pageId/regionId+correction requestedAt，重试保持同一operationId，纠错须reprocess:true。推荐按页整页提交（page_card_fill，亦支持单框 region_card_fill）。每次 commit 成功后会自动返回下一页目标与最新 revision，无需重复执行 next。直到stageComplete:true（recognition此时即本批识别完成）即停止，不自动整理。\n长任务可使用 ${command('prepare')} 一次性获取全批待处理页队列与预生成草稿文件（agent-tasks/drafts/）。\n${command('status')}\n本任务(v3)status在pending时仍退出0，凭JSON判断是否完成；旧任务退出码2也仅表示pending，不是任务失败；PowerShell先读取JSON，不要用&&串接导致断链。错误JSON code=REVISION_CONFLICT时先next拉新revision，保持operationId重试；WORKSPACE_BUSY可稍后重试；LEASE_HELD表示同一任务其他worker占用，不要抢租约。不同任务批次可并发，实际写盘由短事务锁串行防覆盖。\n长任务每15分钟内续租：${command('renew')} ${q(worker)} 'claim返回的leaseId'\n结束释放：${command('release')} ${q(worker)} 'claim返回的leaseId'\n兼容运行时：若无Node可设置ELECTRON_RUN_AS_NODE=1，使用已启用Node模式的Electron运行CLI，但不得启动另一窗口替代CLI。`;
  return { text, promptText: text, taskFile, taskIndexFile: taskFile, taskId, batchId, stage, phase, pageCount: state.pages.length, skillPath, complete: phase === 'completed' };
}
const generateAgentTaskPrompt = buildAgentInstruction;
const generateAgentPrompt = buildAgentInstruction;
module.exports = { buildAgentInstruction, generateAgentPrompt, generateAgentTaskPrompt, copyToWindowsClipboard };
