'use strict';
// Round 6b: 原截图 blank preview fix.
module.exports = async ({win, app, delay, shot}) => {
  const js = code => win.webContents.executeJavaScript(code);
  const json = async code => JSON.parse(await js(`JSON.stringify((()=>{try{return ${code};}catch(e){return {__error:String(e&&e.message)};}})())`));
  const jsonAsync = async code => JSON.parse(await js(`(async()=>{try{return JSON.stringify(await (${code}));}catch(e){return JSON.stringify({__error:String(e&&e.message)});}})()`));
  const result = {checks: [], shots: []};
  for (let n = 0; n < 80; n++) { if (await js('Boolean(window.PaperCardApp?.getState()?.cards?.length)')) break; await delay(100); }

  // 1. the reported card renders a real image in the knowledge grid
  await js("PaperCardApp.switchView('knowledge')");
  await delay(400);
  await js(`(()=>{const t=[...document.querySelectorAll('#viewKnowledge .folder-tile')].find(t=>t.textContent.includes('计算机与AI'));if(t)t.click();})();true`);
  await delay(900);
  const target = await json(`(()=>{const card=[...document.querySelectorAll('#viewKnowledge [data-card-id]')].find(c=>/决策模型/.test(c.textContent));const img=card&&card.querySelector('.figure-preview img');return {found:Boolean(card),src:(img?img.getAttribute('src'):'').slice(0,60),natural:img?img.naturalWidth:null,complete:img?img.complete:null,hint:Boolean(card&&card.querySelector('.figure-preview[data-media-error]'))};})()`);
  if (!target.found || !target.natural || target.hint) throw new Error('reported card still has no preview: ' + JSON.stringify(target));
  result.checks.push('reported card shows its 原截图 in the knowledge grid (naturalWidth ' + target.natural + ')');
  result.shots.push(await shot('r6b-01-knowledge-preview'));

  // 2. a cache-missed data URL must still resolve its external image
  const resolved = await jsonAsync(`(async()=>{const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3072 4096"><image href="app://local/pages/page-15.jpg" width="3072" height="4096"/></svg>';const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);const m=await import('./js/media.js');const out=await m.resolveSvgMediaUrl(url);const text=out.startsWith('data:')?decodeURIComponent(out.slice(out.indexOf(',')+1)):out;return {changed:out!==url,isData:out.startsWith('data:'),inlined:text.includes('data:image/jpeg;base64,')||text.includes('data:image/png;base64,')||text.includes('data:image/webp;base64,'),len:out.length};})()`);
  if (!resolved.changed || !resolved.inlined) throw new Error('uncached data SVG still unresolved: ' + JSON.stringify(resolved));
  result.checks.push('uncached data-URL crop resolves its external image instead of staying blank');

  // 3. a genuinely broken crop shows a hint, not an empty box
  const broken = await jsonAsync(`(async()=>{const m=await import('./js/media.js');const host=document.createElement('div');host.innerHTML='<div class="figure-preview"><img src="data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><image href="app://local/pages/missing-page.jpg"/></svg>')+'"></div>';document.body.append(host);m.bindFigurePreview(host);await new Promise(r=>setTimeout(r,800));const box=host.querySelector('.figure-preview');const flag=box.dataset.mediaError;host.remove();return {flag:Boolean(flag)};})()`);
  if (!broken.flag) throw new Error('broken crop did not fall back to a readable hint: ' + JSON.stringify(broken));
  result.checks.push('broken crop falls back to a readable hint instead of a blank box');

  result.ok = true;
  console.log('[r6b] ' + JSON.stringify({checks: result.checks, target, resolved}));
  return result;
};
