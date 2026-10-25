 'use strict';
// Two visual spot checks only. Full functional/performance acceptance is delegated by the user.
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({win,app,delay,shot}) => {
  const js = code => win.webContents.executeJavaScript(code);
  const result = {checks:[],shots:[],fullAcceptance:false};
  for (let n=0;n<60;n++) {if(await js('Boolean(window.PaperCardApp?.getState()?.cards?.length)'))break;await delay(100);}
  await js("PaperCardApp.switchView('knowledge')");
  await delay(250);
  const library = await js(`({directory:!!document.getElementById('kbDirectorySearch'),tiles:document.querySelectorAll('#viewKnowledge .folder-tile').length,nodes:document.querySelectorAll('#viewKnowledge .canvas-node').length,icon:document.querySelector('.brand-image img')?.naturalWidth})`);
  if(!library.directory || library.tiles>18 || library.nodes || !library.icon)throw new Error('Knowledge directory/icon spot check failed: '+JSON.stringify(library));
  result.checks.push('knowledge opens as bounded directory, not global card graph; icon loaded');
  result.shots.push(await shot('r5-knowledge-directory'));
  await js("PaperCardApp.switchView('canvas')");
  await delay(200);
  const canvas = await js(`({boards:document.querySelectorAll('#canvasBoardList [data-canvas-id]').length,nodes:document.querySelectorAll('#canvasNodesLayer .canvas-node').length,title:document.getElementById('activeBoardTitle').textContent})`);
  if(!canvas.boards || canvas.nodes>16)throw new Error('Theme canvas spot check failed: '+JSON.stringify(canvas));
  result.checks.push('migrated notebook opens limited independent theme board');
  result.shots.push(await shot('r5-theme-canvases'));
  result.library=library;result.canvas=canvas;result.ok=true;
  fs.writeFileSync(path.join(app.getPath('userData'),'round5-preview.json'),JSON.stringify(result,null,2));
  console.log('[round5-preview]',JSON.stringify(result));return result;
};
