'use strict';
/**
 * Round 6 acceptance scenario (real desktop window, isolated profile copy).
 * Covers: 1) delete reflects immediately, 2) re-cropped region reaches the card preview,
 * 3) theme boards are one-per-subject, 4) the whole directory row is clickable.
 */
module.exports = async ({win, app, delay, shot}) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = code => win.webContents.executeJavaScript(code);
  const json = async code => JSON.parse(await js(`JSON.stringify((()=>{try{return ${code};}catch(e){return {__error:String(e&&e.message)};}})())`));
  const result = {checks: [], shots: [], ok: true};
  for (let n = 0; n < 80; n++) { if (await js('Boolean(window.PaperCardApp?.getState()?.cards?.length)')) break; await delay(100); }

  // ---------- 1. delete shows immediately (and does not freeze later refreshes) ----------
  await js("PaperCardApp.switchView('knowledge')");
  await delay(350);
  await js(`document.querySelector('#viewKnowledge .folder-tile')?.click()`);
  await delay(450);
  const listed = await json(`[...document.querySelectorAll('#viewKnowledge [data-card-id]')].map(e=>e.dataset.cardId)`);
  const victim = listed[0];
  if (!victim) throw new Error('no card rendered in knowledge folder');
  await js(`window.__p=PaperCardApp.deleteCard(${JSON.stringify(victim)});true`);
  await delay(900);
  const afterDelete = await json(`({inDom:Boolean(document.querySelector('#viewKnowledge [data-card-id="${victim}"]')),dom:[...document.querySelectorAll('#viewKnowledge [data-card-id]')].length,stateCards:PaperCardApp.getState().cards.length,rev:PaperCardApp.getState().revision})`);
  if (afterDelete.inDom || afterDelete.dom !== listed.length - 1) throw new Error('deleted card still rendered: ' + JSON.stringify({listed: listed.length, afterDelete}));
  result.checks.push('delete: card leaves the list immediately without a manual reload');
  result.shots.push(await shot('r6-01-after-delete'));

  // ---------- 2. adjusting the paper region refreshes the card crop preview ----------
  const target = await json(`(()=>{const s=PaperCardApp.getState();const c=s.cards.find(x=>x.regionId&&x.figureInfo);const p=s.pages.find(p=>p.pageId===c.pageId);const r=p.regions.find(r=>r.regionId===c.regionId);return {cardId:c.cardId,pageId:c.pageId,regionId:c.regionId,bbox:r.bbox,pageW:p.width,pageH:p.height};})()`);
  const nextBBox = {x: 0.1, y: 0.32, w: 0.34, h: 0.2};
  await js(`window.PaperCardAPI.updateRegion(${JSON.stringify(target.pageId)},${JSON.stringify(target.regionId)},${JSON.stringify({bbox: nextBBox})});true`);
  await delay(1200);
  const refreshed = await json(`(()=>{const s=PaperCardApp.getState();const p=s.pages.find(p=>p.pageId===${JSON.stringify(target.pageId)});const r=p.regions.find(r=>r.regionId===${JSON.stringify(target.regionId)});return {rev:s.revision,bbox:r.bbox};})()`);
  if (Math.abs(refreshed.bbox.w - nextBBox.w) > 0.001) throw new Error('region change did not reach the renderer: ' + JSON.stringify(refreshed));
  await js(`PaperCardApp.openCardEditor(${JSON.stringify(target.cardId)})`);
  await delay(700);
  const preview = await json(`(()=>{const m=document.getElementById('cardEditorModal');const win=m.querySelector('#editorFigurePreview .figure-crop-window');const img=win?win.querySelector('img'):null;return {hasWindow:Boolean(win),src:img?img.getAttribute('src'):'',width:img?parseFloat(img.style.width):null,left:img?parseFloat(img.style.left):null,top:img?parseFloat(img.style.top):null};})()`);
  const expect={width:100/nextBBox.w,left:-100*nextBBox.x/nextBBox.w,top:-100*nextBBox.y/nextBBox.h};
  const close=(a,b)=>Math.abs(a-b)<0.05;
  if (!preview.hasWindow || !preview.src || !close(preview.width, expect.width) || !close(preview.left, expect.left) || !close(preview.top, expect.top)) {
    const dbg = await json(`(()=>{const s=PaperCardApp.getState();const c=s.cards.find(x=>x.cardId===${JSON.stringify(target.cardId)});const p=s.pages.find(p=>p.pageId===c.pageId);const r=p&&p.regions.find(r=>r.regionId===c.regionId);const m=document.getElementById('cardEditorModal');return {hasCard:Boolean(c),hasPage:Boolean(p),hasRegion:Boolean(r),hasCropSvg:Boolean(c&&c.figureInfo&&c.figureInfo.cropSvg),cropHead:((c&&c.figureInfo&&c.figureInfo.cropSvg)||'').slice(0,80),editorHtml:(m?m.querySelector('#editorFigurePreview')?.innerHTML:'no-modal').slice(0,300)};})()`);
    throw new Error('card crop preview still old: ' + JSON.stringify({preview, expect, dbg}));
  }
  result.checks.push('crop: adjusted paper region reaches the card 原截图 preview (clip window follows the new bbox)');
  result.shots.push(await shot('r6-02-crop-refreshed'));
  await js(`document.getElementById('cardEditorModal').querySelector('#closeCardEditorBtn').click();true`);
  await delay(250);

  // ---------- 3. one theme board per subject ----------
  const richest = await json(`(()=>{const s=PaperCardApp.getState();const counts=new Map();for(const c of s.cards)counts.set(c.batchId,(counts.get(c.batchId)||0)+1);const best=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0];return best?best[0]:null;})()`);
  if (richest) { await js(`window.PaperCardAPI.switchBatch(${JSON.stringify(richest)});true`); await delay(900); }
  await js("PaperCardApp.switchView('canvas')");
  await delay(600);
  const boards = await json(`({titles:[...document.querySelectorAll('#canvasBoardList [data-canvas-id]')].map(b=>b.textContent.trim()),cards:document.querySelectorAll('#canvasNodesLayer .canvas-node').length})`);
  const state = await json(`(()=>{const s=PaperCardApp.getState();const batch=s.activeBatchId;const cards=s.cards.filter(c=>c.batchId===batch);const subjects=new Set(cards.map(c=>String(c.subject||'').trim()||'未分类'));const batchBoards=s.canvases.filter(c=>c.scope==='batch'&&c.batchId===batch);return {subjects:[...subjects],boards:batchBoards.length,boardsWithCards:batchBoards.filter(b=>b.cardIds.length).length,titles:batchBoards.map(b=>b.title)};})()`);
  if (state.boardsWithCards !== state.subjects.length) throw new Error('boards are not one-per-subject: ' + JSON.stringify(state));
  if (boards.titles.some(t => t.includes(' / '))) throw new Error('board titles still carry a taxonomy path: ' + JSON.stringify(boards.titles));
  result.checks.push(`canvas: ${state.boardsWithCards} boards = ${state.subjects.length} subjects of this notebook`);
  result.shots.push(await shot('r6-03-theme-boards'));

  // ---------- 4. whole directory row is a hit target ----------
  await js("PaperCardApp.switchView('knowledge')");
  await delay(400);
  const rowHit = await json(`(()=>{const row=[...document.querySelectorAll('#kbDirectoryTree .kb-folder')].find(r=>!r.classList.contains('is-active'));if(!row)return {none:true};const label=row.querySelector('.folder-title').textContent.trim();const r=row.getBoundingClientRect();const probe=document.elementFromPoint(r.right-8, r.top+r.height/2);const before=document.getElementById('kbBreadcrumb').textContent;probe.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.right-8,clientY:r.top+r.height/2}));return {probe:probe.className,label,rowW:Math.round(r.width),rowH:Math.round(r.height),before};})()`);
  await delay(500);
  const afterRow = await json(`({after:document.getElementById('kbBreadcrumb').textContent,active:document.querySelectorAll('#kbDirectoryTree .kb-folder.is-active').length})`);
  if (rowHit.none || afterRow.after !== rowHit.label || !afterRow.active) throw new Error('clicking the row padding did not select the folder: ' + JSON.stringify({rowHit, afterRow}));
  result.checks.push('directory: clicking the row (not only the label text) opens that folder');
  result.shots.push(await shot('r6-04-directory-row'));

  const fold = await json(`(()=>{const fold=document.querySelector('#kbDirectoryTree [data-kb-fold]');const row=fold.closest('.kb-folder');const before=document.getElementById('kbBreadcrumb').textContent;const rowsBefore=document.querySelectorAll('#kbDirectoryTree .kb-folder').length;fold.dispatchEvent(new MouseEvent('click',{bubbles:true}));return {before,rowsBefore};})()`);
  await delay(350);
  const afterFold = await json(`({after:document.getElementById('kbBreadcrumb').textContent,rows:document.querySelectorAll('#kbDirectoryTree .kb-folder').length})`);
  if (afterFold.after !== fold.before) throw new Error('fold button now also selects the folder: ' + JSON.stringify({fold, afterFold}));
  if (afterFold.rows === fold.rowsBefore) throw new Error('fold button did not fold: ' + JSON.stringify({fold, afterFold}));
  result.checks.push('directory: the chevron still only folds, it does not navigate');

  result.summary = {afterDelete, refreshed, boards, rowHit, afterRow, afterFold};
  fs.writeFileSync(path.join(app.getPath('userData'), 'r6-report.json'), JSON.stringify(result, null, 2));
  console.log('[r6] ' + JSON.stringify(result.checks));
  return result;
};
