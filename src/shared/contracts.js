'use strict';
/**
 * contracts.js — 核心数据契约、三阶段状态机规范、IPC 白名单与交付校验准则
 *
 * 由领导者智能体（Leader Agent / 项目经理）制定，作为所有执行子智能体、
 * Electron 主进程/渲染进程 IPC 桥接与外部识别智能体的唯一契约真相源。
 *
 * 核心三步工作流与严格阶段顺序：
 *   Step 1: 本地桌面导入纸张 (IMPORT) + 右上角一键复制提示词 (COPY_PROMPT，原生剪贴板)
 *   Step 2: 外部 Agent 调用本地 CLI 工具，严格按三阶段顺序执行：
 *     - Phase 1 (`page_partition`)   : 逐页识别纸张内容并划分区域（Regions），提取截图与排版层级
 *     - Phase 2 (`region_card_fill`) : 逐个分区将具体文字/公式/图文转录为可编辑卡片，拟定标题，
 *                                      写入同页其他分区关联与跨页关联推测（直至所有卡片完成）
 *     - Phase 3 (`global_synthesis`) : 所有卡片完成后，最后统一处理全局跨页/题解关联确认、
 *                                      画布与页面排布（Layout）、学科/科目/章节分类（Taxonomy）
 *   Step 3: 本地桌面 UI（Electron app:// + Preload IPC）展示与交互：
 *     - 极简原纸排版对照视图 / 学科题解卡片视图 / 自由画布视图 + FLIP 切换动效
 */

const PHASES = Object.freeze({
  PAGE_PARTITION: 'page_partition',
  REGION_CARD_FILL: 'region_card_fill',
  PAGE_CARD_FILL: 'page_card_fill',
  GLOBAL_SYNTHESIS: 'global_synthesis',
  COMPLETED: 'completed'
});

const REGION_TYPES = Object.freeze([
  'problem',       // 题目
  'process',       // 推导/解答过程
  'key_step',      // 关键过程/核心结论
  'figure',        // 图形/几何图/函数图像/示意图
  'formula_block', // 独立公式块
  'thought',       // 思考/批注/灵感
  'article'        // 文章/段落笔记
]);

const REDRAW_MODES = Object.freeze([
  'keep_crop',     // 保留原始截图片段
  'svg_redraw',    // 需重新绘制为矢量 SVG（附重绘规则说明）
  'mermaid',       // 需重新绘制为结构图/流程图（附 Mermaid 规则）
  'canvas_plot'    // 需重新绘制为坐标系/几何画布（附函数或几何约束规则）
]);

const LINK_TYPES = Object.freeze([
  'belongs_to_problem', // 归属到相关问题（如：过程 -> 题目，关键过程 -> 过程/题目）
  'derivation_next',    // 推导承接（上一步过程 -> 下一步过程）
  'figure_reference',   // 图文对应关系（文字/公式 <-> 图形）
  'cross_page_cont',    // 同一内容跨页续接（上一页末尾分区 -> 下一页起始分区）
  'thought_extension',  // 思考/拓展关联
  'related_topic'       // 同知识点/同类题关联
]);

/**
 * 本地桌面端 Preload IPC 唯一授权通道白名单（对标 SkillAtelier 安全沙箱设计）
 */
const IPC_CHANNELS = Object.freeze([
  'image:get',
  'batch:rename',
  'batch:delete',
  'page:delete',
  'page:saveCards',
  'page:modifyPrompt',
  'correction:request',
  'correction:resolve',
  'batch:switch',
  'page:update',
  'region:update',
  'region:delete',
  'knowledge:saveRelations',
  'workspace:peek',
  'batch:new',
  'batch:archive',
  'archive:list',
  'archive:restore',
  'canvas:save',
  'canvas:delete',
  'workspace:get',
  'workspace:resetDemo',
  'workspace:exportSnapshot',
  'page:importDialog',
  'page:import',
  'page:savePartition',
  'page:cropRegion',
  'card:save',
  'card:update',
  'card:add',
  'card:delete',
  'card:split',
  'card:merge',
  'synthesis:save',
  'canvas:updateLayout',
  'agent:generatePrompt',
  'agent:taskStatus',
  'clipboard:write',
  'shell:openPath',
  'updater:check',
  'updater:download',
  'updater:install',
  'updater:progress'
]);

/**
 * 软件内同步更新 (In-App Updater) 专用通道与数据契约
 */
const UPDATER_CHANNELS = Object.freeze({
  CHECK: 'updater:check',
  DOWNLOAD: 'updater:download',
  INSTALL: 'updater:install',
  PROGRESS: 'updater:progress'
});

/**
 * 校验更新检查结果数据结构
 */
function validateUpdateInfo(info) {
  if (!info || typeof info !== 'object') {
    throw new Error('更新信息必须为对象');
  }
  if (typeof info.hasUpdate !== 'boolean') {
    throw new Error('更新信息必须包含 boolean 类型的 hasUpdate 字段');
  }
  if (typeof info.currentVersion !== 'string' || !info.currentVersion.trim()) {
    throw new Error('更新信息必须包含有效的 currentVersion');
  }
  if (typeof info.latestVersion !== 'string' || !info.latestVersion.trim()) {
    throw new Error('更新信息必须包含有效的 latestVersion');
  }
  return true;
}

/**
 * 校验归一化边界框 (0..1 相对原纸宽高，保留原纸空间排版映射)
 */
function validateBBox(bbox) {
  if (!bbox || typeof bbox !== 'object') return false;
  const { x, y, w, h } = bbox;
  return [x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.001 && y + h <= 1.001;
}

/**
 * 校验乐观并发版本号（expectedRevision）
 */
function validateRevisionConflict(currentRevision, expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null) return true;
  const exp = Number(expectedRevision);
  const cur = Number(currentRevision || 1);
  if (!Number.isInteger(exp) || exp < 1) {
    throw new Error(`expectedRevision 必须为正整数，收到: ${expectedRevision}`);
  }
  if (exp !== cur) {
    const err = new Error(`并发版本冲突 (REVISION_CONFLICT)：当前状态版本为 v${cur}，但提交基于旧版本 v${exp}，请先拉取最新状态`);
    err.code = 'REVISION_CONFLICT';
    err.retryable = true;
    err.currentRevision = cur;
    err.expectedRevision = exp;
    throw err;
  }
  return true;
}

/**
 * 校验单页分区提交载荷 (Phase 1: page_partition)
 */
function validatePagePartitionPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('分区提交格式无效：必须为 JSON 对象');
  }
  if (typeof payload.pageId !== 'string' || !payload.pageId.trim()) {
    throw new Error('分区提交必须指定有效的 pageId');
  }
  if (payload.pageSummary !== undefined && typeof payload.pageSummary !== 'string') {
    throw new Error('分区提交必须包含页面整体内容摘要 pageSummary');
  }
  if (!Array.isArray(payload.regions)) {
    throw new Error('分区提交必须包含至少一个内容区块 regions[]');
  }
  const seenIds = new Set();
  for (const [idx, reg] of payload.regions.entries()) {
    if (!reg || typeof reg !== 'object') throw new Error(`第 ${idx + 1} 个分区必须是对象`);
    if (typeof reg.regionId !== 'string' || !reg.regionId.trim()) {
      throw new Error(`第 ${idx + 1} 个分区缺少 regionId`);
    }
    if (seenIds.has(reg.regionId)) {
      throw new Error(`分区 ID 重复：${reg.regionId}`);
    }
    seenIds.add(reg.regionId);
    if (typeof reg.kind !== 'string' || !reg.kind.trim()) {
      throw new Error(`分区 ${reg.regionId} 的类型 ${reg.kind} 不在允许列表 (${REGION_TYPES.join(', ')}) 中`);
    }
    if ((reg.points !== undefined || reg.polygon !== undefined) && !validatePolygon(reg.points || reg.polygon, reg.bbox)) throw new Error('polygon points 必须位于 bbox 内，且至少三个有效点');
    if (!validateBBox(reg.bbox)) {
      throw new Error(`分区 ${reg.regionId} 的 bbox 必须为 0..1 范围内的 {x, y, w, h}`);
    }
  }
  return true;
}

/**
 * 校验单张卡片填充载荷 (Phase 2: region_card_fill)
 * 要求：
 *   - 具名标题 title
 *   - 可编辑结构化内容 editableContent + structureBlocks（绝不能只是整页死图）
 *   - 排版结构保留 typography（字号层级、对齐方式、图文混排映射）
 *   - 图形处理 figureInfo（保留原始截图片段 cropPath + 重绘规则 redrawRule）
 *   - 同页分区关联 intraPageLinks 与跨页关联/推测 crossPageHypotheses
 */
function validateCardFillPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('卡片提交格式无效：必须为 JSON 对象');
  }
  if (typeof payload.pageId !== 'string' || !payload.pageId.trim()) {
    throw new Error('卡片提交必须包含 pageId');
  }
  if (typeof payload.regionId !== 'string' || !payload.regionId.trim()) {
    throw new Error('卡片提交必须包含对应的 regionId');
  }
  if (typeof payload.title !== 'string' || !payload.title.trim()) {
    throw new Error('卡片提交必须拟定非空标题 title');
  }
  if (typeof payload.editableContent !== 'string' || (!payload.editableContent.trim() && !payload.figureInfo && !payload.unreadable)) {
    throw new Error('卡片必须包含可编辑正文 editableContent，不能只形成无法编辑的图片');
  }
  if (!Array.isArray(payload.structureBlocks) || payload.structureBlocks.length === 0) {
    if (typeof payload.editableContent === 'string' && payload.editableContent.trim()) {
      payload.structureBlocks = [{ kind: payload.kind || 'text', text: payload.editableContent.trim() }];
    } else {
      throw new Error('卡片必须包含结构化内容块 structureBlocks（文字/公式/关键步骤/图形引用）');
    }
  }
  if (!Array.isArray(payload.intraPageLinks)) {
    payload.intraPageLinks = [];
  }
  if (!Array.isArray(payload.crossPageHypotheses)) {
    payload.crossPageHypotheses = [];
  }
  if (payload.figureInfo) {
    const mode = payload.figureInfo.redrawMode || 'keep_crop';
    if (!REDRAW_MODES.includes(mode)) {
      throw new Error(`图形重绘模式无效：${mode}`);
    }
    if (payload.figureInfo.enabled !== false && mode !== 'keep_crop' && !payload.figureInfo.redrawSvg && !payload.figureInfo.redrawPath && (!payload.figureInfo.redrawRule || typeof payload.figureInfo.redrawRule !== 'string')) {
      throw new Error('需要重新绘制的图形必须显式定义处理规则 redrawRule');
    }
  }
  return true;
}

/**
 * 校验整页卡片填充载荷 (Phase 2: page_card_fill)
 */
function validatePageCardsPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('整页卡片提交格式无效：必须为 JSON 对象');
  }
  if (typeof payload.pageId !== 'string' || !payload.pageId.trim()) {
    throw new Error('整页卡片提交必须指定有效的 pageId');
  }
  if (!Array.isArray(payload.cards) || payload.cards.length === 0) {
    throw new Error('整页卡片提交必须包含至少一张卡片 cards[]');
  }
  for (const [idx, cardItem] of payload.cards.entries()) {
    if (!cardItem || typeof cardItem !== 'object') {
      throw new Error(`第 ${idx + 1} 张卡片必须是对象`);
    }
    validateCardFillPayload({ pageId: payload.pageId, ...cardItem });
  }
  return true;
}

/**
 * 校验卡片拆分载荷 (card_split)
 */
function validateCardSplitPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('卡片拆分参数无效：必须为对象');
  }
  if (typeof payload.sourceCardId !== 'string' || !payload.sourceCardId.trim()) {
    throw new Error('卡片拆分必须指定 sourceCardId');
  }
  if (!Array.isArray(payload.segments) || payload.segments.length < 2) {
    throw new Error('卡片拆分至少需要提供 2 个子卡片分片 segments[]');
  }
  for (const [idx, seg] of payload.segments.entries()) {
    if (!seg || typeof seg.title !== 'string' || !seg.title.trim()) {
      throw new Error(`拆分分片 #${idx + 1} 必须包含非空标题 title`);
    }
    if (typeof seg.editableContent !== 'string' || !seg.editableContent.trim()) {
      throw new Error(`拆分分片 #${idx + 1} 必须包含非空可编辑内容 editableContent`);
    }
  }
  return true;
}

/**
 * 校验卡片合并载荷 (card_merge)
 */
function validateCardMergePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('卡片合并参数无效：必须为对象');
  }
  if (!Array.isArray(payload.cardIds) || payload.cardIds.length < 2) {
    throw new Error('卡片合并至少需要指定 2 个不重复的 cardIds[]');
  }
  const uniqueIds = new Set(payload.cardIds);
  if (uniqueIds.size < 2) {
    throw new Error('卡片合并的 cardIds[] 不能包含重复卡片 ID');
  }
  return true;
}

/**
 * 校验全局合成载荷 (Phase 3: global_synthesis)
 * 必须在所有页面的所有分区卡片全部完成后才允许提交！
 * 包含：
 *   1. 全局关联与题解结构树（题目 -> 过程 -> 关键过程、跨页续接确认）
 *   2. 画布与页面排布方案（canvasLayout）
 *   3. 学科/科目/章节分类体系（taxonomyAssignments）
 */
function validateGlobalSynthesisPayload(payload, allCardIds = []) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('全局合成提交格式无效：必须为 JSON 对象');
  }
  if (!Array.isArray(payload.relations)) {
    throw new Error('全局合成必须提供最终确认的关联列表 relations[]');
  }
  if (!Array.isArray(payload.problemTrees)) {
    throw new Error('全局合成必须提供题目-过程-关键过程结构树 problemTrees[]');
  }
  if (!Array.isArray(payload.canvasLayout) || payload.canvasLayout.length === 0) {
    throw new Error('全局合成必须提供画布排布方案 canvasLayout[]');
  }
  if (!Array.isArray(payload.taxonomyAssignments) || payload.taxonomyAssignments.length === 0) {
    throw new Error('全局合成必须提供学科/科目/章节分类方案 taxonomyAssignments[]');
  }
  const assignedCards = new Set(payload.taxonomyAssignments.map((t) => t.cardId));
  const layoutCards = new Set(payload.canvasLayout.map((c) => c.cardId));
  for (const cid of allCardIds) {
    if (!assignedCards.has(cid)) {
      throw new Error(`卡片 ${cid} 缺少学科/科目/章节分类归属`);
    }
    if (!layoutCards.has(cid)) {
      throw new Error(`卡片 ${cid} 缺少画布初始排布坐标`);
    }
  }
  return true;
}

/**
 * 计算当前任务所处的严格阶段
 */
function activeBatchState(state) {
  if (!state.activeBatchId) return state;
  return {...state, pages:(state.pages || []).filter(p=>p.batchId===state.activeBatchId), cards:(state.cards || []).filter(c=>c.batchId===state.activeBatchId)};
}
function validatePolygon(points, bbox) {
  return validateBBox(bbox) && Array.isArray(points) && points.length >= 3 && points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= bbox.x - 1e-9 && p.y >= bbox.y - 1e-9 && p.x <= bbox.x+bbox.w+1e-9 && p.y <= bbox.y+bbox.h+1e-9);
}
function computeTaskPhase(state, options = {}) {
  state = activeBatchState(state);
  const pages = state.pages || [];
  if (pages.length === 0) return PHASES.PAGE_PARTITION;

  // 旧兼容模式 (若 state 或 options 明确标记了 autoPartition，或旧无批次单元测试中仅部分页面标记了 partitionedAt)
  const legacyAuto = options.autoPartition === true || state.autoPartition === true || (!state.batches && !state.activeBatchId && pages.some(p => p.partitionedAt));
  if (legacyAuto) {
    const unpartitionedPage = pages.find((p) => !Array.isArray(p.regions) || p.regions.length === 0 || !p.partitionedAt);
    if (unpartitionedPage) {
      return PHASES.PAGE_PARTITION;
    }
  }

  // 默认人工框选为主工作流：
  // 1. 如果页面已有 regions，即使 partitionedAt 未设置，也视为已完成分区
  // 2. 只有当批次内所有页面都没有任何 region 时，才返回 page_partition
  const pagesWithRegions = pages.filter(p => Array.isArray(p.regions) && p.regions.length > 0);
  if (pagesWithRegions.length === 0) {
    return PHASES.PAGE_PARTITION;
  }

  // 3. 一旦有任何页面存在 region，未框选的空白页不阻塞已框选页面进入 region_card_fill
  // 只要还有已框选 region 未填卡片，就进入 region_card_fill
  const cardsByRegion = new Set((state.cards || []).map((c) => `${c.pageId}::${c.regionId}`));
  for (const page of pagesWithRegions) {
    for (const region of page.regions) {
      if (!cardsByRegion.has(`${page.pageId}::${region.regionId}`)) {
        return PHASES.REGION_CARD_FILL;
      }
    }
  }

  // 4. 全部已框选 region 都填完卡片后进入 global_synthesis
  if (!state.synthesis || !state.synthesis.completedAt) {
    return PHASES.GLOBAL_SYNTHESIS;
  }

  return PHASES.COMPLETED;
}

module.exports = {
  PHASES,
  REGION_TYPES,
  REDRAW_MODES,
  LINK_TYPES,
  IPC_CHANNELS,
  UPDATER_CHANNELS,
  validateUpdateInfo,
  activeBatchState,
  validatePolygon,
  validateBBox,
  validateRevisionConflict,
  validatePagePartitionPayload,
  validateCardFillPayload,
  validatePageCardsPayload,
  validateCardSplitPayload,
  validateCardMergePayload,
  validateGlobalSynthesisPayload,
  computeTaskPhase
};
