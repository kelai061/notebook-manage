// Bounded synthetic profile; never opens or migrates the real store.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),real=path.join(ROOT,'workspace');
const reportDir=path.join(ROOT,'docs','r7-verification');fs.mkdirSync(reportDir,{recursive:true});
function manifest(dir){const rows=[];function scan(base){for(const e of fs.readdirSync(base,{withFileTypes:true})){const f=path.join(base,e.name);if(e.isDirectory())scan(f);else if(e.isFile())rows.push([path.relative(dir,f),fs.statSync(f).size,fs.statSync(f).mtimeMs]);}}for(const n of ['workspace-state.json','workspace-layouts.json','pages','crops']){const f=path.join(dir,n);if(!fs.existsSync(f))continue;if(fs.statSync(f).isDirectory())scan(f);else rows.push([n,fs.statSync(f).size,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]);}return rows;}
const before=manifest(real),profile=fs.mkdtempSync(path.join(os.tmpdir(),'papercard-r7-desktop-')),ws=path.join(profile,'workspace');fs.mkdirSync(path.join(ws,'pages'),{recursive:true});
const raster=fs.readdirSync(path.join(real,'pages')).find(n=>/\.(jpe?g|png)$/i.test(n));if(!raster)throw Error('Need one existing source raster for image smoke');fs.copyFileSync(path.join(real,'pages',raster),path.join(ws,'pages','fixture.jpg'));
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="blue"/></svg>';
const state={schemaVersion:6,revision:1,activeBatchId:'b1',batches:[{batchId:'b1',title:'第一本',synthesis:null},{batchId:'b2',title:'第二本',synthesis:null}],pages:[{pageId:'p1',batchId:'b1',title:'示例照片',pageAssetUrl:'app://local/pages/fixture.jpg',width:3072,height:4096,rotation:0,svgPreview:svg,regions:[]},{pageId:'p2',batchId:'b2',title:'SVG回退',width:400,height:300,rotation:0,svgPreview:svg,regions:[]}],cards:[{cardId:'c1',batchId:'b1',pageId:'p1',title:'第一张卡',kind:'figure',subject:'数学',editableContent:'原正文 x²',previewContent:'原正文 x²',figureInfo:{redrawSvg:svg,enabled:true}},{cardId:'c2',batchId:'b2',pageId:'p2',title:'第二张卡',subject:'数学',editableContent:'第二本正文',previewContent:'第二本正文'}],canvases:[],canvasLayout:[],knowledgeRelations:[],archives:[],operationLog:[],synthesis:null};
fs.writeFileSync(path.join(ws,'workspace-state.json'),JSON.stringify(state));
const env={...process.env,PAPERCARD_HOME:ROOT,PAPERCARD_VERIFY_NODE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
let failure;
try{execFileSync(path.join(ROOT,'release','PaperCardAtelier','PaperCardAtelier.exe'),[`--profile=${profile}`,`--scenario=${path.join(ROOT,'scripts','scenarios','verify-r7-integration.js')}`],{cwd:ROOT,env,stdio:'inherit',timeout:60000,windowsHide:true});}catch(e){failure=String(e);}
const after=manifest(real),unchanged=JSON.stringify(before)===JSON.stringify(after),logFile=path.join(profile,'scenario.log'),log=fs.existsSync(logFile)?fs.readFileSync(logFile,'utf8'):'';
const result={ok:!failure&&unchanged,profile,realWorkspaceUnchanged:unchanged,before,after,scenarioLog:log,failure};fs.writeFileSync(path.join(reportDir,'desktop.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:result.ok,profile,realWorkspaceUnchanged:unchanged,scenarioLog:log}));if(!result.ok)process.exitCode=1;

