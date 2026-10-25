// One isolated large-inline fixture; no real workspace or desktop tests.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStore}=require('../src/main/store');
const {buildAgentInstruction}=require('../src/main/agentPrompt');
const cli=require('../src/cli/noteTasks');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'papercard-inline-'));
const local=url=>path.join(root,url.slice('app://local/'.length));
try {
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><metadata>'+'a'.repeat(2*1024*1024)+'</metadata><rect width="100" height="80" fill="blue"/></svg>';
 const body='用户原文：<svg>是文字，也不能改\n原公式 x²';
 const state={schemaVersion:6,revision:8,operationLog:[],activeBatchId:'b',batches:[{batchId:'b',title:'原批',synthesis:null}],canvases:[],canvasLayout:[],knowledgeRelations:[],archives:[],synthesis:null,pages:[{pageId:'p',batchId:'b',title:'原纸',width:100,height:80,rotation:0,svgPreview:svg,partitionedAt:1,regions:[{regionId:'r',kind:'图',bbox:{x:0,y:0,w:1,h:1},cropSvg:svg}]}],cards:[{cardId:'c',batchId:'b',pageId:'p',regionId:'r',title:'正文保留',editableContent:body,previewContent:'用户独立预览',figureInfo:{cropSvg:svg,redrawSvg:svg,vectorPreview:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)}}]};
 const file=path.join(root,'workspace-state.json');fs.writeFileSync(file,JSON.stringify(state));const before=fs.statSync(file).size;
 const store=createWorkspaceStore(root),migrated=store.getState(),figure=migrated.cards[0].figureInfo;
 assert.ok(migrated.schemaVersion>=6);assert.equal(migrated.cards[0].editableContent,body);assert.equal(migrated.cards[0].previewContent,'用户独立预览');
 assert.equal(fs.readFileSync(local(migrated.pages[0].svgPreviewPath),'utf8'),svg);
 assert.equal(figure.cropPath,figure.redrawPath);assert.equal(figure.vectorPreviewPath,figure.cropPath);assert.equal(figure.cropPath,migrated.pages[0].regions[0].cropPath);
 assert.ok(figure.cropPath && figure.redrawPath);
 assert.ok(fs.existsSync(local(figure.cropPath)));
 store.cropRegion({pageId:'p',regionId:'r',bbox:{x:.1,y:.1,w:.8,h:.8}});store.updatePage({pageId:'p',rotation:90});
 assert.ok(fs.existsSync(local(store.getState().pages[0].svgPreviewPath)));assert.equal(store.getState().cards[0].editableContent,body);
 store.requestCorrection({pageId:'p',regionId:'r',kind:'content'});
 const task=buildAgentInstruction({store}),next=cli.next(task.taskFile);
 assert.ok(path.isAbsolute(next.target.svgPreviewPath));assert.ok(fs.existsSync(next.target.svgPreviewPath));assert.equal(next.target.svgPreview,undefined);assert.ok(JSON.stringify(next).length<30000);
 assert.equal(createWorkspaceStore(root).getState().cards[0].editableContent,body);
 console.log(JSON.stringify({check:'large inline migration and on-demand crop/rotation',beforeBytes:before,afterBytes:fs.statSync(file).size,nextBytes:Buffer.byteLength(JSON.stringify(next)),passed:true}));
} finally {fs.rmSync(root,{recursive:true,force:true});}
