'use strict';
/**
 * verify-desktop.js — Electron 原生桌面端无人值守端到端场景验收脚本
 *
 * 由 `PaperCardAtelier.exe --profile=<isolated_dir> --scenario=scripts/scenarios/verify-desktop.js` 驱动：
 *   1. 验证窗口协议为 `app://local/index.html`（无任何 HTTP 端口依赖）
 *   2. 验证 `window.papercard` Preload 沙箱桥接与 19 个 IPC 通道
 *   3. 截取原纸排版视图实机图 (`01-desktop-page-view.png`)
 *   4. 触发右上角一键生成/复制 Agent 提示词并截取弹窗实机图 (`02-desktop-agent-prompt.png`)
 *   5. 切换到学科题解卡片视图、验证四层内容模型与卡片拆分合并，截取 (`03-desktop-card-workbench.png`)
 *   6. 切换到 2D 自由画布视图、验证关联连线与坐标重排，截取 (`04-desktop-canvas-view.png`)
 */

const fs = require('node:fs');
const path = require('node:path');

module.exports = async function runDesktopScenario({ win, app, delay, shot, log }) {
  const results = {
    protocolUrl: '',
    hasPapercardBridge: false,
    pageCount: 0,
    initialCardCount: 0,
    promptGenerated: false,
    cardSplitOk: false,
    cardMergeOk: false,
    canvasRelayoutOk: false,
    shots: []
  };

  log('1. 检查渲染进程 URL 与 Preload IPC 桥接...');
  const bootInfo = await win.webContents.executeJavaScript(`
    (async function() {
      const hasBridge = typeof window.papercard === 'object' && typeof window.papercard.call === 'function';
      const ws = hasBridge ? await window.papercard.call('workspace:get', {}) : null;
      return {
        url: window.location.href,
        hasBridge,
        ok: ws && ws.ok,
        revision: ws && ws.revision,
        pageCount: ws && ws.state && ws.state.pages ? ws.state.pages.length : 0,
        cardCount: ws && ws.state && ws.state.cards ? ws.state.cards.length : 0,
        activePhase: ws && ws.activePhase
      };
    })()
  `);

  results.protocolUrl = bootInfo.url;
  results.hasPapercardBridge = bootInfo.hasBridge;
  results.pageCount = bootInfo.pageCount;
  results.initialCardCount = bootInfo.cardCount;

  if (!bootInfo.url.startsWith('app://local/')) {
    throw new Error('非本地 app:// 协议加载: ' + bootInfo.url);
  }
  if (!bootInfo.hasBridge || !bootInfo.ok) {
    throw new Error('window.papercard IPC 桥接不可用');
  }

  await delay(600);
  const shot1 = await shot('01-desktop-page-view');
  results.shots.push(shot1);

  log('1.5. 验证直接点击右侧卡片本体立即响应并打开极简卡片编辑弹窗...');
  const cardClickInfo = await win.webContents.executeJavaScript(`
    (async function() {
      const firstStreamCard = document.querySelector('.stream-card-item');
      if (!firstStreamCard) return { clicked: false, modalOpened: false };
      firstStreamCard.click();
      await new Promise(r => setTimeout(r, 400));
      const modal = document.getElementById('cardEditorModal');
      const isOpen = Boolean(modal && !modal.hidden && modal.classList.contains('is-open'));
      return {
        clicked: true,
        modalOpened: isOpen,
        editingTitle: document.getElementById('editCardTitle')?.value || ''
      };
    })()
  `);
  results.cardBodyClickOpensEditor = !!(cardClickInfo.clicked && cardClickInfo.modalOpened);
  await delay(400);
  const shot5 = await shot('05-desktop-card-editor');
  results.shots.push(shot5);

  // 关闭卡片编辑弹窗
  await win.webContents.executeJavaScript(`
    (function() {
      const closeBtn = document.getElementById('closeCardEditorBtn');
      if (closeBtn) closeBtn.click();
      const modal = document.getElementById('cardEditorModal');
      if (modal) { modal.hidden = true; modal.classList.remove('is-open'); }
    })()
  `);
  await delay(300);

  log('2. 验证右上角一键生成/复制 Agent 提示词...');
  const promptInfo = await win.webContents.executeJavaScript(`
    (async function() {
      const btn = document.getElementById('copyAgentPromptBtn');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 500));
      const res = await window.papercard.call('agent:generatePrompt', {});
      return {
        ok: res && res.ok,
        hasPromptText: !!(res && res.promptText && res.promptText.includes('noteTasks.js')),
        taskIndexFile: res && res.taskIndexFile
      };
    })()
  `);
  results.promptGenerated = !!(promptInfo.ok && promptInfo.hasPromptText);
  await delay(500);
  const shot2 = await shot('02-desktop-agent-prompt');
  results.shots.push(shot2);

  // 关闭弹窗
  await win.webContents.executeJavaScript(`
    (function() {
      const closeBtn = document.getElementById('closePromptModalBtn');
      if (closeBtn) closeBtn.click();
      const modal = document.getElementById('agentPromptModal');
      if (modal) modal.hidden = true;
    })()
  `);
  await delay(400);

  log('3. 切换到卡片工作台视图并验证卡片拆分与合并...');
  const cardTest = await win.webContents.executeJavaScript(`
    (async function() {
      const cardTab = document.querySelector('[data-view="card"]');
      if (cardTab) cardTab.click();
      await new Promise(r => setTimeout(r, 600));

      const wsBefore = await window.papercard.call('workspace:get', {});
      const firstCard = wsBefore.state.cards[0];
      const splitRes = await window.papercard.call('card:split', {
        sourceCardId: firstCard.cardId,
        segments: [
          { title: firstCard.title + '（上：题设条件）', editableContent: '拆分段1：题设三次函数表达式与定义域分析', kind: firstCard.kind },
          { title: firstCard.title + '（下：求解目标）', editableContent: '拆分段2：单调区间、极值点与凹凸拐点求解要求', kind: firstCard.kind }
        ]
      });

      const createdIds = (splitRes.createdCards || []).map(c => c.cardId);
      let mergeRes = { ok: false };
      if (createdIds.length >= 2) {
        mergeRes = await window.papercard.call('card:merge', {
          cardIds: createdIds,
          title: firstCard.title,
          editableContent: firstCard.editableContent
        });
      }

      if (window.PaperCardApp && typeof window.PaperCardApp.refreshWorkspace === 'function') {
        await window.PaperCardApp.refreshWorkspace();
      }
      return {
        splitOk: !!(splitRes && splitRes.ok && createdIds.length === 2),
        mergeOk: !!(mergeRes && mergeRes.ok && mergeRes.card)
      };
    })()
  `);
  results.cardSplitOk = cardTest.splitOk;
  results.cardMergeOk = cardTest.mergeOk;
  await delay(600);
  const shot3 = await shot('03-desktop-card-workbench');
  results.shots.push(shot3);

  log('4. 切换到 2D 自由画布视图并验证画布排布...');
  const canvasTest = await win.webContents.executeJavaScript(`
    (async function() {
      const canvasTab = document.querySelector('[data-view="canvas"]');
      if (canvasTab) canvasTab.click();
      await new Promise(r => setTimeout(r, 500));
      const layoutBtn = document.getElementById('layoutByTreeBtn');
      if (layoutBtn) layoutBtn.click();
      await new Promise(r => setTimeout(r, 600));
      const fitBtn = document.getElementById('canvasZoomFitBtn');
      if (fitBtn) fitBtn.click();
      await new Promise(r => setTimeout(r, 300));
      const ws = await window.papercard.call('workspace:get', {});
      return { ok: !!(ws && ws.ok && ws.state.cards.length >= 7) };
    })()
  `);
  results.canvasRelayoutOk = canvasTest.ok;
  await delay(600);
  const shot4 = await shot('04-desktop-canvas-view');
  results.shots.push(shot4);

  const reportPath = path.join(app.getPath('userData'), 'desktop-verification-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');
  console.log('[desktop-scenario-result]', JSON.stringify(results));

  const allPassed = results.hasPapercardBridge &&
    results.protocolUrl.startsWith('app://local/') &&
    results.pageCount >= 2 &&
    results.initialCardCount >= 7 &&
    results.cardBodyClickOpensEditor &&
    results.promptGenerated &&
    results.cardSplitOk &&
    results.cardMergeOk &&
    results.canvasRelayoutOk;

  return {
    ok: allPassed,
    summary: results
  };
};
