'use strict';
/**
 * contract_workflow.test.js — 核心三步骤与 SkillAtelier 风格 CLI 状态机契约测试
 *
 * 由主智能体（Leader Agent）编写，定义项目的核心工作流交付标准：
 *   1. 导入纸张后，右上角按钮逻辑能生成包含 CLI 命令与任务索引的智能体提示词（对标 SkillAtelier）
 *   2. 外部 Agent 调用 CLI 工具时，严格遵循：
 *      逐页识别与分区 (page_partition) -> 逐个分区填写卡片与关联推测 (region_card_fill) ->
 *      所有卡片完成后最后处理全局关联、排布与学科分类 (global_synthesis)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const contracts = require('../src/shared/contracts');

test('契约层：阶段状态机必须严格遵循 分区 -> 逐卡填充 -> 全局关联排布与分类 的顺序', () => {
  // 空状态或存在未分区页面时，必须处于 PAGE_PARTITION
  const initialState = {
    pages: [
      { pageId: 'page-01', title: '高等数学手写笔记 P1', regions: [] },
      { pageId: 'page-02', title: '高等数学手写笔记 P2', regions: [] }
    ],
    cards: [],
    synthesis: null
  };
  assert.equal(contracts.computeTaskPhase(initialState), contracts.PHASES.PAGE_PARTITION);

  // 第 1 页已分区，但第 2 页未分区时，仍处于 PAGE_PARTITION
  initialState.pages[0].partitionedAt = Date.now();
  initialState.pages[0].regions = [
    { regionId: 'r-101', kind: 'problem', bbox: { x: 0.05, y: 0.05, w: 0.9, h: 0.25 } },
    { regionId: 'r-102', kind: 'process', bbox: { x: 0.05, y: 0.32, w: 0.9, h: 0.4 } }
  ];
  assert.equal(contracts.computeTaskPhase(initialState), contracts.PHASES.PAGE_PARTITION);

  // 所有页面均完成分区后，进入 REGION_CARD_FILL（逐个卡片填充内容与关联推测）
  initialState.pages[1].partitionedAt = Date.now();
  initialState.pages[1].regions = [
    { regionId: 'r-201', kind: 'key_step', bbox: { x: 0.06, y: 0.08, w: 0.88, h: 0.35 } }
  ];
  assert.equal(contracts.computeTaskPhase(initialState), contracts.PHASES.REGION_CARD_FILL);

  // 只填完部分分区的卡片时，仍处于 REGION_CARD_FILL，绝不能提前进入排布与分类
  initialState.cards.push({
    cardId: 'card-101',
    pageId: 'page-01',
    regionId: 'r-101',
    title: '极值与拐点综合题'
  });
  assert.equal(contracts.computeTaskPhase(initialState), contracts.PHASES.REGION_CARD_FILL);

  // 所有分区的卡片全部填完后，才进入最后阶段 GLOBAL_SYNTHESIS（关联确认、页面/画布排布、学科分类）
  initialState.cards.push(
    { cardId: 'card-102', pageId: 'page-01', regionId: 'r-102', title: '一阶导数驻点求解过程' },
    { cardId: 'card-201', pageId: 'page-02', regionId: 'r-201', title: '跨页二阶导数凹凸性关键判别' }
  );
  assert.equal(contracts.computeTaskPhase(initialState), contracts.PHASES.GLOBAL_SYNTHESIS);

  // 全局合成提交后，任务进入 COMPLETED
  initialState.synthesis = { completedAt: Date.now() };
  assert.equal(contracts.computeTaskPhase(initialState), contracts.PHASES.COMPLETED);
});

test('CLI 与提示词生成模块：对标 SkillAtelier 生成可复制提示词并支持分步 next/commit 闭环', async () => {
  const storePath = path.join(__dirname, '..', 'src', 'main', 'store.js');
  const promptPath = path.join(__dirname, '..', 'src', 'main', 'agentPrompt.js');
  const cliPath = path.join(__dirname, '..', 'src', 'cli', 'noteTasks.js');

  assert.ok(fs.existsSync(storePath), '缺少 src/main/store.js');
  assert.ok(fs.existsSync(promptPath), '缺少 src/main/agentPrompt.js');
  assert.ok(fs.existsSync(cliPath), '缺少 src/cli/noteTasks.js');

  const { createWorkspaceStore } = require(storePath);
  const { buildAgentInstruction } = require(promptPath);
  const noteTasks = require(cliPath);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-workflow-'));
  const ws = createWorkspaceStore(tmpDir);

  // 1. 导入两页手写纸张
  const p1 = ws.importPage({
    title: '微积分手写卷 P1',
    imagePath: 'sample://calculus-p1.svg',
    width: 1200,
    height: 1600
  });
  const p2 = ws.importPage({
    title: '微积分手写卷 P2（跨页续）',
    imagePath: 'sample://calculus-p2.svg',
    width: 1200,
    height: 1600
  });

  // 2. 点击右上角按钮触发提示词构建（参考 SkillAtelier directInstruction）
  const instruction = buildAgentInstruction(ws);
  assert.ok(instruction.text.includes('status'), '提示词应包含 status 命令说明');
  assert.ok(instruction.text.includes('next'), '提示词应包含 next 命令说明');
  assert.ok(instruction.text.includes('commit'), '提示词应包含 commit 命令说明');
  assert.ok(instruction.taskFile && fs.existsSync(instruction.taskFile), '应落盘生成任务索引文件');

  // 3. 外部 Agent 执行 next：第一步必须要求对第 1 页进行识别与分区 (page_partition)
  const step1 = noteTasks.next(instruction.taskFile);
  assert.equal(step1.phase, contracts.PHASES.PAGE_PARTITION);
  assert.equal(step1.target.pageId, p1.pageId);

  // 提交第 1 页分区
  noteTasks.commit(instruction.taskFile, {
    phase: contracts.PHASES.PAGE_PARTITION,
    pageId: p1.pageId,
    pageSummary: '包含一道曲率极值题及其前半部分求导过程与配图',
    regions: [
      { regionId: 'p1-r1', kind: 'problem', bbox: { x: 0.05, y: 0.04, w: 0.9, h: 0.2 }, label: '题干区' },
      { regionId: 'p1-r2', kind: 'figure', bbox: { x: 0.6, y: 0.26, w: 0.35, h: 0.25 }, label: '手绘函数草图' },
      { regionId: 'p1-r3', kind: 'process', bbox: { x: 0.05, y: 0.26, w: 0.52, h: 0.65 }, label: '求导推导上半部' }
    ]
  });

  // 下一步必须继续分区第 2 页
  const step2 = noteTasks.next(instruction.taskFile);
  assert.equal(step2.phase, contracts.PHASES.PAGE_PARTITION);
  assert.equal(step2.target.pageId, p2.pageId);

  noteTasks.commit(instruction.taskFile, {
    phase: contracts.PHASES.PAGE_PARTITION,
    pageId: p2.pageId,
    pageSummary: '承接上一页的二阶导数关键判定过程与课后思考总结',
    regions: [
      { regionId: 'p2-r1', kind: 'key_step', bbox: { x: 0.05, y: 0.05, w: 0.9, h: 0.45 }, label: '跨页关键推导步骤' },
      { regionId: 'p2-r2', kind: 'thought', bbox: { x: 0.05, y: 0.55, w: 0.9, h: 0.35 }, label: '解题反思批注' }
    ]
  });

  // 4. 所有页面完成分区后，next 必须逐个分区引导 Agent 填入可编辑卡片与关联推测
  const regionOrder = [];
  for (let i = 0; i < 5; i++) {
    const stepCard = noteTasks.next(instruction.taskFile);
    assert.equal(stepCard.phase, contracts.PHASES.REGION_CARD_FILL);
    regionOrder.push(`${stepCard.target.pageId}:${stepCard.target.regionId}`);

    noteTasks.commit(instruction.taskFile, {
      phase: contracts.PHASES.REGION_CARD_FILL,
      pageId: stepCard.target.pageId,
      regionId: stepCard.target.regionId,
      title: `卡片标题 ${stepCard.target.regionId}`,
      editableContent: `可编辑文本内容与公式 $f''(x) > 0$ (${stepCard.target.regionId})`,
      typography: { headingScale: 1.25, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
      structureBlocks: [
        { kind: stepCard.target.kind, text: `结构块正文 ${stepCard.target.regionId}`, latex: 'f(x)=x^3-3x' }
      ],
      figureInfo: stepCard.target.kind === 'figure'
        ? { cropPath: 'crops/p1-r2.svg', redrawMode: 'svg_redraw', redrawRule: '绘制三次函数极值点与切线水平示意' }
        : null,
      intraPageLinks: stepCard.target.regionId === 'p1-r3'
        ? [{ targetRegionId: 'p1-r1', type: 'belongs_to_problem', note: '归属第一题推导过程' }]
        : [],
      crossPageHypotheses: stepCard.target.regionId === 'p2-r1'
        ? [{ targetPageId: p1.pageId, targetRegionId: 'p1-r3', type: 'cross_page_cont', confidence: 0.96, reason: '承接 P1 末尾一阶导数结果继续求二阶导' }]
        : []
    });
  }
  assert.equal(regionOrder.length, 5);

  // 5. 所有卡片填完后，next 必须进入最后的 GLOBAL_SYNTHESIS（统一处理关联、排布与学科分类）
  const stepSynth = noteTasks.next(instruction.taskFile);
  assert.equal(stepSynth.phase, contracts.PHASES.GLOBAL_SYNTHESIS);

  const allCardIds = stepSynth.target.cardIds;
  assert.equal(allCardIds.length, 5);

  noteTasks.commit(instruction.taskFile, {
    phase: contracts.PHASES.GLOBAL_SYNTHESIS,
    relations: [
      { fromCardId: allCardIds[2], toCardId: allCardIds[0], type: 'belongs_to_problem', label: '过程归属题目' },
      { fromCardId: allCardIds[3], toCardId: allCardIds[2], type: 'cross_page_cont', label: '跨页推导续接' }
    ],
    problemTrees: [
      {
        problemCardId: allCardIds[0],
        processCardIds: [allCardIds[2]],
        keyStepCardIds: [allCardIds[3]],
        figureCardIds: [allCardIds[1]],
        thoughtCardIds: [allCardIds[4]]
      }
    ],
    canvasLayout: allCardIds.map((cid, idx) => ({
      cardId: cid,
      x: 80 + (idx % 3) * 340,
      y: 80 + Math.floor(idx / 3) * 260,
      w: 300,
      h: 220,
      cluster: 'problem-1'
    })),
    taxonomyAssignments: allCardIds.map((cid, idx) => ({
      cardId: cid,
      subject: '数学',
      course: '高等数学',
      chapter: '第三章 微分中值定理与导数的应用',
      contentType: idx === 4 ? '思考' : '题解卡片',
      tags: ['极值', '凹凸性', '跨页题解']
    }))
  });

  // 6. 最终 status 校验必须为 complete: true
  const finalStatus = noteTasks.status(instruction.taskFile);
  assert.equal(finalStatus.complete, true);
  assert.equal(finalStatus.phase, contracts.PHASES.COMPLETED);
});
