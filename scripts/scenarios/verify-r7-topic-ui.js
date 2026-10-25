// Run only with a disposable --profile containing a copy of the user's workspace.
// Narrow acceptance: batch naming + cross-batch knowledge topic, not a full desktop suite.
module.exports=async({win,delay,shot})=>{
 const report=await win.webContents.executeJavaScript(`(async()=>{
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(check,label)=>{for(let i=0;i<60;i++){if(check())return;await pause(70);}throw new Error(label);};
  const app=window.PaperCardApp,api=window.PaperCardAPI,$=id=>document.getElementById(id);
  await until(()=>app?.getState().batches?.length,'workspace not ready');
  const initial=app.getState(),batch=initial.batches.find(b=>b.batchId===initial.activeBatchId),stamp=Date.now(),name='主题验收 '+stamp;
  let canvasId;
  try{
   $('renameBatchBtn').click();$('renameBatchTitle').value='命名验收 '+stamp;$('workspaceDialogSave').click();
   await until(()=>app.getState().batches.find(b=>b.batchId===batch.batchId)?.title==='命名验收 '+stamp,'batch rename did not render');
   app.switchView('knowledge');await until(()=>$('kbContent'),'knowledge view did not mount');
   document.querySelector('[data-kb-mode="themes"]').click();$('kbNewBoard').click();$('boardTitleInput').value=name;$('workspaceDialogSave').click();
   await until(()=>app.getState().canvases?.some(b=>b.title===name),'new topic missing');
   canvasId=app.getState().canvases.find(b=>b.title===name).canvasId;
   await until(()=>$('kbEmptyMembers'),'empty topic did not open with a member action');$('kbEmptyMembers').click();
   const cards=app.getState().cards||[],first=cards[0],second=cards.find(c=>c.batchId!==first?.batchId)||cards[1],chosen=[first,second].filter(Boolean);
   for(const card of chosen){$('boardMemberSearch').value=card.title;$('boardMemberSearch').dispatchEvent(new Event('input',{bubbles:true}));const checkbox=[...document.querySelectorAll('[data-member]')].find(el=>el.dataset.member===card.cardId);if(!checkbox)throw new Error('member not reachable by search');checkbox.checked=true;checkbox.dispatchEvent(new Event('change',{bubbles:true}));}
   $('workspaceDialogSave').click();await until(()=>chosen.every(c=>app.getState().canvases.find(b=>b.canvasId===canvasId)?.cardIds.includes(c.cardId)),'members did not persist');
   await until(()=>$('kbMapNodes').querySelectorAll('.canvas-node').length===chosen.length,'topic nodes not rendered');
   $('kbMapTree').click();await pause(650);
   $('kbRenameTheme').click();$('boardTitleInput').value=name+' 改名';$('workspaceDialogSave').click();await until(()=>$('kbHeading').textContent===name+' 改名','topic rename did not render');
   const saved=await api.getWorkspace(),board=saved.state.canvases.find(b=>b.canvasId===canvasId);if(board.layout.length!==chosen.length)throw new Error('independent topic layout missing');
   return{ok:true,scope:'batch naming and knowledge topic only',members:chosen.length,crossBatch:chosen.length===2&&chosen[0].batchId!==chosen[1].batchId,layoutCount:board.layout.length};
  }finally{await api.renameBatch(batch.batchId,batch.title);await app.refreshWorkspace();}
 })()`);
 if(shot)await shot('r7-topic-cross-batch');
 return report;
};
