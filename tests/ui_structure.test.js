'use strict';
/**
 * ui_structure.test.js — 现代化 UI 界面、右上角复制提示词入口与页面/卡片/画布三视图切换动效测试
 *
 * 由主智能体（Leader Agent）编写，验证前端与服务层的结构交付标准。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('UI 与动效契约：导入、四视图、原纸分阶段提示词和本地剪贴板链路', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
  const cssPath = path.join(__dirname, '..', 'src', 'renderer', 'styles', 'app.css');
  const tokensPath = path.join(__dirname, '..', 'src', 'renderer', 'styles', 'tokens.css');
  const appJsPath = path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js');

  assert.ok(fs.existsSync(htmlPath), '缺少 src/renderer/index.html');
  assert.ok(fs.existsSync(cssPath), '缺少 src/renderer/styles/app.css');
  assert.ok(fs.existsSync(tokensPath), '缺少 src/renderer/styles/tokens.css');
  assert.ok(fs.existsSync(appJsPath), '缺少 src/renderer/js/app.js');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8') + '\n' + fs.readFileSync(tokensPath, 'utf8');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // 1. 顶栏导入，分阶段操作位于原纸区
  assert.ok(html.includes('id="importPagesBtn"'), 'HTML 顶栏应包含导入按钮 #importPagesBtn');
  assert.ok(html.includes('id="copyAgentPromptBtn"'), 'HTML 应包含识别画框提示词按钮 #copyAgentPromptBtn');

  // 2. 页面、卡片、画布三大核心视图切换入口
  assert.ok(html.includes('data-view="page"'), '应包含「原纸排版视图」切换入口');
  assert.ok(html.includes('data-view="cards"'), '应包含「学科与题解卡片视图」切换入口');
  assert.ok(html.includes('data-view="canvas"'), '应包含「自由画布视图」切换入口');

  assert.ok(html.includes('data-view="knowledge"'), '应包含独立知识库入口');
  for (const stage of ['page_partition','region_card_fill','global_synthesis','knowledge_synthesis']) {
    assert.ok(html.includes(`data-stage="${stage}"`), `缺少阶段按钮 ${stage}`);
  }
  const apiJs=fs.readFileSync(path.join(__dirname,'../src/renderer/js/api.js'),'utf8');
  const ipcJs=fs.readFileSync(path.join(__dirname,'../src/main/ipc.js'),'utf8');
  assert.ok(apiJs.includes("invokeIPC('agent:generatePrompt', stage ? { stage } : {})"));
  assert.ok(ipcJs.includes("handleSafe('agent:generatePrompt'") && ipcJs.includes('clipboard.writeText(promptText)'));

  // 3. 页面、卡片与画布之间的切换动效支持
  assert.ok(
    css.includes('transition') && (css.includes('@keyframes') || css.includes('view-transition') || css.includes('stage-transition')),
    'CSS 应定义页面、卡片与画布之间的切换动效与过渡曲线'
  );
  assert.ok(
    appJs.includes('API.generateAgentPrompt(stage)') && appJs.includes("querySelectorAll('.stage-prompt')"),
    '分阶段按钮应把所选阶段交给原生提示词 API'
  );
});
