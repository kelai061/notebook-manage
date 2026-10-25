const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceStore } = require('../src/main/store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-round9-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, ws: createWorkspaceStore(root) };
}

function seedBatchCards(ws, cardsData, batchTitle = '测试批次') {
  const page = ws.importPage({
    title: '手写页',
    svgPreview: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000"><text>原文</text></svg>'
  });
  ws.savePagePartition({
    pageId: page.pageId,
    pageSummary: '分区',
    regions: cardsData.map((row, i) => ({
      regionId: 'r' + i,
      kind: 'process',
      bbox: { x: 0.05, y: 0.05 + i * 0.18, w: 0.4, h: 0.15 }
    }))
  });
  const createdCards = cardsData.map((row, i) =>
    ws.saveRegionCard({
      pageId: page.pageId,
      regionId: 'r' + i,
      title: row.title,
      editableContent: row.title,
      structureBlocks: [{ kind: 'text', text: row.title }],
      intraPageLinks: [],
      crossPageHypotheses: [],
      subject: row.subject || '数学',
      course: row.course || '高数',
      chapter: row.chapter || '第一章',
      figureInfo: { enabled: false }
    })
  );
  return { page, cards: createdCards };
}

test('round 9: saveGlobalSynthesis automatically updates batch canvases and layouts', t => {
  const { root, ws } = fixture(t);
  const { cards } = seedBatchCards(ws, [
    { title: '定理一', subject: '数学' },
    { title: '定理二', subject: '数学' },
    { title: '物理实验', subject: '物理' }
  ]);
  const cardIds = cards.map(c => c.cardId);

  // Before synthesis, auto canvas has empty cardIds
  const stateBefore = ws.getState();
  const defaultCanvasBefore = stateBefore.canvases.find(c => c.batchId === stateBefore.activeBatchId);
  assert.ok(defaultCanvasBefore, 'default canvas created on batch creation');

  // Perform global synthesis
  const layout = [
    { cardId: cardIds[0], x: 100, y: 100, w: 220, h: 82 },
    { cardId: cardIds[1], x: 460, y: 100, w: 220, h: 82 },
    { cardId: cardIds[2], x: 100, y: 360, w: 220, h: 82 }
  ];
  const relations = [
    { fromCardId: cardIds[0], toCardId: cardIds[1], type: 'derives', label: '推导' }
  ];
  const taxonomyAssignments = [
    { cardId: cardIds[0], subject: '数学', course: '高等数学', chapter: '一元微积分' },
    { cardId: cardIds[1], subject: '数学', course: '高等数学', chapter: '一元微积分' },
    { cardId: cardIds[2], subject: '物理', course: '大学物理', chapter: '力学基础' }
  ];

  ws.saveGlobalSynthesis({
    canvasLayout: layout,
    relations,
    taxonomyAssignments,
    problemTrees: []
  });

  const stateAfter = ws.getState();
  const batchCanvases = stateAfter.canvases.filter(c => c.batchId === stateAfter.activeBatchId);
  assert.ok(batchCanvases.length >= 1, 'batch has canvases');

  // Default canvas must now have all 3 cardIds and full layout
  const defaultCanvas = batchCanvases.find(c => c.title === '主题画布' || c.title === (stateAfter.batches[0]?.title || '测试批次'));
  assert.ok(defaultCanvas, 'has default canvas');
  assert.equal(defaultCanvas.cardIds.length, 3, 'default canvas contains all 3 cards');
  assert.equal(defaultCanvas.layout.length, 3, 'default canvas contains all 3 layout positions');
  assert.equal(defaultCanvas.relations.length, 1, 'default canvas contains relations');

  // Because cards span multiple subjects ('数学' and '物理'), subject canvases must also be maintained
  const mathCanvas = batchCanvases.find(c => c.title === '数学');
  const physicsCanvas = batchCanvases.find(c => c.title === '物理');
  assert.ok(mathCanvas, 'math subject canvas created');
  assert.ok(physicsCanvas, 'physics subject canvas created');
  assert.equal(mathCanvas.cardIds.length, 2, 'math canvas contains 2 cards');
  assert.equal(physicsCanvas.cardIds.length, 1, 'physics canvas contains 1 card');
  assert.equal(mathCanvas.layout.length, 2, 'math canvas contains layout');
});

test('round 9: consolidateBatchCanvases heals existing batch canvases with empty cardIds on reload', t => {
  const { root, ws } = fixture(t);
  const { cards } = seedBatchCards(ws, [
    { title: '卡片A', subject: '计算机' },
    { title: '卡片B', subject: '计算机' }
  ]);
  const cardIds = cards.map(c => c.cardId);

  // Directly tamper workspace state to simulate the bug: batch has cards & synthesis, but canvas has empty cardIds & layout
  const state = ws.getState();
  const bId = state.activeBatchId;
  const synthLayout = [
    { cardId: cardIds[0], x: 80, y: 80, w: 220, h: 82 },
    { cardId: cardIds[1], x: 440, y: 80, w: 220, h: 82 }
  ];
  const synthRelations = [
    { fromCardId: cardIds[0], toCardId: cardIds[1], type: 'related', label: '关联' }
  ];
  state.batches.find(b => b.batchId === bId).synthesis = {
    completedAt: Date.now(),
    canvasLayout: synthLayout,
    relations: synthRelations,
    taxonomyAssignments: []
  };
  // Empty canvas
  state.canvases = [
    {
      canvasId: 'canvas-empty-test',
      title: '主题画布',
      scope: 'batch',
      batchId: bId,
      cardIds: [],
      layout: [],
      relations: [],
      auto: true
    }
  ];
  fs.writeFileSync(path.join(root, 'workspace-state.json'), JSON.stringify(state));

  // Reload store
  const reloadedWs = createWorkspaceStore(root);
  const reloadedState = reloadedWs.getState();
  const healedCanvas = reloadedState.canvases.find(c => c.canvasId === 'canvas-empty-test');

  assert.ok(healedCanvas, 'canvas exists');
  assert.deepEqual(healedCanvas.cardIds.sort(), cardIds.sort(), 'cardIds healed from batch cards');
  assert.equal(healedCanvas.layout.length, 2, 'layout healed from synthesis');
  assert.equal(healedCanvas.relations.length, 1, 'relations healed from synthesis');
});
