const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {createWorkspaceStore}=require('../src/main/store');
const {buildAgentInstruction}=require('../src/main/agentPrompt');
const cli=require('../src/cli/noteTasks');
const cliPath=path.resolve(__dirname,'../src/cli/noteTasks.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'papercard-r7-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,store:createWorkspaceStore(root)};}
function payload(step,worker) {
 const common={phase:step.phase,expectedRevision:step.revision,operationId:worker+':'+step.phase+':'+step.target.pageId+':'+(step.target.regionId||''),agentId:worker,reprocess:step.reprocess};
 if(step.phase==='page_partition')return {...common,pageId:step.target.pageId,pageSummary:'可见原文',regions:[{regionId:step.target.pageId+'-r',kind:'笔记',bbox:{x:0,y:0,w:1,h:1}}]};
 return {...common,pageId:step.target.pageId,regionId:step.target.regionId,title:'原文卡',editableContent:'literal-'+worker+'-'+step.target.pageId,structureBlocks:[{kind:'text',text:'原文'}],intraPageLinks:[],crossPageHypotheses:[]};
}

test('four real worker processes retain four task batches while UI switches and a long-lived store writes',async t=>{
 const {root,store}=fixture(t),tasks=[],batches=[];
 for(let i=0;i<4;i++) {
   const p=store.importPage({title:'批'+i,newBatch:true});
   store.importPage({title:'批'+i+'第二页'});batches.push(p.batchId);
   tasks.push(buildAgentInstruction({store,batchId:p.batchId,stage:'recognition'}).taskFile);
 }
 const workerCode=`const fs=require('node:fs'),cli=require(${JSON.stringify(cliPath)});const [task,agent,ready,go]=process.argv.slice(1);const pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);const leaseId=cli.claim(task,agent).lease.leaseId;fs.writeFileSync(ready,'ready');while(!fs.existsSync(go))pause(5);let commits=0,retries=0;for(let n=0;n<120;n++){try{const step=cli.next(task);if(step.stageComplete){cli.release(task,agent,leaseId);process.stdout.write(JSON.stringify({commits,retries}));process.exit(0);}const target=step.target;const base={phase:step.phase,expectedRevision:step.revision,operationId:agent+':'+step.phase+':'+target.pageId+':'+(target.regionId||''),agentId:agent,leaseId};const value=step.phase==='page_partition'?{...base,pageId:target.pageId,pageSummary:'可见原文',regions:[{regionId:target.pageId+'-r',kind:'笔记',bbox:{x:0,y:0,w:1,h:1}}]}:{...base,pageId:target.pageId,regionId:target.regionId,title:'原文卡',editableContent:'literal-'+agent+'-'+target.pageId,structureBlocks:[{kind:'text',text:'原文'}],intraPageLinks:[],crossPageHypotheses:[]};pause(9);cli.commit(task,value);commits++;}catch(error){if(!['REVISION_CONFLICT','WORKSPACE_BUSY'].includes(error.code)){console.error(error.stack);process.exit(1);}retries++;pause(5+Math.random()*12);}}throw Error('worker exhausted retries');`;
 const go=path.join(root,'go'),children=[],done=[];
 for(let i=0;i<4;i++) {
   const child=spawn(process.execPath,['-e',workerCode,tasks[i],'agent'+i,path.join(root,'ready'+i),go],{windowsHide:true});children.push(child);
   done.push(new Promise((resolve,reject)=>{let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(Error(err||'worker exit '+code)));}));
 }
 t.after(()=>children.forEach(c=>{if(c.exitCode===null)c.kill();}));
 for(let n=0;n<400&&!batches.every((_,i)=>fs.existsSync(path.join(root,'ready'+i)));n++)await sleep(10);
 assert.ok(batches.every((_,i)=>fs.existsSync(path.join(root,'ready'+i))));
 fs.writeFileSync(go,'go');
 let switches=0,lastActive=batches[3];
 const timer=setInterval(()=>{try{lastActive=batches[switches++%4];store.switchBatch({batchId:lastActive});}catch(error){if(error.code!=='WORKSPACE_BUSY')throw error;}},19);
 let results;
 try{results=await Promise.all(done);}finally{clearInterval(timer);}
 const refreshed=store.refreshFromDisk({force:true}),state=store.getState();
 assert.equal(refreshed.changed,true);assert.ok(switches>0);assert.equal(state.activeBatchId,lastActive);
 assert.equal(state.pages.length,8);assert.equal(state.cards.length,8);
 for(let i=0;i<4;i++){const cards=state.cards.filter(c=>c.batchId===batches[i]);assert.equal(cards.length,2);assert.ok(cards.every(c=>c.editableContent==='literal-agent'+i+'-'+c.pageId));assert.equal(cli.status(tasks[i]).stageComplete,true);}
 store.addCard({title:'UI并发后编辑',editableContent:'不覆盖Agent正文'});
 assert.equal(createWorkspaceStore(root).getState().cards.length,9);
 assert.equal(results.reduce((n,r)=>n+r.commits,0),16);
 console.log('four worker results',JSON.stringify(results),'UI switches',switches);
});

test('recognition per-page order, immutable manifests, BOM payload, task leases and explicit correction preserve card identities',t=>{
 const {root,store}=fixture(t);const p1=store.importPage({title:'P1'}),p2=store.importPage({title:'P2'});
 const first=buildAgentInstruction({store}),original=fs.readFileSync(first.taskFile,'utf8');
 const second=buildAgentInstruction({store});assert.notEqual(first.taskFile,second.taskFile);assert.equal(fs.readFileSync(first.taskFile,'utf8'),original);
 const leaseId=cli.claim(first.taskFile,'worker').lease.leaseId;assert.throws(()=>cli.claim(first.taskFile,'other'),e=>e.code==='LEASE_HELD');const otherLease=cli.claim(second.taskFile,'other').lease.leaseId;
 assert.throws(()=>cli.release(first.taskFile,'other',otherLease),e=>e.code==='LEASE_HELD');
 let step=cli.next(first.taskFile);assert.equal(step.target.pageId,p1.pageId);
 const file=path.join(root,'bom.json');fs.writeFileSync(file,'\uFEFF'+JSON.stringify({...payload(step,'worker'),leaseId}),'utf8');cli.commit(first.taskFile,file);
 step=cli.next(first.taskFile);assert.equal(step.phase,'region_card_fill');assert.equal(step.target.pageId,p1.pageId);assert.equal(store.getState().pages.find(p=>p.pageId===p2.pageId).partitionedAt,null);
 const filled={...payload(step,'worker'),leaseId};cli.commit(first.taskFile,filled);assert.equal(cli.commit(first.taskFile,filled).completedCards,1); // Same operation, stale revision, safe retry.
 step=cli.next(first.taskFile);assert.equal(step.target.pageId,p2.pageId);cli.commit(first.taskFile,{...payload(step,'worker'),leaseId});
 step=cli.next(first.taskFile);cli.commit(first.taskFile,{...payload(step,'worker'),leaseId});assert.equal(cli.next(first.taskFile).stageComplete,true);assert.equal(store.getState().synthesis,null);
 const before=store.getState().cards.find(c=>c.pageId===p1.pageId),oldId=before.cardId;
 store.requestCorrection({pageId:p1.pageId,regionId:before.regionId,reason:'框选偏移'});
 store.importPage({title:'界面正在看其他批',newBatch:true});const uiBatch=store.getState().activeBatchId;
 step=cli.next(first.taskFile);assert.equal(step.phase,'page_partition');assert.equal(step.reprocess,true);
 const correction={...payload(step,'worker'),leaseId};correction.operationId+=':correction';correction.regions=step.target.existingRegions.map(r=>({...r,bbox:{x:.1,y:.1,w:.8,h:.8}}));cli.commit(first.taskFile,correction);
 assert.equal(store.getState().cards.find(c=>c.cardId===oldId).editableContent,before.editableContent);
 step=cli.next(first.taskFile);assert.equal(step.target.existingCard.cardId,oldId);const fixed={...payload(step,'worker'),leaseId};fixed.operationId+=':correction';fixed.editableContent='用户标记后忠实重录';cli.commit(first.taskFile,fixed);
 assert.equal(cli.next(first.taskFile).stageComplete,true);const state=store.getState();assert.equal(state.activeBatchId,uiBatch);assert.equal(state.cards.find(c=>c.cardId===oldId).editableContent,fixed.editableContent);assert.ok(state.pages.find(p=>p.pageId===p1.pageId).regions[0].corrections.resolvedAt);
 cli.release(first.taskFile,'worker',leaseId);cli.release(second.taskFile,'other',otherLease);
});

test('workspace lock retains a live PID owner and recovers only after that worker exits',async t=>{
 const {root}=fixture(t),ready=path.join(root,'locked');
 const modulePath=path.resolve(__dirname,'../src/main/workspaceTransactions.js');
 const source=`const fs=require('node:fs'),{withWorkspaceLock}=require(${JSON.stringify(modulePath)});withWorkspaceLock(process.argv[1],()=>{fs.writeFileSync(process.argv[2],'locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);});`;
 const child=spawn(process.execPath,['-e',source,root,ready],{windowsHide:true});
 t.after(()=>{if(child.exitCode===null)child.kill();});
 for(let i=0;i<200&&!fs.existsSync(ready);i++)await sleep(10);
 assert.ok(fs.existsSync(ready));
 const {withWorkspaceLock}=require(modulePath);
 assert.throws(()=>withWorkspaceLock(root,()=>{}, {timeoutMs:40}),e=>e.code==='WORKSPACE_BUSY'&&e.retryable);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.workspace-write.lock'),'utf8')).pid,child.pid);
 const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;
 let recovered=false;withWorkspaceLock(root,()=>{recovered=true;},{timeoutMs:200});assert.equal(recovered,true);
});
