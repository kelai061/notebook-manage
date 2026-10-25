'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const contracts = require('../src/shared/contracts');
const { createWorkspaceStore } = require('../src/main/store');
const { buildAgentInstruction, generateAgentPrompt } = require('../src/main/agentPrompt');
const cli = require('../src/cli/noteTasks');

function createTempRoot(prefix = 'papercard-r8-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSampleImage(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64'));
}

test('Test 1 (R44 - 人工框选为主与全页上下文 + 红笔提示词)', (t) => {
  const root = createTempRoot('papercard-r8-t1-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const store = createWorkspaceStore(root);
  const img1 = path.join(root, 'page1.png');
  const img2 = path.join(root, 'page2.png');
  writeSampleImage(img1);
  writeSampleImage(img2);

  const [p1, p2] = store.importLocalFiles([img1, img2]);

  // 用户人工框选第 1 页的两个区域，其中一个包含红笔批注提示词
  store.savePagePartition({
    pageId: p1.pageId,
    pageSummary: '人工框选页',
    regions: [
      {
        regionId: 'r1',
        label: '推导步骤',
        kind: 'process',
        bbox: { x: 0.05, y: 0.05, w: 0.9, h: 0.4 },
        redPenHint: '注意第二行负号推导'
      },
      {
        regionId: 'r2',
        label: '最终结果',
        kind: 'formula_block',
        bbox: { x: 0.05, y: 0.5, w: 0.9, h: 0.45 }
      }
    ]
  });

  // 第 2 页保持空白（regions: []，用户尚未框选）
  const state = store.getState();
  const page1InState = state.pages.find((p) => p.pageId === p1.pageId);
  const page2InState = state.pages.find((p) => p.pageId === p2.pageId);
  assert.equal(page1InState.regions.length, 2);
  assert.equal(page2InState.regions.length, 0);

  // 1. 默认 recognition 模式 (autoPartition: false) 下，computeTaskPhase 直接进入填卡阶段
  const phaseDefault = contracts.computeTaskPhase(state);
  assert.equal(phaseDefault, contracts.PHASES.REGION_CARD_FILL, '空白页不阻塞已框选页，直接进入卡片填写阶段');

  // 2. 生成 recognition 阶段任务，验证空白页不触发 AI page_partition
  const task = buildAgentInstruction({ store, stage: 'recognition' });
  const nextTarget = cli.next(task.taskFile);

  assert.equal(nextTarget.phase, 'page_card_fill', '优先以整页卡片填写 page_card_fill 处理人工框选页');
  assert.equal(nextTarget.target.pageId, p1.pageId, '目标页面为用户已框选的第 1 页');

  // 3. 验证 next 返回完整原图、整页全部分区列表、每个分区的 positionHint 以及 redPenHint/aiHint
  assert.ok(path.isAbsolute(nextTarget.target.imagePath), '返回完整原图绝对路径');
  assert.ok(fs.existsSync(nextTarget.target.imagePath), '原图文件真实存在');
  assert.equal(nextTarget.target.regions.length, 2, '返回整页全部分区列表');

  const reg1 = nextTarget.target.regions[0];
  const reg2 = nextTarget.target.regions[1];

  assert.ok(typeof reg1.positionHint === 'string' && reg1.positionHint.length > 0, '包含 positionHint 坐标方位提示');
  assert.equal(reg1.redPenHint, '注意第二行负号推导', '包含红笔批注提示词');
  assert.equal(reg1.aiHint, '注意第二行负号推导');

  assert.ok(typeof reg2.positionHint === 'string' && reg2.positionHint.length > 0);
  assert.equal(reg2.redPenHint, '', '无红笔提示时必须为空字符串，不可为 undefined/null 或编造');
  assert.equal(reg2.aiHint, '');

  // 4. 提交第 1 页卡片后，由于第 2 页空白且 autoPartition 为 false，任务不会擅自给第 2 页画框
  cli.commit(task.taskFile, {
    phase: 'page_card_fill',
    pageId: p1.pageId,
    expectedRevision: nextTarget.revision,
    operationId: 'op-p1-fill',
    cards: [
      {
        regionId: 'r1',
        title: '推导步骤',
        editableContent: 'step 1 -> step 2'
      },
      {
        regionId: 'r2',
        title: '最终结果',
        editableContent: 'x = 42'
      }
    ]
  });

  const nextAfterP1 = cli.next(task.taskFile);
  assert.equal(nextAfterP1.stageComplete, true, '全部已框选页填完后 recognition 阶段即告完成，绝不擅自自动画框');
});

test('Test 2 (R45 - 笔记批次删除 deleteBatch 与单页删除/清空 deletePage)', (t) => {
  const root = createTempRoot('papercard-r8-t2-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const store = createWorkspaceStore(root);
  const img1 = path.join(root, 'page1.png');
  const img2 = path.join(root, 'page2.png');
  writeSampleImage(img1);
  writeSampleImage(img2);

  const [p1, p2] = store.importLocalFiles([img1, img2]);
  const batchId1 = p1.batchId;

  // 为 p1 填卡
  store.savePagePartition({
    pageId: p1.pageId,
    regions: [{ regionId: 'r1', kind: 'process', bbox: { x: 0, y: 0, w: 1, h: 0.5 } }]
  });
  store.savePageCards({
    pageId: p1.pageId,
    cards: [{ regionId: 'r1', title: '卡片 1', editableContent: '正文 1' }]
  });

  // 为 p2 填卡
  store.savePagePartition({
    pageId: p2.pageId,
    regions: [{ regionId: 'r2', kind: 'process', bbox: { x: 0, y: 0, w: 1, h: 0.5 } }]
  });
  store.savePageCards({
    pageId: p2.pageId,
    cards: [{ regionId: 'r2', title: '卡片 2', editableContent: '正文 2' }]
  });

  const card1 = store.getState().cards.find((c) => c.pageId === p1.pageId);
  const card2 = store.getState().cards.find((c) => c.pageId === p2.pageId);

  // 创建跨卡画布与关系
  store.saveCanvas({
    title: '测试画布',
    scope: 'batch',
    batchId: batchId1,
    cardIds: [card1.cardId, card2.cardId],
    layout: [{ cardId: card1.cardId, x: 10, y: 10 }, { cardId: card2.cardId, x: 200, y: 200 }]
  });
  store.saveKnowledgeRelations({
    relations: [{ fromCardId: card1.cardId, toCardId: card2.cardId, type: 'derived' }]
  });

  // Subtest 2a: deletePage(p1.pageId, { clearOnly: true })
  const clearRes = store.deletePage({ pageId: p1.pageId, clearOnly: true });
  assert.equal(clearRes.clearOnly, true);
  const stateAfterClear = store.getState();
  const clearedPage = stateAfterClear.pages.find((p) => p.pageId === p1.pageId);
  assert.ok(clearedPage, '保留原图页面实体');
  assert.equal(clearedPage.regions.length, 0, '清空本页全部框选');
  assert.equal(stateAfterClear.cards.some((c) => c.pageId === p1.pageId), false, '清空本页关联卡片');
  assert.ok(stateAfterClear.pages.some((p) => p.pageId === p2.pageId), '第 2 页完好保留');

  // Subtest 2b: deletePage(p2.pageId, { clearOnly: false })
  const deletePageRes = store.deletePage({ pageId: p2.pageId, clearOnly: false });
  assert.equal(deletePageRes.clearOnly, false);
  const stateAfterDelPage = store.getState();
  assert.equal(stateAfterDelPage.pages.some((p) => p.pageId === p2.pageId), false, '彻底移除页面');
  assert.equal(stateAfterDelPage.cards.some((c) => c.pageId === p2.pageId), false, '彻底移除卡片');
  assert.equal(stateAfterDelPage.knowledgeRelations.length, 0, '关系引用已级联移除');
  const canvas = stateAfterDelPage.canvases[0];
  assert.equal(canvas.cardIds.includes(card2.cardId), false, '画布内卡片引用已移除');

  // Subtest 2c: deleteBatch(batchId)
  // 创建第二个批次
  const batch2 = store.newBatch({ title: '第二笔记' });
  store.importPage({ title: 'page3' });

  // 删除 batchId1
  const delBatchRes = store.deleteBatch({ batchId: batchId1 });
  assert.equal(delBatchRes.deletedBatchId, batchId1);
  const stateAfterDelBatch = store.getState();
  assert.equal(stateAfterDelBatch.batches.some((b) => b.batchId === batchId1), false, '彻底移除该笔记批次');
  assert.equal(stateAfterDelBatch.activeBatchId, batch2.batchId, '激活批次自动切换到剩余批次');

  // 删除最后一个批次 (batch2.batchId)
  store.deleteBatch({ batchId: batch2.batchId });
  const finalState = store.getState();
  assert.equal(finalState.batches.length, 1, '删除最后一个批次后自动创建默认空批次');
  assert.equal(finalState.batches[0].title, '新的笔记');
  assert.equal(finalState.pages.length, 0);
  assert.equal(finalState.cards.length, 0);
});

test('Test 3 (R46 - 单页标记与「修改」按钮重处理工作流)', (t) => {
  const root = createTempRoot('papercard-r8-t3-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const store = createWorkspaceStore(root);
  const img1 = path.join(root, 'page1.png');
  writeSampleImage(img1);
  const [p1] = store.importLocalFiles([img1]);

  store.savePagePartition({
    pageId: p1.pageId,
    regions: [
      { regionId: 'r1', kind: 'process', bbox: { x: 0, y: 0, w: 1, h: 0.5 } },
      { regionId: 'r2', kind: 'thought', bbox: { x: 0, y: 0.5, w: 1, h: 0.5 } }
    ]
  });
  store.savePageCards({
    pageId: p1.pageId,
    cards: [
      { regionId: 'r1', title: '推导 1', editableContent: 'content 1' },
      { regionId: 'r2', title: '思考 2', editableContent: 'content 2' }
    ]
  });

  // 1. 调用 requestCorrection 标记页面
  const correction = store.requestCorrection({
    pageId: p1.pageId,
    kind: 'content',
    reason: '第二公式符号有误，请重新识别',
    redPenHint: '注意第二行负号'
  });

  assert.equal(correction.kind, 'content');
  assert.equal(correction.resolvedAt, null);
  assert.equal(correction.reason, '第二公式符号有误，请重新识别');
  assert.equal(correction.redPenHint, '注意第二行负号');

  const pageAfterFlag = store.getState().pages.find((p) => p.pageId === p1.pageId);
  assert.equal(pageAfterFlag.regions.length, 2, '待修改状态不会破坏已有框选');

  // 2. 调用 generateAgentPrompt 生成针对该页的修改提示词与任务
  const instruction = generateAgentPrompt(store, 'recognition', {
    mode: 'modify',
    correctionOnly: true,
    pageId: p1.pageId
  });

  assert.ok(instruction.promptText.includes('指定页面修改/重处理任务') || instruction.promptText.includes(p1.pageId), '提示词包含修改模式与目标页面说明');
  const taskData = JSON.parse(fs.readFileSync(instruction.taskFile, 'utf8'));
  assert.deepEqual(taskData.targetPageIds, [p1.pageId]);
  assert.equal(taskData.correctionOnly, true);

  // 3. 验证 next 返回 reprocess: true 且保留已有卡片结构
  const nextTarget = cli.next(instruction.taskFile);
  assert.equal(nextTarget.phase, 'page_card_fill');
  assert.equal(nextTarget.reprocess, true);

  // 4. 整页保存后自动解除纠错状态
  store.savePageCards({
    pageId: p1.pageId,
    cards: [
      { regionId: 'r1', title: '推导 1 (已修改)', editableContent: 'content 1 fixed with minus sign' },
      { regionId: 'r2', title: '思考 2', editableContent: 'content 2' }
    ]
  });

  const pageAfterSave = store.getState().pages.find((p) => p.pageId === p1.pageId);
  assert.ok(pageAfterSave.corrections.resolvedAt > 0, '保存整页卡片后自动解除纠错状态');
});

test('Test 4 (R47 - 整页卡片提交 page_card_fill / savePageCards 与向后兼容)', (t) => {
  const root = createTempRoot('papercard-r8-t4-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const store = createWorkspaceStore(root);
  const img1 = path.join(root, 'page1.png');
  const img2 = path.join(root, 'page2.png');
  writeSampleImage(img1);
  writeSampleImage(img2);
  const [p1, p2] = store.importLocalFiles([img1, img2]);

  store.savePagePartition({
    pageId: p1.pageId,
    regions: [
      { regionId: 'r1', kind: 'process', bbox: { x: 0, y: 0, w: 1, h: 0.3 } },
      { regionId: 'r2', kind: 'process', bbox: { x: 0, y: 0.3, w: 1, h: 0.3 } },
      { regionId: 'r3', kind: 'process', bbox: { x: 0, y: 0.6, w: 1, h: 0.3 } }
    ]
  });

  // 1. 验证 savePageCards 在单事务内一次性提交整页多个分区的卡片，revision 仅自增 1 次
  const revBefore = store.getState().revision;
  const saveRes = store.savePageCards({
    pageId: p1.pageId,
    expectedRevision: revBefore,
    cards: [
      { regionId: 'r1', title: '卡片 1', editableContent: '正文 1' },
      { regionId: 'r2', title: '卡片 2', editableContent: '正文 2' },
      { regionId: 'r3', title: '卡片 3', editableContent: '正文 3' }
    ]
  });

  assert.equal(saveRes.count, 3);
  const revAfter = store.getState().revision;
  assert.equal(revAfter, revBefore + 1, '整页提交单事务原子写入，revision 仅自增 1 次');
  assert.equal(store.getState().cards.filter((c) => c.pageId === p1.pageId).length, 3);

  // 2. 验证 CLI commit 对三种格式的支持
  const p3 = store.importPage({ title: 'page3' });
  const p4 = store.importPage({ title: 'page4' });
  const p5 = store.importPage({ title: 'page5' });

  store.savePagePartition({
    pageId: p2.pageId,
    regions: [{ regionId: 'r4', kind: 'process', bbox: { x: 0, y: 0, w: 1, h: 0.5 } }]
  });
  store.savePagePartition({
    pageId: p3.pageId,
    regions: [{ regionId: 'r5', kind: 'thought', bbox: { x: 0, y: 0, w: 1, h: 0.5 } }]
  });
  store.savePagePartition({
    pageId: p4.pageId,
    regions: [{ regionId: 'r6', kind: 'article', bbox: { x: 0, y: 0, w: 1, h: 0.5 } }]
  });
  store.savePagePartition({
    pageId: p5.pageId,
    regions: [{ regionId: 'r7', kind: 'problem', bbox: { x: 0, y: 0, w: 1, h: 0.5 } }]
  });

  const task = buildAgentInstruction({ store, stage: 'recognition' });

  // 2a. 单框提交兼容 (region_card_fill)
  const revForSingle = store.getState().revision;
  cli.commit(task.taskFile, {
    phase: 'region_card_fill',
    pageId: p2.pageId,
    regionId: 'r4',
    title: '单框卡片',
    editableContent: '单框提交内容',
    expectedRevision: revForSingle,
    operationId: 'op-single-r4'
  });
  assert.ok(store.getState().cards.some((c) => c.regionId === 'r4' && c.editableContent === '单框提交内容'));

  // 2b. 整页提交 (page_card_fill)
  const revForPage = store.getState().revision;
  cli.commit(task.taskFile, {
    phase: 'page_card_fill',
    pageId: p3.pageId,
    expectedRevision: revForPage,
    operationId: 'op-page-fill-p3',
    cards: [
      { regionId: 'r5', title: '整页卡片 5', editableContent: '整页方式提交内容 5' }
    ]
  });
  assert.equal(store.getState().cards.find((c) => c.regionId === 'r5').editableContent, '整页方式提交内容 5');

  // 2c. 多页批量提交 (pages: [...])
  const revForMulti = store.getState().revision;
  cli.commit(task.taskFile, {
    expectedRevision: revForMulti,
    operationId: 'op-batch-pages',
    pages: [
      {
        pageId: p4.pageId,
        cards: [
          { regionId: 'r6', title: '批量卡片 6', editableContent: '多页批更新正文 6' }
        ]
      },
      {
        pageId: p5.pageId,
        cards: [
          { regionId: 'r7', title: '批量卡片 7', editableContent: '多页批更新正文 7' }
        ]
      }
    ]
  });
  assert.equal(store.getState().cards.find((c) => c.regionId === 'r6').editableContent, '多页批更新正文 6');
  assert.equal(store.getState().cards.find((c) => c.regionId === 'r7').editableContent, '多页批更新正文 7');
});

test('Test 5 (R48 - AI 速度与质量辅助工具 prepare/bundle、草稿模板与链式 next)', (t) => {
  const root = createTempRoot('papercard-r8-t5-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const store = createWorkspaceStore(root);
  const img1 = path.join(root, 'page1.png');
  const img2 = path.join(root, 'page2.png');
  writeSampleImage(img1);
  writeSampleImage(img2);
  const [p1, p2] = store.importLocalFiles([img1, img2]);

  store.savePagePartition({
    pageId: p1.pageId,
    regions: [
      { regionId: 'r1', kind: 'process', bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.4 } },
      { regionId: 'r2', kind: 'thought', bbox: { x: 0.1, y: 0.5, w: 0.8, h: 0.4 } }
    ]
  });
  store.savePagePartition({
    pageId: p2.pageId,
    regions: [
      { regionId: 'r3', kind: 'formula_block', bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }
    ]
  });

  const task = buildAgentInstruction({ store, stage: 'recognition' });

  // 1. 验证 CLI prepare (别名 bundle) 一键生成带编号叠加框 SVG 与预填结构的 draft JSON
  const prepRes = cli.prepare(task.taskFile);
  assert.equal(prepRes.ok, true);
  assert.equal(prepRes.pendingPagesCount, 2);

  const page1Prep = prepRes.pendingPages.find((p) => p.pageId === p1.pageId);
  assert.ok(fs.existsSync(page1Prep.annotatedSvgPath), 'annotated SVG 已生成');
  assert.ok(fs.existsSync(page1Prep.draftFile), 'draft JSON 已生成');

  const svgContent = fs.readFileSync(page1Prep.annotatedSvgPath, 'utf8');
  assert.ok(svgContent.includes('annotated-region-r1'), 'SVG 包含编号叠加层元素');

  const draftJson = JSON.parse(fs.readFileSync(page1Prep.draftFile, 'utf8'));
  assert.equal(draftJson.phase, 'page_card_fill');
  assert.equal(draftJson.pageId, p1.pageId);
  assert.equal(draftJson.cards.length, 2);

  // 验证 bundle 别名等价于 prepare
  const bundleRes = cli.bundle(task.taskFile);
  assert.equal(bundleRes.ok, true);
  assert.equal(bundleRes.pendingPagesCount, 2);

  // 2. 验证直接用 --draft-file 提交修改后的草稿
  draftJson.cards[0].editableContent = '来自 draft-file 的填写结果 1';
  draftJson.cards[1].editableContent = '来自 draft-file 的填写结果 2';
  fs.writeFileSync(page1Prep.draftFile, JSON.stringify(draftJson, null, 2), 'utf8');

  cli.commit(task.taskFile, '--draft-file', page1Prep.draftFile);

  const cardR1 = store.getState().cards.find((c) => c.regionId === 'r1');
  const cardR2 = store.getState().cards.find((c) => c.regionId === 'r2');
  assert.equal(cardR1.editableContent, '来自 draft-file 的填写结果 1');
  assert.equal(cardR2.editableContent, '来自 draft-file 的填写结果 2');

  // 3. 验证 claim 与 commit 的链式 next 返回体
  const claimRes = cli.claim(task.taskFile, 'worker-tester');
  assert.equal(claimRes.ok, true);
  assert.ok(claimRes.lease && claimRes.lease.leaseId, 'claim 返回 lease 租约');
  assert.ok(claimRes.next, 'claim 返回体直接包含首个待处理页的 next');
  assert.equal(claimRes.next.target.pageId, p2.pageId, '首个待处理页为 p2');

  // 提交最后一页，验证 commit 返回体直接包含下一个待处理页的 next (最后一页完成时返回 stageComplete: true)
  const commitRes = cli.commit(task.taskFile, {
    phase: 'page_card_fill',
    pageId: p2.pageId,
    expectedRevision: claimRes.next.revision,
    operationId: 'op-finish-p2',
    agentId: 'worker-tester',
    leaseId: claimRes.lease.leaseId,
    cards: [
      { regionId: 'r3', title: '公式卡', editableContent: 'E = mc^2' }
    ]
  });

  assert.equal(commitRes.ok, true);
  assert.ok(commitRes.next, 'commit 返回体直接包含 next 状态');
  assert.equal(commitRes.next.stageComplete, true, '最后一页完成后 next.stageComplete 为 true');
});

test('Test 6 (R44~R46 前端 UI 结构、API 封装与微动效校验)', () => {
  const root = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'app.js'), 'utf8');
  const apiJs = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'api.js'), 'utf8');
  const cardEditorJs = fs.readFileSync(path.join(root, 'src', 'renderer', 'js', 'cardEditor.js'), 'utf8');
  const workspaceCss = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles', 'workspace-v4.css'), 'utf8');
  const editorCss = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles', 'editor-v4.css'), 'utf8');

  // 1. 检查 index.html UI 按钮结构
  assert.ok(indexHtml.includes('id="deleteBatchBtn"'), 'index.html 包含 #deleteBatchBtn');
  assert.ok(indexHtml.includes('id="deletePageBtn"'), 'index.html 包含 #deletePageBtn');
  assert.ok(indexHtml.includes('id="modifyPageBtn"'), 'index.html 包含 #modifyPageBtn');
  assert.ok(indexHtml.includes('id="regionHintBtn"'), 'index.html 包含 #regionHintBtn');

  // 2. 检查 api.js 封装
  assert.ok(apiJs.includes('deleteBatch('), 'api.js 封装 API.deleteBatch');
  assert.ok(apiJs.includes('deletePage('), 'api.js 封装 API.deletePage');
  assert.ok(apiJs.includes('savePageCards('), 'api.js 封装 API.savePageCards');

  // 3. 检查 app.js 事件绑定与交互逻辑
  assert.ok(appJs.includes('confirmDeleteBatch'), 'app.js 包含 confirmDeleteBatch');
  assert.ok(appJs.includes('confirmDeletePage'), 'app.js 包含 confirmDeletePage');
  assert.ok(appJs.includes('modifyPage'), 'app.js 包含 modifyPage');
  assert.ok(appJs.includes('editRegionHint'), 'app.js 包含 editRegionHint');

  // 4. 检查 cardEditor.js
  assert.ok(cardEditorJs.includes('id="redPenPlugin"'), 'cardEditor.js 包含 #redPenPlugin 红笔批注与AI提示词组件');

  // 5. 检查微动效关键帧定义
  const allCss = workspaceCss + '\n' + editorCss;
  assert.ok(allCss.includes('@keyframes correctionPulse'), 'CSS 包含 @keyframes correctionPulse 待修改微动效');
  assert.ok(allCss.includes('@keyframes badgePopIn'), 'CSS 包含 @keyframes badgePopIn 徽标微动效');
});
