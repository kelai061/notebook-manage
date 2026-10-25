// Three narrowly scoped checks. Temporary workspace only; no desktop or full suite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceStore } = require('../src/main/store');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-r5-'));
try {
  let store = createWorkspaceStore(root);
  const image = path.join(root, 'sample.png');
  fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64'));
  const [page] = store.importLocalFiles([image]);
  const card = store.addCard({ title: '保留原文', pageId: page.pageId, editableContent: '原文不变' });
  store.updateCard(card.cardId, { editableContent: card.cardId });
  const stateMtime = fs.statSync(path.join(root, 'workspace-state.json')).mtimeMs;
  const first = store.saveCanvas({ title: '主题一', scope: 'batch', batchId: page.batchId, cardIds: [card.cardId], layout: [{ cardId: card.cardId, x: 10, y: 20 }] });
  const second = store.saveCanvas({ title: '主题二', scope: 'knowledge', cardIds: [card.cardId], layout: [{ cardId: card.cardId, x: 500, y: 700 }] });
  store.updateCanvasLayout([{ cardId: card.cardId, x: 90, y: 30 }], undefined, first.canvasId);
  assert.equal(fs.statSync(path.join(root, 'workspace-state.json')).mtimeMs, stateMtime);
  assert.ok(fs.existsSync(path.join(root, 'workspace-layouts.json')));
  store = createWorkspaceStore(root);
  assert.equal(store.getState().canvases.find(c => c.canvasId === first.canvasId).layout[0].x, 90);
  assert.equal(store.getState().canvases.find(c => c.canvasId === second.canvasId).layout[0].x, 500);
  store.deleteCanvas({ canvasId: second.canvasId });
  assert.equal(store.getState().cards[0].editableContent, card.cardId);
  const legacyRoot=path.join(root,'legacy');
  fs.mkdirSync(legacyRoot);
  fs.writeFileSync(path.join(legacyRoot,'workspace-state.json'),JSON.stringify({revision:1,pages:[{pageId:'legacy-page',regions:[]}],cards:Array.from({length:33},(_,i)=>({cardId:'legacy-'+i,pageId:'legacy-page',regionId:'legacy-region-'+i,intraPageLinks:i===0?[{targetRegionId:'legacy-region-1',type:'related_topic',confirmed:true}]:[],subject:i<17?'数学':'物理',course:'课',chapter:'章',editableContent:'原文'+i})),synthesis:null}));
  const migrated=createWorkspaceStore(legacyRoot).getState();
  assert.equal(migrated.canvases.length,2);
  assert.equal(new Set(migrated.canvases.flatMap(c=>c.cardIds)).size,33);
  assert.ok(migrated.canvases.some(c=>c.layout.length===0 && c.relations.some(r=>r.fromCardId==='legacy-0' && r.toCardId==='legacy-1' && r.evidenceSource==='intraPageLinks')));
  console.log('PASS 1/3 independent persisted canvas positions; deleting canvas retains card');

  const archive = store.archiveBatch({});
  assert.equal(store.archiveBatch({}).archiveId, archive.archiveId);
  assert.equal(fs.readdirSync(path.join(archive.folder, 'pages')).length, 1);
  const restored = store.restoreArchive({ archiveId: archive.archiveId });
  const state = store.getState();
  const copy = state.cards.find(c => c.batchId === restored.batchId);
  assert.notEqual(copy.cardId, card.cardId);
  assert.equal(copy.editableContent, card.cardId); // An exact ID-looking body is still text.
  assert.equal(state.cards.find(c => c.cardId === card.cardId).editableContent, card.cardId);
  assert.ok(fs.existsSync(state.pages.find(p => p.batchId === restored.batchId).imagePath));
  assert.ok(state.canvases.filter(c => c.batchId === restored.batchId).every(c => c.cardIds.every(id => id !== card.cardId)));
  console.log('PASS 2/3 archive image backup deduplicates; restore remaps identities into new batch without rewriting text');

  const result = store.organizeKnowledge({ taxonomyAssignments: [{ cardId: copy.cardId, subject: '数学', course: '笔记', chapter: '示例' }], canvases: [{ title: '有限主题', cardIds: [copy.cardId], layout: [{ cardId: copy.cardId, x: 1, y: 2 }] }] });
  assert.ok(fs.readFileSync(result.indexPath, 'utf8').includes('数学 / 笔记 / 示例'));
  assert.equal(store.getState().cards.find(c => c.cardId === copy.cardId).editableContent, card.cardId);
  assert.equal(store.getState(), store.getState()); // Same revision reuses detached snapshot.
  const before = fs.statSync(path.join(root, 'workspace-state.json')).mtimeMs;
  createWorkspaceStore(root);
  assert.equal(fs.statSync(path.join(root, 'workspace-state.json')).mtimeMs, before);
  console.log('PASS 3/3 taxonomy/Markdown organization preserves body; snapshots reused and migrated startup does not write state');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
