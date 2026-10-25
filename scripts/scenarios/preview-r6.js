'use strict';
// Round 6 visual spot check: cards view directory rows and paper view card list.
module.exports = async ({win, app, delay, shot}) => {
  const js = code => win.webContents.executeJavaScript(code);
  const json = async code => JSON.parse(await js(`JSON.stringify((()=>{try{return ${code};}catch(e){return {__error:String(e&&e.message)};}})())`));
  for (let n = 0; n < 80; n++) { if (await js('Boolean(window.PaperCardApp?.getState()?.cards?.length)')) break; await delay(100); }
  const richest = await json(`(()=>{const s=PaperCardApp.getState();const counts=new Map();for(const c of s.cards)counts.set(c.batchId,(counts.get(c.batchId)||0)+1);return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0][0];})()`);
  await js(`window.PaperCardAPI.switchBatch(${JSON.stringify(richest)});true`);
  await delay(900);
  await js("PaperCardApp.switchView('cards')");
  await delay(500);
  const cardsView = await json(`(()=>{const rows=[...document.querySelectorAll('#taxonomyTree .directory-row')];const first=rows.find(r=>!r.classList.contains('is-active'))||rows[0];const r=first.getBoundingClientRect();const probe=document.elementFromPoint(r.left+r.width*0.6,r.bottom-2);probe.dispatchEvent(new MouseEvent('click',{bubbles:true}));return {rows:rows.length,probe:probe.className||probe.tagName};})()`);
  await delay(500);
  const afterCards = await json(`({cards:document.querySelectorAll('#cardsGrid [data-card-id]').length,active:document.querySelectorAll('#taxonomyTree .directory-row.is-active').length})`);
  await shot('r6-05-cards-directory');
  await js("PaperCardApp.switchView('page')");
  await delay(600);
  const paper = await json(`({cards:document.querySelectorAll('#pageCardsList [data-card-id]').length,cropWindows:document.querySelectorAll('#pageCardsList .figure-crop-window').length,dataSvgs:[...document.querySelectorAll('#pageCardsList .figure-preview img')].filter(i=>i.getAttribute('src').startsWith('data:image/svg')).length})`);
  await shot('r6-06-paper-view');
  console.log('[r6-visual]', JSON.stringify({cardsView, afterCards, paper}));
  return {ok: true};
};
