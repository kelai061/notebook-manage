const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createWorkspaceStore}=require('../src/main/store');

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pc-round6-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,ws:createWorkspaceStore(root)};
}
function seedCards(ws,rows){
  const page=ws.importPage({title:'手写页',svgPreview:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000"><text>原文</text></svg>'});
  ws.savePagePartition({pageId:page.pageId,pageSummary:'分区',regions:rows.map((row,i)=>({regionId:'r'+i,kind:'process',bbox:{x:.05,y:.05+i*.18,w:.4,h:.15}}))});
  return rows.map((row,i)=>ws.saveRegionCard({pageId:page.pageId,regionId:'r'+i,title:row.title,editableContent:row.title,structureBlocks:[{kind:'text',text:row.title}],intraPageLinks:[],crossPageHypotheses:[],subject:row.subject,course:row.course||'课程',chapter:row.chapter||'章节',figureInfo:{enabled:false}}));
}

test('round 6: legacy chapter boards collapse into one board per notebook + subject',t=>{
  const {root,ws}=fixture(t);
  seedCards(ws,[
    {title:'A1',subject:'数学',chapter:'第一章'},{title:'A2',subject:'数学',chapter:'第二章'},{title:'A3',subject:'数学',chapter:'第二章'},
    {title:'B1',subject:'物理',chapter:'第一章'},{title:'B2',subject:'物理',chapter:'第二章'}
  ]);
  const before=ws.getState();
  // Reproduce the legacy shape: one board per subject/course/chapter path.
  before.canvases=before.canvases.filter(c=>c.scope==='knowledge');
  for(const pathKey of ['数学 / 课程 / 第一章','数学 / 课程 / 第二章','物理 / 课程 / 第一章','物理 / 课程 / 第二章']){
    const members=before.cards.filter(c=>pathKey.startsWith(c.subject)&&c.chapter===pathKey.split(' / ')[2]);
    before.canvases.push({canvasId:'canvas-legacy-'+pathKey,title:pathKey,scope:'batch',batchId:before.activeBatchId,cardIds:members.map(c=>c.cardId),layout:[],relations:[]});
  }
  before.schemaVersion=5;
  fs.writeFileSync(path.join(root,'workspace-state.json'),JSON.stringify(before));

  const reloaded=createWorkspaceStore(root).getState();
  const batchBoards=reloaded.canvases.filter(c=>c.scope==='batch');
  assert.equal(batchBoards.length,2,'one board per subject');
  assert.deepEqual(batchBoards.map(b=>b.title).sort(),['数学','物理']);
  assert.equal(batchBoards.find(b=>b.title==='数学').cardIds.length,3);
  assert.equal(batchBoards.find(b=>b.title==='物理').cardIds.length,2);
  assert.equal(reloaded.schemaVersion,6);
  // No card is lost and no member is duplicated across boards.
  const covered=new Set(batchBoards.flatMap(b=>b.cardIds));
  assert.equal(covered.size,reloaded.cards.length);
});

test('round 6: user-named boards survive consolidation and keep their own members',t=>{
  const {root,ws}=fixture(t);
  const cards=seedCards(ws,[{title:'A1',subject:'数学'},{title:'A2',subject:'数学'},{title:'B1',subject:'物理'}]);
  ws.saveCanvas({title:'我的复习主线',scope:'batch',batchId:ws.getState().activeBatchId,cardIds:[cards[0].cardId,cards[2].cardId],relations:[]});
  const state=ws.getState();
  state.schemaVersion=5;
  fs.writeFileSync(path.join(root,'workspace-state.json'),JSON.stringify(state));
  const reloaded=createWorkspaceStore(root).getState();
  const named=reloaded.canvases.find(b=>b.title==='我的复习主线');
  assert.ok(named,'user-named board kept');
  assert.deepEqual(named.cardIds.sort(),[cards[0].cardId,cards[2].cardId].sort());
});

test('round 6: re-cropping a region rewrites the linked card crop so the preview cannot stay stale',t=>{
  const {root,ws}=fixture(t);
  const [card]=seedCards(ws,[{title:'图形',subject:'数学'}]);
  const page=ws.getState().pages[0];
  const region=page.regions[0];
  const beforeSvg=ws.getState().cards[0].figureInfo.cropSvg;
  ws.updateRegion({pageId:page.pageId,regionId:region.regionId,patch:{bbox:{x:.2,y:.3,w:.25,h:.15}}});
  const after=ws.getState();
  const updated=after.cards.find(c=>c.cardId===card.cardId);
  const expected=`viewBox="${Math.round(.2*(page.width||1200))} ${Math.round(.3*(page.height||1600))} ${Math.round(.25*(page.width||1200))} ${Math.round(.15*(page.height||1600))}"`;
  assert.notEqual(updated.figureInfo.cropSvg,beforeSvg);
  assert.ok(updated.figureInfo.cropSvg.includes(expected),expected+' in '+updated.figureInfo.cropSvg);
  assert.equal(updated.figureInfo.cropPath,after.pages[0].regions[0].cropPath);
  assert.equal(createWorkspaceStore(root).getState().cards[0].figureInfo.cropSvg,updated.figureInfo.cropSvg,'crop survives reload');
});
