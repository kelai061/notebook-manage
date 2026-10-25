'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contracts = require('../shared/contracts');
const { createWorkspaceStore } = require('../main/store');
const { withWorkspaceLock } = require('../main/workspaceTransactions');

function failure(message, code, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function writeJson(file, value) {
  const temp = file + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function parsePayload(value, extra) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') throw failure('需提供JSON对象或UTF-8 JSON文件', 'INVALID_PAYLOAD');
  let target = value.trim();
  if (target === '--draft-file' && extra) {
    target = String(extra).trim();
  } else if (target.startsWith('--draft-file=')) {
    target = target.slice('--draft-file='.length).trim();
  }
  target = target.replace(/^["']|["']$/g, '');
  const text = target.replace(/^\uFEFF/, '').trim();
  return text.startsWith('{') ? JSON.parse(text) : readJson(path.resolve(text));
}

function context(taskPath) {
  if (!taskPath) throw failure('需指定任务文件', 'TASK_REQUIRED');
  let taskFile = path.resolve(taskPath);
  if (fs.existsSync(taskFile) && fs.statSync(taskFile).isDirectory()) taskFile = path.join(taskFile, 'index.json');
  let task = readJson(taskFile);
  if (task.taskFile && path.basename(taskFile) === 'index.json') {
    taskFile = path.resolve(task.taskFile);
    task = readJson(taskFile);
  }
  if (!task.workspaceRoot) throw failure('任务缺少workspaceRoot', 'INVALID_TASK');
  const ws = createWorkspaceStore(task.workspaceRoot);
  const global = task.scope === 'knowledge' || task.stage === 'knowledge_synthesis';
  let batchId = global ? null : task.batchId;
  if (!global && !batchId) {
    const bindingFile = taskFile + '.binding.json';
    if (fs.existsSync(bindingFile)) batchId = readJson(bindingFile).batchId;
    else {
      const full = ws.getState();
      const candidates = full.batches.filter(batch => {
        const pages = full.pages.filter(p => p.batchId === batch.batchId);
        return pages.length && (!task.pageCount || pages.length === task.pageCount) && pages.every(p => !p.importedAt || p.importedAt <= task.createdAt);
      });
      batchId = full.batches.length === 1 ? full.batches[0].batchId : candidates.length === 1 ? candidates[0].batchId : null;
      if (!batchId) throw failure('旧任务缺少固定batchId；请使用bind <taskFile> <batchId>明确绑定，不会跟随界面切批', 'LEGACY_BINDING_REQUIRED');
      try {
        fs.writeFileSync(bindingFile, JSON.stringify({ batchId, createdAt: Date.now() }), { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        batchId = readJson(bindingFile).batchId;
      }
    }
  }
  if (!global && !ws.getState().batches.some(b => b.batchId === batchId)) throw failure('任务绑定批次不存在', 'BATCH_NOT_FOUND');
  return { taskFile, task, ws, batchId, global };
}

function scoped(ctx) {
  const full = ctx.ws.getState();
  if (ctx.global) return full;
  const batch = full.batches.find(b => b.batchId === ctx.batchId);
  return { ...full, activeBatchId: ctx.batchId, pages: full.pages.filter(p => p.batchId === ctx.batchId), cards: full.cards.filter(c => c.batchId === ctx.batchId), synthesis: batch.synthesis || null };
}

function auxiliary(ctx, kind) {
  return path.join(path.dirname(ctx.taskFile), path.basename(ctx.taskFile, '.json') + '.' + kind + '.json');
}

function unresolved(value) {
  return Boolean(value?.corrections?.requestedAt && !value.corrections.resolvedAt);
}

function computePositionHint(bbox, idx) {
  const b = bbox || { x: 0, y: 0, w: 1, h: 1 };
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const xDesc = cx < 0.35 ? '左' : cx > 0.65 ? '右' : '中';
  const yDesc = cy < 0.35 ? '上' : cy > 0.65 ? '下' : '中';
  const posName = yDesc === '中' && xDesc === '中' ? '中心' : `${yDesc}${xDesc}`;
  const x1 = Math.round(b.x * 100);
  const x2 = Math.round((b.x + b.w) * 100);
  const y1 = Math.round(b.y * 100);
  const y2 = Math.round((b.y + b.h) * 100);
  return `第${idx + 1}区 [${posName} x:${x1}%..${x2}%, y:${y1}%..${y2}%]`;
}

function ensurePageDrafts(root, taskId, page, regions, reprocess, revision) {
  const draftsDir = path.join(root, 'agent-tasks', 'drafts');
  if (!fs.existsSync(draftsDir)) fs.mkdirSync(draftsDir, { recursive: true });

  const pageW = page.width || 1200;
  const pageH = page.height || 1600;
  const svgPath = path.join(draftsDir, `annotated-${page.pageId}.svg`);
  const draftPath = path.join(draftsDir, `draft-${taskId}-${page.pageId}.json`);

  const overlayElements = (regions || []).map((reg, idx) => {
    const b = reg.bbox || { x: 0, y: 0, w: 1, h: 1 };
    const rx = Math.round(b.x * pageW);
    const ry = Math.round(b.y * pageH);
    const rw = Math.round(b.w * pageW);
    const rh = Math.round(b.h * pageH);
    const badgeW = Math.min(130, Math.max(70, rw));
    const badgeH = 26;
    const badgeY = Math.max(0, ry);
    return `
    <g id="annotated-region-${reg.regionId}">
      <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="rgba(234, 88, 12, 0.12)" stroke="#ea580c" stroke-width="3" stroke-dasharray="6 3" rx="4"/>
      <rect x="${rx}" y="${badgeY}" width="${badgeW}" height="${badgeH}" fill="#ea580c" rx="4"/>
      <text x="${rx + 8}" y="${badgeY + 18}" fill="#ffffff" font-size="15" font-weight="bold" font-family="'Segoe UI', sans-serif">#${idx + 1} ${reg.label || reg.kind || reg.regionId}</text>
    </g>`;
  }).join('\n');

  let baseContent = '';
  if (page.svgPreview) {
    baseContent = page.svgPreview.replace(/^\s*<\?xml[^>]*>\s*/, '').replace(/<svg\b[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
  } else if (page.imagePath) {
    baseContent = `<image href="${page.imagePath}" width="${pageW}" height="${pageH}"/>`;
  }
  const annotatedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pageW} ${pageH}" width="${pageW}" height="${pageH}">\n${baseContent}\n${overlayElements}\n</svg>`;
  fs.writeFileSync(svgPath, annotatedSvg, 'utf8');

  const draftData = {
    phase: 'page_card_fill',
    pageId: page.pageId,
    pageSummary: page.pageSummary || '',
    cards: (regions || []).map((r, i) => ({
      regionId: r.regionId,
      positionHint: r.positionHint || computePositionHint(r.bbox, i),
      bbox: r.bbox,
      title: r.label && r.label !== '新分区' ? r.label : `笔记区 #${i + 1}`,
      editableContent: '',
      structureBlocks: [{ kind: 'text', text: '' }],
      intraPageLinks: [],
      crossPageHypotheses: [],
      redPenHint: r.redPenHint || r.aiHint || '',
      aiHint: r.aiHint || r.redPenHint || '',
      figureInfo: { enabled: false, redrawMode: 'keep_crop' }
    })),
    reprocess: Boolean(reprocess),
    operationId: `${taskId}-${page.pageId}-${Date.now()}`
  };
  fs.writeFileSync(draftPath, JSON.stringify(draftData, null, 2), 'utf8');

  return { annotatedSvgPath: svgPath, draftFile: draftPath };
}

function recognitionTarget(state, correctionOnly = false, options = {}) {
  const targetPageIds = options.targetPageIds || null;
  const pages = targetPageIds ? state.pages.filter(p => targetPageIds.includes(p.pageId)) : state.pages;
  const autoPartition = Boolean(options.autoPartition);
  const singleRegion = Boolean(options.singleRegion);
  const allowPartitionFix = Boolean(options.allowPartitionFix);

  const existing = new Set(state.cards.map(c => c.pageId + '::' + c.regionId));

  for (const page of pages) {
    const pageFix = unresolved(page), regions = page.regions || [];
    const partitionFix = (pageFix && !page.corrections.partitionResolvedAt) || regions.some(r => unresolved(r) && r.corrections?.kind !== 'content' && !r.corrections?.partitionResolvedAt);

    // 1. 若有待解决的分区纠错（显式发起框选修改）
    if (partitionFix) {
      return { phase: 'page_partition', page, reprocess: true };
    }

    // 2. 若页面已有框选，优先处理本页卡片填写（一页内按整页 page_card_fill 或单框 region_card_fill）
    if (regions.length > 0) {
      let targetRegions = [];
      let reprocess = false;

      if (pageFix || (targetPageIds && targetPageIds.includes(page.pageId) && correctionOnly)) {
        targetRegions = regions;
        reprocess = true;
      } else {
        for (const region of regions) {
          if (unresolved(region)) {
            targetRegions.push(region);
            reprocess = true;
          } else if (!correctionOnly && !existing.has(page.pageId + '::' + region.regionId)) {
            targetRegions.push(region);
          }
        }
      }

      if (targetRegions.length > 0) {
        if (singleRegion) {
          return { phase: 'region_card_fill', page, region: targetRegions[0], reprocess };
        }
        return { phase: 'page_card_fill', page, regions: targetRegions, reprocess };
      }
    }

    // 3. 旧兼容模式下，若页面尚未分区且 autoPartition 为 true
    if (autoPartition && !correctionOnly && (!page.partitionedAt || !regions.length)) {
      return { phase: 'page_partition', page, reprocess: false };
    }
  }

  return null;
}

function report(ctx) {
  const state = scoped(ctx), phase = contracts.computeTaskPhase(state, { autoPartition: Boolean(ctx.task.autoPartition) });
  const targetPageIds = Array.isArray(ctx.task.targetPageIds) ? ctx.task.targetPageIds : null;
  const pages = targetPageIds ? state.pages.filter(p => targetPageIds.includes(p.pageId)) : state.pages;
  const seen = new Set(state.cards.map(c => c.pageId + '::' + c.regionId));

  const totalRegions = pages.reduce((n, p) => n + (p.regions || []).length, 0);
  const pendingRegions = pages.reduce((n, p) => n + (p.regions || []).filter(r => !seen.has(p.pageId + '::' + r.regionId)).length, 0);
  const pendingPages = ctx.task.autoPartition
    ? pages.filter(p => !p.partitionedAt || !p.regions?.length).length
    : pages.filter(p => p.regions?.length && p.regions.some(r => !seen.has(p.pageId + '::' + r.regionId))).length;

  const stages = ['page_partition', 'region_card_fill', 'global_synthesis', 'completed'];
  let stageComplete = Boolean(ctx.task.stage && stages.indexOf(phase) > stages.indexOf(ctx.task.stage));
  const taskOpts = {
    autoPartition: Boolean(ctx.task.autoPartition),
    singleRegion: Boolean(ctx.task.singleRegion),
    allowPartitionFix: Boolean(ctx.task.allowPartitionFix),
    targetPageIds
  };
  if (ctx.task.stage === 'recognition') {
    stageComplete = Boolean(ctx.task.correctionOnly || pages.length) && !recognitionTarget(state, ctx.task.correctionOnly, taskOpts);
  }
  if (ctx.global) {
    stageComplete = ctx.task.taskId
      ? state.operationLog.some(op => op.resultSummary?.action === 'organizeKnowledge' && op.resultSummary.taskId === ctx.task.taskId)
      : Boolean(state.knowledgeSynthesisAt && state.knowledgeSynthesisAt >= ctx.task.createdAt);
  }

  const completedCards = pages.reduce((n, p) => n + (state.cards || []).filter(c => c.pageId === p.pageId).length, 0);
  return {
    taskVersion: ctx.task.version || 1,
    taskId: ctx.task.taskId || path.basename(ctx.taskFile, '.json'),
    batchId: ctx.batchId,
    scope: ctx.global ? 'knowledge' : 'batch',
    stage: ctx.task.stage,
    phase,
    revision: state.revision,
    totalPages: pages.length,
    pendingPages,
    totalRegions,
    pendingRegions,
    completedCards,
    partitionedPages: pages.length - pendingPages,
    synthesisComplete: Boolean(state.synthesis?.completedAt),
    stageComplete,
    complete: ctx.task.stage === 'recognition' || ctx.global ? stageComplete : phase === 'completed',
    status: stageComplete ? 'stage_complete' : 'pending',
    checkedAt: Date.now()
  };
}

function status(taskFile) {
  const ctx = context(taskFile), result = report(ctx);
  const progress = auxiliary(ctx, 'progress');
  withWorkspaceLock(progress + '.guard', () => {
    let old;
    try { old = readJson(progress); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!old || old.revision <= result.revision) writeJson(progress, result);
  });
  return result;
}

function assetFile(value, root) {
  if (!root || typeof value !== 'string' || !value.startsWith('app://local/')) return value;
  const file = path.resolve(root, value.slice(12));
  const relative = path.relative(root, file);
  return relative.startsWith('..') || path.isAbsolute(relative) ? null : file;
}

function pageTarget(page, root) {
  const imagePath = assetFile(page.pageAssetUrl, root) || page.imagePath;
  const svgPreviewPath = assetFile(page.svgPreviewPath, root);
  return {
    pageId: page.pageId,
    title: page.title,
    imagePath,
    previewImagePath: svgPreviewPath || imagePath,
    originalImagePath: page.imagePath,
    pageAssetUrl: page.pageAssetUrl,
    width: page.width,
    height: page.height,
    rotation: page.rotation,
    svgPreviewPath,
    svgPreviewUrl: page.svgPreviewPath,
    existingRegions: (page.regions || []).map(({ cropSvg, ...r }) => r),
    corrections: page.corrections
  };
}

function targetResult(state, selection, root, taskId) {
  const { phase, page, region, regions, reprocess = false } = selection;
  const base = { phase, status: 'ready', revision: state.revision, reprocess };

  if (phase === 'page_partition') {
    return {
      ...base,
      target: pageTarget(page, root),
      instruction: '忠实观察原图并分区，不解释或补写。重新画框必须保留已有regionId或显式regionIdMap。',
      schemaExample: {
        phase,
        pageId: page.pageId,
        pageSummary: '实际可见内容',
        regions: page.regions?.length ? page.regions : [{ regionId: page.pageId + '-r1', kind: '笔记', bbox: { x: 0.05, y: 0.05, w: 0.9, h: 0.4 } }],
        reprocess,
        expectedRevision: state.revision,
        operationId: '稳定且唯一的操作ID'
      }
    };
  }

  if (phase === 'page_card_fill') {
    const targetRegions = regions || page.regions || [];
    const enrichedRegions = targetRegions.map((reg, idx) => {
      const copy = {
        ...reg,
        regionIndex: idx + 1,
        positionHint: computePositionHint(reg.bbox, idx),
        redPenHint: reg.redPenHint || reg.aiHint || '',
        aiHint: reg.aiHint || reg.redPenHint || '',
        cropFile: assetFile(reg.cropPath, root)
      };
      delete copy.cropSvg;
      return copy;
    });

    const drafts = ensurePageDrafts(root, taskId || 'task', page, enrichedRegions, reprocess, state.revision);

    return {
      ...base,
      target: {
        ...pageTarget(page, root),
        annotatedSvgPath: drafts.annotatedSvgPath,
        draftFile: drafts.draftFile,
        regions: enrichedRegions,
        count: enrichedRegions.length
      },
      instruction: '【整页上下文识别】AI 必须观察同一张完整原纸图像（结合各框选编号与坐标方位）来识别内容、把握整页上下文及同页各框选之间的关联。原纸上的红笔内容（或分区上的 redPenHint/aiHint）作为给 AI 的提示词（无红笔提示时留空 ""，绝不强行推理或编造）。为了节省 Token，请在处理完本页所有框选后按页提交（page_card_fill）。亦可直接读取并提交 draftFile。',
      schemaExample: {
        phase: 'page_card_fill',
        pageId: page.pageId,
        pageSummary: page.pageSummary || '本页整体内容摘要',
        cards: enrichedRegions.map((r) => ({
          regionId: r.regionId,
          title: r.label || `笔记区 #${r.regionIndex}`,
          editableContent: '逐字转录此区域文字/公式',
          structureBlocks: [{ kind: 'text', text: '逐字转录' }],
          intraPageLinks: [],
          crossPageHypotheses: [],
          redPenHint: r.redPenHint || r.aiHint || '',
          aiHint: r.aiHint || r.redPenHint || '',
          figureInfo: { enabled: false, redrawMode: 'keep_crop' }
        })),
        reprocess,
        expectedRevision: state.revision,
        operationId: `${taskId || 'task'}-${page.pageId}-${Date.now()}`
      }
    };
  }

  if (phase === 'region_card_fill') {
    const rawCard = state.cards.find(c => c.pageId === page.pageId && c.regionId === region.regionId);
    let existingCard = rawCard;
    if (rawCard && rawCard.figureInfo) {
      const { cropSvg, redrawSvg, vectorPreview, ...cleanFigure } = rawCard.figureInfo;
      existingCard = { ...rawCard, figureInfo: cleanFigure };
    }
    return {
      ...base,
      target: {
        ...pageTarget(page, root),
        regionId: region.regionId,
        kind: region.kind,
        bbox: region.bbox,
        points: region.points,
        polygon: region.polygon,
        cropPath: region.cropPath,
        cropFile: assetFile(region.cropPath, root),
        corrections: region.corrections,
        card: existingCard,
        existingCard
      },
      instruction: '只忠实转录文字、公式与排版。无法辨认标记，不推理，不理解图形保留原截图。原纸红笔内容或 redPenHint 作为给 AI 的提示词（无红笔提示留空 ""）。无证据关联用空数组。',
      schemaExample: {
        phase,
        pageId: page.pageId,
        regionId: region.regionId,
        title: region.label || '原文笔记',
        editableContent: '逐字转录',
        structureBlocks: [{ kind: 'text', text: '逐字转录' }],
        intraPageLinks: [],
        crossPageHypotheses: [],
        redPenHint: region.redPenHint || region.aiHint || '',
        aiHint: region.aiHint || region.redPenHint || '',
        figureInfo: { enabled: false, redrawMode: 'keep_crop' },
        reprocess,
        expectedRevision: state.revision,
        operationId: '稳定且唯一的操作ID'
      }
    };
  }

  const cards = state.cards.map(({ figureInfo, ...card }) => ({
    ...card,
    figureInfo: figureInfo ? { enabled: figureInfo.enabled, cropPath: figureInfo.cropPath } : null
  }));
  return {
    ...base,
    target: {
      cardIds: cards.map(c => c.cardId),
      cardsSummary: cards,
      collectedIntraLinks: cards.flatMap(c => (c.intraPageLinks || []).map(l => ({ fromCardId: c.cardId, ...l }))),
      collectedCrossPageHypotheses: cards.flatMap(c => (c.crossPageHypotheses || []).map(l => ({ fromCardId: c.cardId, ...l })))
    },
    schemaExample: {
      phase: 'global_synthesis',
      relations: [],
      problemTrees: [],
      canvasLayout: cards.map((c, i) => ({ cardId: c.cardId, x: 80 + (i % 4) * 240, y: 80 + Math.floor(i / 4) * 180 })),
      taxonomyAssignments: cards.map(c => ({ cardId: c.cardId, subject: c.subject || '未分类', course: c.course || '未分类', chapter: c.chapter || '未分类', tags: c.tags || [] })),
      expectedRevision: state.revision,
      operationId: '稳定且唯一的操作ID'
    }
  };
}

function next(taskFile) {
  const ctx = context(taskFile), state = scoped(ctx), summary = report(ctx);
  if (summary.stageComplete || summary.complete) return summary;
  if (ctx.global) {
    return {
      phase: 'knowledge_synthesis',
      status: 'ready',
      revision: state.revision,
      target: {
        cards: state.cards.map(({ figureInfo, ...card }) => ({ ...card, figureInfo: figureInfo ? { cropPath: figureInfo.cropPath } : null })),
        canvases: state.canvases.filter(c => c.scope === 'knowledge'),
        relations: state.knowledgeRelations,
        batchRelations: state.batches.flatMap(b => b.synthesis?.relations || [])
      },
      schemaExample: {
        phase: 'knowledge_synthesis',
        taxonomyAssignments: [],
        canvases: [],
        relations: [],
        expectedRevision: state.revision,
        operationId: '稳定且唯一的操作ID'
      }
    };
  }

  const taskOpts = {
    autoPartition: Boolean(ctx.task.autoPartition),
    singleRegion: Boolean(ctx.task.singleRegion),
    allowPartitionFix: Boolean(ctx.task.allowPartitionFix),
    targetPageIds: Array.isArray(ctx.task.targetPageIds) ? ctx.task.targetPageIds : null
  };

  let selection;
  if (ctx.task.stage === 'recognition') {
    selection = recognitionTarget(state, ctx.task.correctionOnly, taskOpts);
  } else {
    if (ctx.task.stage && ctx.task.stage !== summary.phase) throw failure('需先完成前置阶段 ' + summary.phase, 'PREREQUISITE_PENDING');
    if (summary.phase === 'page_partition') {
      selection = { phase: summary.phase, page: state.pages.find(p => !p.partitionedAt || !p.regions?.length) };
    } else if (summary.phase === 'region_card_fill') {
      // 旧兼容模式：逐区返回
      const seen = new Set(state.cards.map(c => c.pageId + '::' + c.regionId));
      for (const page of state.pages) {
        const region = page.regions.find(r => !seen.has(page.pageId + '::' + r.regionId));
        if (region) { selection = { phase: summary.phase, page, region }; break; }
      }
    } else {
      selection = { phase: summary.phase };
    }
  }

  if (!selection?.page && selection?.phase !== 'global_synthesis') return { ...summary, status: 'waiting_for_pages' };
  return { ...targetResult(state, selection, ctx.ws.rootDir, ctx.task.taskId), taskId: summary.taskId, batchId: ctx.batchId };
}

function currentLease(ctx) {
  try { return readJson(auxiliary(ctx, 'lease')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function verifyLease(ctx, payload) {
  const lease = currentLease(ctx);
  if (lease?.expiresAt > Date.now() && (lease.leaseId ? lease.leaseId !== payload.leaseId : lease.holder !== (payload.agentId || process.env.PAPERCARD_AGENT_ID))) {
    throw failure('此任务已有其他worker租约；提供自己的agentId或leaseId', 'LEASE_HELD', true);
  }
}

function commit(taskFile, value, extra) {
  const ctx = context(taskFile), payload = parsePayload(value, extra);
  const apply = () => {
    verifyLease(ctx, payload);
    const state = scoped(ctx);
    if (payload.operationId && state.operationLog?.some(op => op.operationId === payload.operationId && (!ctx.batchId || op.batchId === ctx.batchId))) return;
    contracts.validateRevisionConflict(state.revision, payload.expectedRevision);

    if (ctx.global) {
      ctx.ws.organizeKnowledge({ ...payload, taskId: ctx.task.taskId, operationId: payload.operationId || ctx.task.taskId + ':knowledge' });
      return;
    }

    // 格式 2: 多页批量提交 Array.isArray(payload.pages)
    if (Array.isArray(payload.pages)) {
      for (const [idx, pagePayload] of payload.pages.entries()) {
        ctx.ws.savePageCards({
          ...pagePayload,
          reprocess: payload.reprocess || pagePayload.reprocess,
          agentId: payload.agentId,
          leaseId: payload.leaseId,
          expectedRevision: idx === 0 ? payload.expectedRevision : undefined,
          operationId: payload.operationId ? `${payload.operationId}:${pagePayload.pageId}` : undefined
        });
      }
      return;
    }

    const taskOpts = {
      autoPartition: Boolean(ctx.task.autoPartition),
      singleRegion: Boolean(ctx.task.singleRegion),
      allowPartitionFix: Boolean(ctx.task.allowPartitionFix),
      targetPageIds: Array.isArray(ctx.task.targetPageIds) ? ctx.task.targetPageIds : null
    };
    const step = ctx.task.stage === 'recognition' ? recognitionTarget(state, ctx.task.correctionOnly, taskOpts) : null;
    const phase = step?.phase || contracts.computeTaskPhase(state, { autoPartition: Boolean(ctx.task.autoPartition) });

    if (ctx.task.stage === 'recognition' && !step) throw failure('识别已完成；重处理请先标记纠错', 'STAGE_COMPLETE');

    // 格式 1: 整页提交 (page_card_fill 或 Array.isArray(payload.cards))
    if (payload.phase === 'page_card_fill' || Array.isArray(payload.cards)) {
      const validPage = state.pages.find(p => p.pageId === payload.pageId);
      if (!validPage || (payload.strictTarget && step && payload.pageId !== step.page.pageId)) {
        throw failure('提交目标与next返回目标不一致，请重新next', 'TARGET_MISMATCH', true);
      }
      ctx.ws.savePageCards(payload);
      return;
    }

    // 格式 3: 单框提交 (region_card_fill) 或其他阶段
    if (payload.phase && payload.phase !== phase && !(phase === 'page_card_fill' && payload.phase === 'region_card_fill')) {
      throw failure('提交阶段应为 ' + phase, 'PHASE_MISMATCH');
    }
    if (step && (payload.pageId !== step.page.pageId || (step.region && payload.regionId !== step.region.regionId))) {
      throw failure('提交目标与next返回目标不一致，请重新next', 'TARGET_MISMATCH', true);
    }
    if (step?.reprocess && payload.reprocess !== true) {
      throw failure('纠错提交需reprocess:true以保留原卡片', 'REPROCESS_REQUIRED');
    }

    if (phase === 'page_partition' || payload.phase === 'page_partition') {
      if (typeof payload.pageSummary !== 'string' || !payload.pageSummary.trim() || !payload.regions?.length) {
        throw failure('需非空pageSummary与至少一个region', 'INVALID_PAYLOAD');
      }
      if (payload.editableContent !== undefined || payload.relations || payload.canvasLayout) {
        throw failure('分区阶段不能提交卡片或整理', 'PHASE_MISMATCH');
      }
      ctx.ws.savePagePartition(payload);
    } else if (phase === 'region_card_fill' || phase === 'page_card_fill' || payload.phase === 'region_card_fill') {
      if (payload.relations || payload.problemTrees || payload.canvasLayout || payload.taxonomyAssignments) {
        throw failure('填写阶段不能提前整理', 'PHASE_MISMATCH');
      }
      ctx.ws.saveRegionCard(payload);
    } else if (phase === 'global_synthesis' || phase === 'completed') {
      ctx.ws.saveGlobalSynthesis(payload);
    }
  };

  if (ctx.global) ctx.ws.transaction(apply);
  else ctx.ws.runInBatch(ctx.batchId, apply, { mode: ctx.task.stage });

  const summary = status(ctx.taskFile);
  const nextStep = next(ctx.taskFile);
  return { ok: true, pageId: payload.pageId, ...summary, next: nextStep };
}

function claim(taskFile, agentId = 'agent-' + crypto.randomUUID(), leaseId) {
  const ctx = context(taskFile), file = auxiliary(ctx, 'lease');
  return withWorkspaceLock(file + '.guard', () => {
    const existing = currentLease(ctx);
    if (existing?.expiresAt > Date.now() && (!leaseId || existing.leaseId !== leaseId || existing.holder !== agentId)) {
      throw failure('该任务被其他worker占用', 'LEASE_HELD', true);
    }
    const lease = {
      holder: agentId,
      agentId,
      leaseId: existing?.holder === agentId ? existing.leaseId : crypto.randomUUID(),
      claimedAt: existing?.holder === agentId ? existing.claimedAt : Date.now(),
      expiresAt: Date.now() + 15 * 60 * 1000,
      taskFile: ctx.taskFile
    };
    writeJson(file, lease);
    return { ok: true, lease, next: next(taskFile) };
  });
}

function renew(taskFile, agentId, leaseId) {
  if (!agentId) throw failure('renew需agentId', 'AGENT_ID_REQUIRED');
  const ctx = context(taskFile);
  if (!leaseId) {
    const existing = currentLease(ctx);
    if (existing?.holder === agentId) leaseId = existing.leaseId;
    else throw failure('renew需agentId和leaseId', 'AGENT_ID_REQUIRED');
  }
  return claim(taskFile, agentId, leaseId);
}

function release(taskFile, agentId, leaseId) {
  const ctx = context(taskFile), file = auxiliary(ctx, 'lease');
  return withWorkspaceLock(file + '.guard', () => {
    const lease = currentLease(ctx);
    if (lease?.expiresAt > Date.now() && agentId && ((lease.holder !== agentId && lease.holder !== process.env.PAPERCARD_AGENT_ID) || (lease.leaseId && leaseId && lease.leaseId !== leaseId))) {
      throw failure('不能释放其他worker的有效租约', 'LEASE_HELD', true);
    }
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true, released: true };
  });
}

function taskMutation(taskFile, value, method) {
  const ctx = context(taskFile), payload = parsePayload(value);
  if (ctx.global) throw failure('此操作需要批次任务', 'SCOPE_MISMATCH');
  return ctx.ws.runInBatch(ctx.batchId, () => {
    verifyLease(ctx, payload);
    return ctx.ws[method](payload);
  }, { mode: ctx.task.stage });
}

function cropRegion(taskFile, payload) { return taskMutation(taskFile, payload, 'cropRegion'); }
function split(taskFile, payload) { return taskMutation(taskFile, payload, 'splitCard'); }
function merge(taskFile, payload) { return taskMutation(taskFile, payload, 'mergeCards'); }

function rerecognize(taskFile, value) {
  const ctx = context(taskFile), payload = parsePayload(value);
  if (payload.reprocess !== true) throw failure('需显式reprocess:true', 'REPROCESS_REQUIRED');
  const state = scoped(ctx), page = state.pages.find(p => p.pageId === payload.pageId);
  if (!page) throw failure('页面不属于任务批次', 'SCOPE_MISMATCH');
  if (payload.editableContent !== undefined || payload.regions) return taskMutation(taskFile, payload, payload.regions ? 'savePagePartition' : 'saveRegionCard');
  const region = payload.regionId ? page.regions.find(r => r.regionId === payload.regionId) : null;
  if (payload.regionId && !region) throw failure('分区不存在', 'REGION_NOT_FOUND');
  return targetResult(state, { phase: region ? 'region_card_fill' : 'page_partition', page, region, reprocess: true }, ctx.ws.rootDir, ctx.task.taskId);
}

function knowledge(taskFile, value) {
  const ctx = context(taskFile);
  if (!ctx.global) throw failure('需知识库scope任务', 'SCOPE_MISMATCH');
  return ctx.ws.organizeKnowledge({ ...parsePayload(value), taskId: ctx.task.taskId });
}

function prepare(taskFile) {
  const ctx = context(taskFile);
  const state = scoped(ctx);
  const targetPageIds = Array.isArray(ctx.task.targetPageIds) ? ctx.task.targetPageIds : null;
  const pages = targetPageIds ? state.pages.filter(p => targetPageIds.includes(p.pageId)) : state.pages;

  const existing = new Set(state.cards.map(c => c.pageId + '::' + c.regionId));
  const pendingPages = [];

  for (const page of pages) {
    const regions = page.regions || [];
    if (!regions.length) continue;
    const pageFix = unresolved(page);
    let targetRegions = [];
    let reprocess = false;

    if (pageFix || (targetPageIds && targetPageIds.includes(page.pageId) && ctx.task.correctionOnly)) {
      targetRegions = regions;
      reprocess = true;
    } else {
      for (const region of regions) {
        if (unresolved(region)) {
          targetRegions.push(region);
          reprocess = true;
        } else if (!ctx.task.correctionOnly && !existing.has(page.pageId + '::' + region.regionId)) {
          targetRegions.push(region);
        }
      }
    }

    if (targetRegions.length > 0) {
      const enrichedRegions = targetRegions.map((reg, idx) => ({
        ...reg,
        regionIndex: idx + 1,
        positionHint: computePositionHint(reg.bbox, idx),
        redPenHint: reg.redPenHint || reg.aiHint || '',
        aiHint: reg.aiHint || reg.redPenHint || '',
        cropFile: assetFile(reg.cropPath, ctx.ws.rootDir)
      }));
      const drafts = ensurePageDrafts(ctx.ws.rootDir, ctx.task.taskId || 'task', page, enrichedRegions, reprocess, state.revision);
      pendingPages.push({
        pageId: page.pageId,
        title: page.title,
        imagePath: assetFile(page.pageAssetUrl, ctx.ws.rootDir) || page.imagePath,
        annotatedSvgPath: drafts.annotatedSvgPath,
        draftFile: drafts.draftFile,
        reprocess,
        regionsCount: enrichedRegions.length,
        regions: enrichedRegions
      });
    }
  }

  return {
    ok: true,
    taskId: ctx.task.taskId,
    batchId: ctx.batchId,
    scope: ctx.global ? 'knowledge' : 'batch',
    revision: state.revision,
    totalPendingPages: pendingPages.length,
    pendingPageCount: pendingPages.length,
    pendingPagesCount: pendingPages.length,
    totalPages: pendingPages.length,
    pages: pendingPages,
    pendingPages
  };
}

function bind(taskPath, batchId) {
  let file = path.resolve(taskPath);
  if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.json');
  let task = readJson(file);
  if (task.taskFile && task.shortcut) { file = task.taskFile; task = readJson(file); }
  const ws = createWorkspaceStore(task.workspaceRoot);
  if (!ws.getState().batches.some(b => b.batchId === batchId)) throw failure('批次不存在', 'BATCH_NOT_FOUND');
  if (task.batchId && task.batchId !== batchId) throw failure('不能重绑定不可变任务', 'SCOPE_MISMATCH');
  const bindingFile = file + '.binding.json';
  if (fs.existsSync(bindingFile) && readJson(bindingFile).batchId !== batchId) throw failure('任务已绑定其他批次', 'SCOPE_MISMATCH');
  if (!fs.existsSync(bindingFile)) fs.writeFileSync(bindingFile, JSON.stringify({ batchId, createdAt: Date.now() }), { flag: 'wx' });
  return { ok: true, batchId, taskFile: file };
}

function resetDemo() {
  throw failure('任务工具不允许重置整个工作区，请从界面显式操作', 'SCOPE_MISMATCH');
}

module.exports = {
  status,
  next,
  commit,
  cropRegion,
  claim,
  renew,
  release,
  split,
  merge,
  rerecognize,
  knowledge,
  resetDemo,
  bind,
  prepare,
  bundle: prepare,
  recognitionTarget
};

if (require.main === module) {
  try {
    const [op, file, arg1, arg2] = process.argv.slice(2);
    const methods = {
      status,
      next,
      commit,
      claim,
      renew,
      release,
      split,
      merge,
      rerecognize,
      knowledge,
      bind,
      prepare,
      bundle: prepare,
      'reset-demo': resetDemo
    };
    let result;
    if (op === 'crop') result = cropRegion(file, { pageId: arg1, regionId: arg2 });
    else if (methods[op]) result = methods[op](file, arg1, arg2);
    else throw failure('用法: noteTasks.js <status|next|commit|claim|renew|release|crop|split|merge|rerecognize|knowledge|prepare|bundle> <taskFile> [JSON/文件/agentId]', 'INVALID_COMMAND');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (op === 'status' && result.taskVersion < 3 && !result.complete && !result.stageComplete) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, error: error.message, code: error.code || 'INVALID_PAYLOAD', retryable: Boolean(error.retryable || error.code === 'REVISION_CONFLICT'), currentRevision: error.currentRevision }) + '\n');
    process.exitCode = 1;
  }
}
