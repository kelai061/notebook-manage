const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createWorkspaceStore}=require('../src/main/store');
const {buildAgentInstruction}=require('../src/main/agentPrompt');
const cli=require('../src/cli/noteTasks');
const contracts=require('../src/shared/contracts');
const cliPath=path.resolve(__dirname,'../src/cli/noteTasks.js');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pc-round4-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,ws:createWorkspaceStore(root)};}
function partition(ws,p,regionId='r'){return ws.savePagePartition({pageId:p.pageId,pageSummary:'可见文字',regions:[{regionId,kind:'自定义笔记',bbox:{x:.1,y:.2,w:.5,h:.4},polygon:[{x:.1,y:.2},{x:.6,y:.2},{x:.3,y:.6}]}]});}
function fill(ws,p,r='r'){return ws.saveRegionCard({pageId:p.pageId,regionId:r,title:'原文',editableContent:'原字不可改',previewContent:'手动预览',structureBlocks:[{kind:'text',text:'原字不可改'}],intraPageLinks:[],crossPageHypotheses:[],figureInfo:{enabled:false}});}
test('legacy migration, batch import/switch and cross-batch knowledge relations survive reload',t=>{
 const {root,ws}=fixture(t);const p=ws.importPage({title:'首批',svgPreview:'<svg><text>原字</text></svg>'});partition(ws,p);const c1=fill(ws,p);const old=ws.getState();
 delete old.batches;delete old.activeBatchId;for(const x of [...old.pages,...old.cards])delete x.batchId;
 fs.writeFileSync(path.join(root,'workspace-state.json'),JSON.stringify(old));
 const migrated=createWorkspaceStore(root);assert.equal(migrated.getState().batches.length,1);assert.equal(migrated.getState().cards[0].editableContent,'原字不可改');
 const svg=path.join(root,'input.svg');fs.writeFileSync(svg,'<svg viewBox="0 0 200 300"><text>第二批</text></svg>');
 const [p2]=migrated.importLocalFiles([svg]);assert.equal(migrated.getState().batches.length,2);assert.equal(contracts.activeBatchState(migrated.getState()).pages.length,1);
 partition(migrated,p2);const c2=fill(migrated,p2);
 migrated.saveKnowledgeRelations({relations:[{fromCardId:c1.cardId,toCardId:c2.cardId,type:'related',label:'人工联系'}]});
 const restarted=createWorkspaceStore(root);assert.equal(restarted.getState().knowledgeRelations.length,1);assert.equal(restarted.getState().cards.length,2);
 restarted.switchBatch({batchId:'batch-legacy'});assert.equal(contracts.activeBatchState(restarted.getState()).cards[0].cardId,c1.cardId);
 restarted.saveKnowledgeRelations({relations:[]});assert.equal(createWorkspaceStore(root).getState().knowledgeRelations.length,0);
});
test('polygon validation, actual self-contained raster crop, rotation and linked card image refresh',t=>{
 const {root,ws}=fixture(t);const png=path.join(root,'pixel.png');fs.writeFileSync(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=','base64'));
 const [p]=ws.importLocalFiles([png]);partition(ws,p);const c=fill(ws,p);
 let state=ws.getState(),r=state.pages[0].regions[0];assert.match(r.cropSvg,/<clipPath/);assert.match(r.cropSvg,/data:image\/png;base64,/);assert.doesNotMatch(r.cropSvg,/href="app:\/\//);
 assert.equal(state.cards[0].previewContent,'手动预览');assert.equal(state.cards[0].figureInfo.enabled,false);
 const before=r.cropSvg;
 ws.updateRegion({pageId:p.pageId,regionId:'r',patch:{bbox:{x:.2,y:.2,w:.4,h:.4},polygon:[{x:.2,y:.2},{x:.6,y:.2},{x:.4,y:.6}]}});
 assert.notEqual(ws.getState().cards[0].figureInfo.cropSvg,before);
 assert.throws(()=>ws.updateRegion({pageId:p.pageId,regionId:'r',patch:{polygon:[{x:-1,y:0},{x:0,y:0},{x:1,y:1}]}}));
 for(const rotation of [90,180,270,0])ws.updatePage({pageId:p.pageId,rotation});
 state=createWorkspaceStore(root).getState();r=state.pages[0].regions[0];assert.ok(Math.abs(r.bbox.x-.2)<1e-9);assert.ok(Math.abs(r.bbox.y-.2)<1e-9);assert.equal(state.cards[0].editableContent,'原字不可改');assert.equal(state.cards[0].cardId,c.cardId);
 assert.throws(()=>ws.savePagePartition({pageId:p.pageId,pageSummary:'新范围',regions:[{regionId:'different',kind:'图',bbox:{x:0,y:0,w:1,h:1}}]}),/保留已有/);
});
test('real CLI enforces single-stage completion, prerequisites, unknown transcription and explicit re-recognition',t=>{
 const {root,ws}=fixture(t);const p=ws.importPage({title:'纸',svgPreview:'<svg><text>无法辨认</text></svg>'});
 let prompt=buildAgentInstruction({store:ws,stage:'region_card_fill'});assert.throws(()=>cli.next(prompt.taskFile),/前置/);
 prompt=buildAgentInstruction({store:ws,stage:'page_partition'});
 function run(op,payload){const args=[cliPath,op,prompt.taskFile];if(payload)args.push(JSON.stringify(payload));return spawnSync(process.execPath,args,{encoding:'utf8'});}
 let out=run('next');assert.equal(out.status,0);assert.equal(JSON.parse(out.stdout).target.pageId,p.pageId);
 out=run('commit',{phase:'global_synthesis',relations:[]});assert.equal(out.status,1);
 out=run('commit',{phase:'page_partition',pageId:p.pageId,pageSummary:'无法辨认',regions:[{regionId:'r',kind:'未知图',bbox:{x:0,y:0,w:1,h:1}}]});assert.equal(out.status,0,out.stderr);assert.equal(JSON.parse(out.stdout).stageComplete,true);
 assert.equal(JSON.parse(run('next').stdout).stageComplete,true);
 prompt=buildAgentInstruction({store:createWorkspaceStore(root),stage:'region_card_fill'});
 out=run('commit',{phase:'region_card_fill',pageId:p.pageId,regionId:'r',title:'无法辨认',editableContent:'',unreadable:true,structureBlocks:[{kind:'image'}],figureInfo:{enabled:false},intraPageLinks:[],crossPageHypotheses:[]});assert.equal(out.status,0,out.stderr);assert.equal(JSON.parse(out.stdout).stageComplete,true);
 out=run('rerecognize',{pageId:p.pageId,regionId:'r'});assert.equal(out.status,1);
 out=run('rerecognize',{pageId:p.pageId,regionId:'r',reprocess:true});assert.equal(out.status,0,out.stderr);assert.equal(JSON.parse(out.stdout).target.card.editableContent,'');
 prompt=buildAgentInstruction({store:createWorkspaceStore(root),stage:'knowledge_synthesis'});out=run('commit',{phase:'knowledge_synthesis',relations:[]});assert.equal(out.status,0,out.stderr);assert.equal(JSON.parse(out.stdout).stageComplete,true);
});

test('batch synthesis persists across imports and knowledge synthesis leaves card content untouched',t=>{
 const {root,ws}=fixture(t);const p=ws.importPage({title:'A'});partition(ws,p);const c=fill(ws,p);
 const task=buildAgentInstruction({store:ws,stage:'global_synthesis'});
 const pending=cli.next(task.taskFile);assert.equal(pending.target.cardsSummary[0].editableContent,'原字不可改');
 const payload={phase:'global_synthesis',relations:[],problemTrees:[],canvasLayout:[{cardId:c.cardId,x:10,y:20}],taxonomyAssignments:[{cardId:c.cardId,subject:'未分类',course:'未分类',chapter:'未分类',tags:[]}]};
 assert.equal(cli.commit(task.taskFile,payload).stageComplete,true);
 const first=createWorkspaceStore(root).getState().activeBatchId;
 const restarted=createWorkspaceStore(root);restarted.importPage({title:'B',newBatch:true});assert.equal(restarted.getState().batches[0].synthesis.completedAt>0,true);
 restarted.switchBatch({batchId:first});assert.equal(contracts.computeTaskPhase(restarted.getState()),'completed');
 const kb=buildAgentInstruction({store:restarted,stage:'knowledge_synthesis'});assert.equal(cli.commit(kb.taskFile,{relations:[]}).stageComplete,true);assert.equal(cli.next(kb.taskFile).stageComplete,true);
 assert.equal(createWorkspaceStore(root).getState().cards[0].editableContent,'原字不可改');
});

test('manual empty summary, hostile region ids stay in crops, explicit delete preserves card and rotated source is embedded',t=>{
 const {root,ws}=fixture(t), png=path.join(root,'p.png');fs.writeFileSync(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=','base64'));
 const [p]=ws.importLocalFiles([png]);const bad='../../outside';
 ws.savePagePartition({pageId:p.pageId,pageSummary:'',regions:[{regionId:bad,kind:'随记',bbox:{x:0,y:0,w:1,h:1}}]});
 const crop=ws.cropRegion({pageId:p.pageId,regionId:bad});assert.equal(path.dirname(crop.fullPath),path.join(root,'crops'));assert.ok(fs.existsSync(crop.fullPath));assert.equal(fs.existsSync(path.join(root,'outside.svg')),false);
 const c=fill(ws,p,bad);ws.updatePage({pageId:p.pageId,rotation:90});assert.ok(ws.getState().pages[0].svgPreview.includes('data:image/png;base64,'));assert.ok(!ws.getState().pages[0].svgPreview.includes('href="app://'));
 ws.deleteRegion({pageId:p.pageId,regionId:bad});const card=createWorkspaceStore(root).getState().cards.find(x=>x.cardId===c.cardId);assert.equal(card.regionId,null);assert.equal(card.editableContent,'原字不可改');assert.ok(card.figureInfo.cropSvg);
});

test('new and edited card previews share body by default; explicit independent preview survives; global layout reloads across batches',t=>{
 const {root,ws}=fixture(t);ws.importPage({title:'A'});let card=ws.addCard({title:'新卡',editableContent:'第一版'});assert.equal(card.previewContent,'第一版');
 ws.updateCard(card.cardId,{editableContent:'第二版'});assert.equal(createWorkspaceStore(root).getState().cards[0].previewContent,'第二版');
 ws.updateCard(card.cardId,{previewContent:'用户独立预览'});ws.updateCard(card.cardId,{editableContent:'第三版'});assert.equal(ws.getState().cards[0].previewContent,'用户独立预览');
 ws.updateCanvasLayout([{cardId:card.cardId,x:731,y:582,w:270,h:200}]);
 let restarted=createWorkspaceStore(root);assert.equal(restarted.getState().canvasLayout.find(l=>l.cardId===card.cardId).x,731);
 restarted.importPage({title:'B',newBatch:true});const other=restarted.addCard({editableContent:'B内容'});restarted.updateCanvasLayout([{cardId:other.cardId,x:1001,y:902}]);
 const final=createWorkspaceStore(root).getState();assert.equal(final.canvasLayout.length,2);assert.equal(final.canvasLayout.find(l=>l.cardId===card.cardId).y,582);assert.equal(final.canvasLayout.find(l=>l.cardId===other.cardId).x,1001);
});
