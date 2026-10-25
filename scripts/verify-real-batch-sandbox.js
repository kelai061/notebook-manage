'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createWorkspaceStore } = require('../src/main/store');
const { generateAgentPrompt } = require('../src/main/agentPrompt');
const cli = require('../src/cli/noteTasks');

const ROOT = path.resolve(__dirname, '..');
const realStateFile = path.join(ROOT, 'workspace', 'workspace-state.json');

if (!fs.existsSync(realStateFile)) {
  throw new Error('未找到真实工作区状态文件: ' + realStateFile);
}

const realHashBefore = crypto.createHash('sha256').update(fs.readFileSync(realStateFile)).digest('hex');
const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-real-batch-sandbox-'));

console.log('[Task 3] 启动真实工作区批次非破坏性沙箱校验...');
console.log('[Task 3] 沙箱目录:', sandboxRoot);

try {
  // 1. 复制真实工作区到沙箱
  const sandboxWs = path.join(sandboxRoot, 'workspace');
  fs.mkdirSync(sandboxWs, { recursive: true });
  fs.copyFileSync(realStateFile, path.join(sandboxWs, 'workspace-state.json'));

  for (const dir of ['pages', 'crops']) {
    const src = path.join(ROOT, 'workspace', dir);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(sandboxWs, dir), { recursive: true });
    }
  }

  const realJson = JSON.parse(fs.readFileSync(realStateFile, 'utf8'));
  const targetBatchId = 'batch-5fdca34b-56c9-438c-88b1-2cdc05a8e69c';
  const originalBatch = realJson.batches.find((b) => b.batchId === targetBatchId);
  assert.ok(originalBatch, '真实工作区中存在目标批次 ' + targetBatchId);

  const originalPages = realJson.pages.filter((p) => p.batchId === targetBatchId);
  const originalRegions = originalPages.flatMap((p) => p.regions || []);
  const originalCards = realJson.cards.filter((c) => c.batchId === targetBatchId);

  assert.equal(originalPages.length, 15, '用户批次共 15 个页面');
  assert.equal(originalRegions.length, 38, '用户亲手框选了 38 个分区');

  const filledCardSet = new Set(originalCards.map((c) => c.pageId + '::' + c.regionId));
  const expectedPendingPages = originalPages.filter((p) => (p.regions || []).some((r) => !filledCardSet.has(p.pageId + '::' + r.regionId)));
  const expectedPendingRegions = expectedPendingPages.reduce((sum, p) => sum + (p.regions || []).filter((r) => !filledCardSet.has(p.pageId + '::' + r.regionId)).length, 0);

  // 2. 在沙箱副本上初始化 store
  const store = createWorkspaceStore(sandboxWs);

  // 3. 校验点 A：增量识别模式 (已填卡片不重复识别，精准定位未完成页面与分区)
  console.log(`[Task 3.1] 验证增量识别队列 (跳过已填页，锁定 ${expectedPendingPages.length} 个待填页、${expectedPendingRegions} 个待处理分区)...`);
  const incrementalInstruction = generateAgentPrompt(store, 'recognition', {
    batchId: targetBatchId
  });

  const incPrep = cli.prepare(incrementalInstruction.taskFile);
  assert.equal(incPrep.ok, true);
  const incPending = incPrep.pendingPages || incPrep.pages;
  assert.equal(incPending.length, expectedPendingPages.length, `精确检出 ${expectedPendingPages.length} 个待填页面`);
  const incRegionsCount = incPending.reduce((sum, p) => sum + p.regions.length, 0);
  assert.equal(incRegionsCount, expectedPendingRegions, `精确检出 ${expectedPendingRegions} 个待处理分区`);

  for (const p of incPending) {
    assert.ok(fs.existsSync(p.annotatedSvgPath), `待处理页 ${p.pageId} 生成叠加框 SVG`);
    assert.ok(fs.existsSync(p.draftFile), `待处理页 ${p.pageId} 生成草稿 JSON`);
    assert.ok(p.imagePath, '包含原图完整路径');
    for (const r of p.regions) {
      assert.ok(r.positionHint && r.positionHint.length > 0, `分区 ${r.regionId} 具有准确方位 positionHint`);
    }
  }

  // 4. 校验点 B：全量 15 页全覆盖草稿生成 (指定 15 页全量目标，全部直接生成草稿与标注 SVG)
  console.log('[Task 3.2] 验证全量 15 页草稿生成 (覆盖全部 15 页、38 个手绘分区)...');
  const allPageIds = originalPages.map((p) => p.pageId);
  const fullInstruction = generateAgentPrompt(store, 'recognition', {
    batchId: targetBatchId,
    mode: 'modify',
    targetPageIds: allPageIds
  });

  const fullPrep = cli.prepare(fullInstruction.taskFile);
  assert.equal(fullPrep.ok, true);
  const fullPending = fullPrep.pendingPages || fullPrep.pages;
  assert.equal(fullPending.length, 15, '全部 15 个已框选页面全部直接生成 page_card_fill 草稿文件');

  let fullRegionsTotal = 0;
  for (const pageItem of fullPending) {
    assert.ok(fs.existsSync(pageItem.annotatedSvgPath), `页面 ${pageItem.pageId} annotated SVG 存在`);
    assert.ok(fs.existsSync(pageItem.draftFile), `页面 ${pageItem.pageId} draft JSON 存在`);

    const draft = JSON.parse(fs.readFileSync(pageItem.draftFile, 'utf8'));
    assert.equal(draft.phase, 'page_card_fill', '草稿 phase 必须为 page_card_fill');
    assert.equal(draft.pageId, pageItem.pageId);
    assert.equal(draft.cards.length, pageItem.regions.length);

    fullRegionsTotal += pageItem.regions.length;
    for (const reg of pageItem.regions) {
      assert.ok(reg.positionHint && reg.positionHint.length > 0, `分区 ${reg.regionId} positionHint 存在`);
      assert.ok(reg.regionIndex >= 1, `分区 ${reg.regionId} regionIndex 存在`);
    }
  }
  assert.equal(fullRegionsTotal, 38, '生成的草稿与叠加框 100% 覆盖全部 38 个用户手绘分区');

  // 5. 校验点 C：0 分区篡改，未框选页不触发自动画框
  console.log('[Task 3.3] 验证 0 篡改铁律...');
  const finalState = store.getState();
  const finalPages = finalState.pages.filter((p) => p.batchId === targetBatchId);
  const finalRegions = finalPages.flatMap((p) => p.regions || []);

  assert.equal(finalRegions.length, 38, '分区总数保持严格不变 (38 个)');
  for (const orig of originalRegions) {
    const matched = finalRegions.find((r) => r.regionId === orig.regionId);
    assert.ok(matched, `分区 ${orig.regionId} 存在`);
    assert.deepEqual(matched.bbox, orig.bbox, `分区 ${orig.regionId} BBox 未被篡改`);
    if (orig.points) {
      assert.deepEqual(matched.points, orig.points, `分区 ${orig.regionId} 多边形未被篡改`);
    }
  }

  const unpartitioned = finalPages.filter((p) => !p.regions || p.regions.length === 0);
  assert.equal(unpartitioned.length, 0, '15 页均有用户框选，无空白页被 AI 乱画框');

  console.log('[Task 3] ✅ 真实工作区批次非破坏性沙箱校验 100% 通过！');
} finally {
  // 6. 验证真实工作区未受任何影响
  const realHashAfter = crypto.createHash('sha256').update(fs.readFileSync(realStateFile)).digest('hex');
  assert.equal(realHashBefore, realHashAfter, '铁律验证：真实工作区 workspace-state.json 哈希绝对一致，未被破坏！');
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
  console.log('[Task 3] 真实工作区哈希完全匹配，沙箱目录已安全清理。');
}
