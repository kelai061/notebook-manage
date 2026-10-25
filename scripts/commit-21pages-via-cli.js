'use strict';
/**
 * commit-21pages-via-cli.js
 * 驱动本地 CLI 工具 (src/cli/noteTasks.js) 对 21 页真实手写笔记测试集执行完整三阶段闭环测试：
 * Phase 1: page_partition (21 页逐页分区 + 71 个区域原纸切片 crop)
 * Phase 2: region_card_fill (71 张可编辑卡片逐卡提交)
 * Phase 3: global_synthesis (跨页关联、题解结构树、学科分类与 2D 画布坐标合成)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createWorkspaceStore } = require('../src/main/store');
const { generateAgentTaskPrompt } = require('../src/main/agentPrompt');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WS_ROOT = path.join(PROJECT_ROOT, 'workspace');
const CLI_PATH = path.join(PROJECT_ROOT, 'src', 'cli', 'noteTasks.js');
const TASKS_DIR = path.join(WS_ROOT, 'agent-tasks');

function runCli(args) {
  const out = execFileSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  return JSON.parse(out);
}

function main() {
  // 1. 读取 3 个子智能体生成的批次识别数据
  const b1 = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, 'batch-p01-p07.json'), 'utf8'));
  const b2 = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, 'batch-p08-p14.json'), 'utf8'));
  const b3 = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, 'batch-p15-p21.json'), 'utf8'));

  const allBatchPages = [...b1.pages, ...b2.pages, ...b3.pages];
  console.log(`[CLI Test] Loaded ${allBatchPages.length} pages from 3 subagent batches.`);

  // 2. 重新初始化工作区中的 21 页原纸并生成任务索引文件
  const pagesDir = path.join(WS_ROOT, 'pages');
  const srcDir = process.env.HANDWRITTEN_PAGES_SRC_DIR || path.join(PROJECT_ROOT, 'fixtures', 'sample-pages');
  const origFiles = fs.existsSync(srcDir)
    ? fs.readdirSync(srcDir).filter((f) => f.endsWith('.jpg')).sort()
    : allBatchPages.map((_, i) => `IMG_Page_${String(i + 1).padStart(2, '0')}.jpg`);

  const store = createWorkspaceStore(WS_ROOT);
  const inputFiles = allBatchPages.map((p) => path.join(pagesDir, `${p.pageId}.jpg`));
  store.importLocalFiles(inputFiles, { clearExisting: true, useSequentialIds: true, autoRotatePortrait: true });

  const state0 = store.getState();
  state0.pages.forEach((p, idx) => {
    p.title = path.basename(origFiles[idx] || p.pageId, '.jpg');
  });
  store.saveState(state0);

  const { taskIndexFile } = generateAgentTaskPrompt({ store, cliPath: CLI_PATH });
  console.log(`[CLI Test] Generated taskIndexFile: ${taskIndexFile}`);

  // 3. 认领 CLI 租约
  const claimRes = runCli(['claim', taskIndexFile, 'subagent-21pages-tester']);
  if (!claimRes.ok) throw new Error('CLI claim failed');

  // 4. Phase 1: 逐页提交 page_partition 并执行 crop
  let totalRegions = 0;
  for (const pageData of allBatchPages) {
    const nextStep = runCli(['next', taskIndexFile]);
    const targetPageId = nextStep.pageId || nextStep.target?.pageId;
    if (nextStep.phase !== 'page_partition' || targetPageId !== pageData.pageId) {
      throw new Error(`Expected page_partition for ${pageData.pageId}, got ${JSON.stringify(nextStep)}`);
    }

    const payloadFile = path.join(TASKS_DIR, `tmp-part-${pageData.pageId}.json`);
    fs.writeFileSync(
      payloadFile,
      JSON.stringify({
        phase: 'page_partition',
        pageId: pageData.pageId,
        pageSummary: pageData.pageSummary,
        regions: pageData.regions
      }, null, 2),
      'utf8'
    );
    const commitRes = runCli(['commit', taskIndexFile, payloadFile]);
    if (!commitRes.phase) throw new Error(`Failed page_partition for ${pageData.pageId}`);
    fs.unlinkSync(payloadFile);

    // 为该页每个分区生成原纸截图切片
    for (const reg of pageData.regions) {
      runCli(['crop', taskIndexFile, pageData.pageId, reg.regionId]);
      totalRegions += 1;
    }
  }
  console.log(`[CLI Test] Phase 1 (page_partition + crop) completed: 21 pages, ${totalRegions} regions.`);

  // 5. Phase 2: 逐个分区提交 region_card_fill
  const cardByKey = new Map();
  const allCards = [];
  for (const pageData of allBatchPages) {
    for (const card of pageData.cards) {
      cardByKey.set(`${ pageData.pageId }:${ card.regionId }`, card);
      allCards.push(card);
    }
  }

  let committedCards = 0;
  while (true) {
    const nextStep = runCli(['next', taskIndexFile]);
    if (nextStep.phase !== 'region_card_fill') {
      if (nextStep.phase === 'global_synthesis') break;
      throw new Error(`Unexpected phase during region_card_fill: ${JSON.stringify(nextStep)}`);
    }

    const stepPageId = nextStep.pageId || nextStep.target?.pageId;
    const stepRegionId = nextStep.regionId || nextStep.target?.regionId;
    const key = `${stepPageId}:${stepRegionId}`;
    const cardData = cardByKey.get(key);
    if (!cardData) {
      throw new Error(`Missing card data for ${key}`);
    }

    // 如果该卡片是 figure 且没有 customSvg，保留原纸 cropPath
    const figureInfo = cardData.figureInfo
      ? {
          ...cardData.figureInfo,
          cropPath: `crops/${stepRegionId}.svg`
        }
      : cardData.kind === 'figure'
      ? {
          hasFigure: true,
          redrawMode: 'keep_crop',
          cropPath: `crops/${stepRegionId}.svg`,
          redrawRule: '保留手写原纸截图'
        }
      : null;

    const payloadFile = path.join(TASKS_DIR, `tmp-card-${stepRegionId}.json`);
    fs.writeFileSync(
      payloadFile,
      JSON.stringify({
        phase: 'region_card_fill',
        cardId: cardData.cardId,
        pageId: stepPageId,
        regionId: stepRegionId,
        kind: cardData.kind,
        title: cardData.title,
        editableContent: cardData.editableContent,
        structureBlocks: cardData.structureBlocks || [{ kind: cardData.kind, text: cardData.editableContent }],
        figureInfo,
        intraPageLinks: cardData.intraPageLinks || [],
        crossPageHypotheses: cardData.crossPageHypotheses || [],
        subject: cardData.subject || '数学',
        course: cardData.course || '概率论与数理统计',
        chapter: cardData.chapter || '综合章节',
        contentType: cardData.contentType || '题解卡片',
        tags: cardData.tags || []
      }, null, 2),
      'utf8'
    );

    const commitRes = runCli(['commit', taskIndexFile, payloadFile]);
    if (!commitRes.phase) throw new Error(`Failed region_card_fill for ${key}`);
    fs.unlinkSync(payloadFile);
    committedCards += 1;
  }
  console.log(`[CLI Test] Phase 2 (region_card_fill) completed: ${committedCards} cards committed.`);

  // 6. Phase 3: 构建并提交 global_synthesis (题解树、跨页关联、画布双列/多列分簇布局、学科分类)
  const relations = [];
  // (a) 同页内顺序与关联推导边
  for (const pageData of allBatchPages) {
    const pCards = pageData.cards;
    for (let i = 1; i < pCards.length; i++) {
      relations.push({
        fromCardId: pCards[i].cardId,
        toCardId: pCards[0].cardId,
        type: pCards[i].kind === 'figure' ? 'figure_reference' : 'derivation_next',
        label: `${pageData.pageId} 同页推导/图文关联`
      });
    }
  }
  // (b) 跨页核心学科知识演进边
  const crossLinks = [
    { from: 'card-02-01', to: 'card-01-01', type: 'related_topic', label: '连续型密度归一化与分布函数推导脉络' },
    { from: 'card-04-01', to: 'card-03-04', type: 'cross_page_cont', label: '第8题双边指数分布跨页续解 (P3➔P4)' },
    { from: 'card-19-01', to: 'card-02-02', type: 'related_topic', label: '一维分布函数延伸至二维联合密度边缘分布 (P2➔P19)' },
    { from: 'card-09-03', to: 'card-05-02', type: 'cross_page_cont', label: '直流欧姆定律延伸至正弦交流相量法 (P5➔P9)' },
    { from: 'card-10-01', to: 'card-09-04', type: 'cross_page_cont', label: '交流瞬时/平均功率延伸至RLC复阻抗 (P9➔P10)' },
    { from: 'card-15-03', to: 'card-10-01', type: 'cross_page_cont', label: '单相RLC电路延伸至三相不对称负载计算 (P10➔P15)' },
    { from: 'card-17-01', to: 'card-07-01', type: 'related_topic', label: '稳恒磁场毕奥-萨伐尔定律延伸至回旋加速器洛伦兹力 (P7➔P17)' },
    { from: 'card-18-02', to: 'card-07-01', type: 'cross_page_cont', label: '长直导线磁通量延伸至矩形线框合安培力推导 (P7➔P18)' },
    { from: 'card-21-03', to: 'card-18-02', type: 'cross_page_cont', label: '长直导线矩形回路安培力延伸至互感磁通量与感生电动势 (P18➔P21)' },
    { from: 'card-06-04', to: 'card-04-03', type: 'thought_extension', label: '多Agent知识传递延伸至Graph of Thought网状推理 (P4➔P6)' },
    { from: 'card-13-02', to: 'card-06-04', type: 'thought_extension', label: '网状推理延伸至底模(Base Model)卫星认知架构 (P6➔P13)' },
    { from: 'card-16-03', to: 'card-15-02', type: 'cross_page_cont', label: '持续思考探索矩阵延伸至杨立昆JEPA世界模型 (P15➔P16)' },
    { from: 'card-19-02', to: 'card-16-01', type: 'thought_extension', label: 'LLM自回归延伸至启动更触发多Agent并行推理配比 (P16➔P19)' },
    { from: 'card-20-02', to: 'card-19-03', type: 'cross_page_cont', label: 'Agent生态接入树延伸至大项目Agent六维清单框架 (P19➔P20)' },
    { from: 'card-11-01', to: 'card-08-02', type: 'thought_extension', label: 'Bot情绪词库映射至真实量化心情日志表 (P8➔P11)' },
    { from: 'card-12-01', to: 'card-11-01', type: 'cross_page_cont', label: '量化心情日志表跨页续记 (P11➔P12)' }
  ];
  for (const link of crossLinks) {
    relations.push({
      fromCardId: link.from,
      toCardId: link.to,
      type: link.type,
      label: link.label
    });
  }

  // 构建 5 棵学科题解与思想结构树
  const classifyTreeIndex = (card) => {
    const text = `${card.subject} ${card.course} ${card.title}`;
    if (/概率|随机变量|正态|分布|指数/.test(text) && card.pageId !== 'page-16') return 0; // 概率论题解树
    if (/电路|电工|阻抗|三相|相量|欧姆|KCL/.test(text)) return 1; // 电工学与电路分析树
    if (/电磁|磁场|磁通|回旋|质子|电动势|安培|洛伦兹/.test(text)) return 2; // 大学物理电磁学树
    if (/Agent|LLM|JEPA|模型|底模|哈希|并行|清单|工具人|算力/.test(text)) return 3; // AI与Agent系统架构树
    return 4; // 个人随笔、心情日志与游戏设计树
  };

  const treeRoots = ['card-01-01', 'card-05-02', 'card-07-01', 'card-19-02', 'card-10-03'];
  const trees = treeRoots.map((rootId) => ({
    problemCardId: rootId,
    processCardIds: [],
    keyStepCardIds: [],
    figureCardIds: [],
    thoughtCardIds: []
  }));

  for (const card of allCards) {
    if (treeRoots.includes(card.cardId)) continue;
    const tIdx = classifyTreeIndex(card);
    const tree = trees[tIdx];
    if (card.kind === 'figure') tree.figureCardIds.push(card.cardId);
    else if (card.kind === 'key_step' || card.kind === 'formula_block') tree.keyStepCardIds.push(card.cardId);
    else if (card.kind === 'thought' || card.kind === 'article') tree.thoughtCardIds.push(card.cardId);
    else tree.processCardIds.push(card.cardId);
  }

  // 构建整洁的 5 列学科簇画布布局（按题解树分列，消除重叠）
  const canvasLayout = [];
  const clusterNames = ['prob-stat', 'circuit-eng', 'physics-em', 'ai-agent-arch', 'essay-mood-game'];
  trees.forEach((tree, colIdx) => {
    const orderedIds = [
      tree.problemCardId,
      ...tree.processCardIds,
      ...tree.keyStepCardIds,
      ...tree.figureCardIds,
      ...tree.thoughtCardIds
    ];
    orderedIds.forEach((cardId, rowIdx) => {
      canvasLayout.push({
        cardId,
        x: 80 + colIdx * 380,
        y: 80 + rowIdx * 240,
        w: 330,
        h: 200,
        cluster: clusterNames[colIdx]
      });
    });
  });

  const taxonomyAssignments = allCards.map((c) => ({
    cardId: c.cardId,
    subject: c.subject || '数学',
    course: c.course || '概率论与数理统计',
    chapter: c.chapter || '综合章节',
    contentType: c.contentType || '题解卡片',
    tags: c.tags || []
  }));

  const synthFile = path.join(TASKS_DIR, 'tmp-global-synthesis.json');
  fs.writeFileSync(
    synthFile,
    JSON.stringify({
      phase: 'global_synthesis',
      relations,
      problemTrees: trees,
      canvasLayout,
      taxonomyAssignments
    }, null, 2),
    'utf8'
  );

  const synthRes = runCli(['commit', taskIndexFile, synthFile]);
  if (synthRes.phase !== 'completed') throw new Error(`Failed global_synthesis commit: ${JSON.stringify(synthRes)}`);
  fs.unlinkSync(synthFile);

  runCli(['release', taskIndexFile]);
  const finalStatus = runCli(['status', taskIndexFile]);
  console.log('[CLI Test] Final CLI Status:', JSON.stringify(finalStatus));
}

main();
