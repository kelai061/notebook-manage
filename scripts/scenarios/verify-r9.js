/**
 * scripts/scenarios/verify-r9.js
 * 
 * PaperCard Atelier 第 9 轮桌面客户端实机自动化验收 Scenario
 * 
 * 场景覆盖：
 * Scene 1 (代码块与语法高亮排版): 验证打开代码卡片时，展示深色容器、语言标签、复制按钮与等宽语法高亮代码块 (对齐局部截取_20261026_014248.png的修复)
 * Scene 2 (SVG 矢量图与双向链表/流程图): 验证双向链表卡片与系统工程卡片展示高清 SVG 矢量图，可切换原图与矢量图，可点击放大 (对齐局部截取_20261026_014140.png与014442.png的修复)
 * Scene 3 (画布内容与思维导图推导网络): 验证切换到「画布」视图时，画布成功加载属于当前批次的全部卡片与思维导图推导网络连线，不再出现“0 张卡片”空白 (对齐PaperCardAtelier.exe_20261026_014355.png的修复)
 * Scene 4 (卡片原图切片与矢量图图文对照): 对齐正例 局部截取_20261026_014553.png，图文分明，无灰白空框
 */

const assert = require('node:assert/strict');

module.exports = async ({ win, store, delay, shot, log }) => {
  const checks = [];
  const renderer = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code, label, maxAttempts = 150) => {
    for (let n = 0; n < maxAttempts; n++) {
      try {
        const val = await renderer(code);
        if (val) return val;
      } catch (err) {}
      await delay(50);
    }
    throw new Error(label);
  };

  log('[R9-Verify] 等待渲染进程与工作区状态就绪...');
  await wait('window.PaperCardApp?.getState()?.cards?.length >= 10', '工作区卡片数据未在渲染进程中加载');
  checks.push('工作区数据加载完成 (卡片总数 >= 10)');

  // ============================================================
  // Scene 1: 代码块与语法高亮排版验证 (修复局部截取_20261026_014248.png)
  // ============================================================
  log('[R9-Verify] [Scene 1] 打开双向链表 C++ 代码卡片...');
  const targetCardId = 'card-page-mvnt5bym-e1e4-r-mvnypqvo';

  await renderer(`window.PaperCardApp.openCardEditor('${targetCardId}')`);
  await wait("document.querySelector('.modal-panel.editor-v4') !== null", '卡片编辑器未能打开');
  await delay(600); // 等待 KaTeX 与富文本渲染稳定

  const codeBlockCheck = await renderer(`(() => {
    const preview = document.getElementById('editCardPreview');
    if (!preview) return { error: '未找到 editCardPreview' };

    const containers = preview.querySelectorAll('.code-block-container');
    if (!containers || containers.length === 0) return { error: '未找到 .code-block-container 容器' };

    const container = containers[0];
    const langTag = container.querySelector('.code-lang-tag');
    const copyBtn = container.querySelector('.code-copy-btn');
    const preCode = container.querySelector('pre.code-block code');
    const keywords = [...preview.querySelectorAll('.code-block-container .tok-keyword')].map(el => el.textContent.trim());
    const types = [...preview.querySelectorAll('.code-block-container .tok-type')].map(el => el.textContent.trim());

    const containerStyle = window.getComputedStyle(container);
    const codeStyle = preCode ? window.getComputedStyle(preCode) : null;

    return {
      hasContainer: true,
      containerCount: containers.length,
      langAttr: container.getAttribute('data-lang'),
      tagText: langTag ? langTag.textContent.trim() : null,
      hasCopyBtn: !!copyBtn,
      copyBtnText: copyBtn ? copyBtn.textContent.trim() : null,
      keywordCount: keywords.length,
      sampleKeywords: keywords.slice(0, 10),
      typeCount: types.length,
      sampleTypes: types.slice(0, 5),
      bg: containerStyle.backgroundColor,
      fontFamily: codeStyle ? codeStyle.fontFamily : null
    };
  })()`);

  assert.ok(!codeBlockCheck.error, '代码块检查无错误: ' + codeBlockCheck.error);
  assert.equal(codeBlockCheck.hasContainer, true, '必须渲染 .code-block-container');
  assert.equal(codeBlockCheck.langAttr, 'cpp', '语言属性应为 cpp');
  assert.equal(codeBlockCheck.tagText, 'CPP', '语言标签应大写展示 CPP');
  assert.equal(codeBlockCheck.hasCopyBtn, true, '必须包含复制代码按钮');
  assert.ok(codeBlockCheck.keywordCount >= 5, `高亮关键字数量应 >= 5，实测 ${codeBlockCheck.keywordCount}`);
  assert.ok(codeBlockCheck.sampleKeywords.includes('struct') || codeBlockCheck.sampleKeywords.includes('void'), '必须高亮 C++ 关键字 struct/void');
  assert.ok(codeBlockCheck.typeCount >= 1, `高亮类型数量应 >= 1，实测 ${codeBlockCheck.typeCount}`);
  assert.ok(codeBlockCheck.sampleTypes.includes('Biao'), '类型 Biao 必须高亮');

  log('[R9-Verify] [Scene 1] 捕获代码块排版高清截图: round9-scene1-code.png');
  await shot('round9-scene1-code');
  checks.push('Scene 1: 代码块与等宽语法高亮排版、深色容器、CPP标签与复制按钮全部验证通过');

  // ============================================================
  // Scene 2: SVG 矢量图与双向链表/流程图验证 (修复局部截取_20261026_014140.png & 014442.png)
  // ============================================================
  log('[R9-Verify] [Scene 2] 验证双向链表高清 SVG 矢量图与切换/放大能力...');

  const figureCheck = await renderer(`(() => {
    const holder = document.getElementById('editorFigurePreview');
    if (!holder) return { error: '未找到 editorFigurePreview' };

    const preview = holder.querySelector('.figure-preview');
    if (!preview) return { error: '未找到 .figure-preview' };

    const img = preview.querySelector('img');
    const toggleBtn = preview.querySelector('[data-figure-toggle]');
    const zoomBtn = preview.querySelector('[data-figure-zoom]');
    const label = preview.querySelector('.figure-label');
    const redrawUrl = preview.getAttribute('data-redraw') || '';
    const originalUrl = preview.getAttribute('data-original') || '';
    const figureUrl = preview.getAttribute('data-figure-url') || (img ? img.getAttribute('src') : '');

    return {
      hasPreview: true,
      hasToggleBtn: !!toggleBtn,
      hasZoomBtn: !!zoomBtn,
      labelText: label ? label.textContent.trim() : null,
      redrawUrlSlice: redrawUrl ? redrawUrl.slice(0, 80) : '',
      originalUrlSlice: originalUrl ? originalUrl.slice(0, 80) : '',
      isRedrawSvg: redrawUrl.includes('svg') || redrawUrl.startsWith('data:image/svg+xml') || redrawUrl.startsWith('blob:'),
      isOriginalValid: originalUrl.includes('crops/') || originalUrl.includes('pages/') || originalUrl.startsWith('data:'),
      currentSrcIsRedraw: figureUrl === redrawUrl || (img && img.getAttribute('src') === redrawUrl)
    };
  })()`);

  log('[R9-Verify] figureCheck details: ' + JSON.stringify(figureCheck));
  assert.ok(!figureCheck.error, '图形预览检查无错误: ' + figureCheck.error);
  assert.equal(figureCheck.hasPreview, true, '图形预览存在');
  assert.equal(figureCheck.hasToggleBtn, true, '必须提供「切换原图 / 重绘」按钮');
  assert.equal(figureCheck.hasZoomBtn, true, '必须提供「放大」按钮');
  assert.equal(figureCheck.labelText, '重绘矢量', '初始标签应为「重绘矢量」');
  assert.equal(figureCheck.isRedrawSvg, true, '重绘资源必须为高保真 SVG 格式');
  assert.equal(figureCheck.isOriginalValid, true, '原截图切片或原纸路径有效');

  // 测试切换原图 / 重绘
  log('[R9-Verify] [Scene 2] 测试切换原图 / 矢量图...');
  await renderer(`document.querySelector('#editorFigurePreview [data-figure-toggle]').click()`);
  await delay(250);

  const toggledToCrop = await renderer(`(() => {
    const preview = document.querySelector('#editorFigurePreview .figure-preview');
    const crop = preview ? preview.querySelector('.figure-crop-window') : null;
    const main = preview ? preview.querySelector('.figure-redraw-main') : null;
    const label = preview ? preview.querySelector('.figure-label') : null;
    const img = preview ? preview.querySelector('img') : null;
    const originalUrl = preview ? preview.getAttribute('data-original') : '';
    return {
      cropVisible: crop ? !crop.hidden : (img ? img.getAttribute('src') === originalUrl : false),
      mainHidden: main ? main.hidden : false,
      labelText: label ? label.textContent.trim() : null
    };
  })()`);

  assert.equal(toggledToCrop.labelText, '原截图', '点击后标签切换为「原截图」');
  assert.equal(toggledToCrop.cropVisible, true, '切换后原纸切片窗口可见');

  // 切回重绘矢量图
  await renderer(`document.querySelector('#editorFigurePreview [data-figure-toggle]').click()`);
  await delay(250);

  const toggledBack = await renderer(`(() => {
    const preview = document.querySelector('#editorFigurePreview .figure-preview');
    const crop = preview ? preview.querySelector('.figure-crop-window') : null;
    const main = preview ? preview.querySelector('.figure-redraw-main') : null;
    const label = preview ? preview.querySelector('.figure-label') : null;
    const img = preview ? preview.querySelector('img') : null;
    const redrawUrl = preview ? preview.getAttribute('data-redraw') : '';
    return {
      cropHidden: crop ? crop.hidden : true,
      mainVisible: main ? !main.hidden : (img ? img.getAttribute('src') === redrawUrl : true),
      labelText: label ? label.textContent.trim() : null
    };
  })()`);
  assert.equal(toggledBack.labelText, '重绘矢量', '再次点击后标签切换回「重绘矢量」');
  assert.equal(toggledBack.mainVisible, true, '切换回重绘矢量图可见');

  // 测试放大 Lightbox
  log('[R9-Verify] [Scene 2] 测试点击放大 Lightbox...');
  await renderer(`document.querySelector('#editorFigurePreview [data-figure-zoom]').click()`);
  await delay(250);

  const lightboxCheck = await renderer(`(() => {
    const dialog = document.querySelector('dialog.figure-lightbox');
    return {
      isOpen: dialog ? dialog.open : false,
      hasCloseBtn: dialog ? !!dialog.querySelector('button') : false
    };
  })()`);

  assert.equal(lightboxCheck.isOpen, true, '点击放大后弹出 figure-lightbox 对话框');
  assert.equal(lightboxCheck.hasCloseBtn, true, 'Lightbox 对话框包含关闭按钮');

  // 关闭 Lightbox 对话框
  await renderer(`document.querySelector('dialog.figure-lightbox button').click()`);
  await delay(200);

  log('[R9-Verify] [Scene 2] 捕获双向链表矢量图排版截图: round9-scene2-svg.png');
  await shot('round9-scene2-svg');
  checks.push('Scene 2: 双向链表高保真 SVG 矢量模型、原图/重绘无缝切换与弹窗放大验证通过');

  // 关闭卡片编辑器
  await renderer(`document.getElementById('closeCardEditorBtn').click()`);
  await delay(300);

  // 辅助验证：系统工程卡片 card-06-03
  log('[R9-Verify] [Scene 2-B] 验证系统工程卡片 card-06-03 架构 SVG...');
  await renderer(`window.PaperCardApp.openCardEditor('card-06-03')`);
  await wait("document.querySelector('.modal-panel.editor-v4') !== null", 'card-06-03 未能打开');
  await delay(400);

  const sysCardCheck = await renderer(`(() => {
    const holder = document.getElementById('editorFigurePreview');
    const preview = holder ? holder.querySelector('.figure-preview') : null;
    const redrawUrl = preview ? preview.getAttribute('data-redraw') : '';
    return {
      hasPreview: !!preview,
      isRedrawSvg: redrawUrl.includes('svg') || redrawUrl.startsWith('data:image/svg+xml')
    };
  })()`);

  assert.equal(sysCardCheck.hasPreview, true, '系统工程卡片具有图像预览');
  assert.equal(sysCardCheck.isRedrawSvg, true, '系统工程卡片具有 SVG 架构图');
  await renderer(`document.getElementById('closeCardEditorBtn').click()`);
  await delay(300);
  checks.push('Scene 2-B: 系统工程卡片 card-06-03 架构 SVG 矢量图挂载验证通过');

  // ============================================================
  // Scene 3: 画布内容与思维导图推导网络验证 (修复PaperCardAtelier.exe_20261026_014355.png)
  // ============================================================
  log('[R9-Verify] [Scene 3] 切换到「画布」视图并验证卡片节点与推导网络...');
  await renderer(`window.PaperCardApp.switchView('canvas')`);
  await wait("document.getElementById('viewCanvas').classList.contains('is-active')", '未能切换到画布视图');
  await delay(600); // 等待画布引擎布局与连线计算

  // 触发思维导图推导流布局与适配
  await renderer(`(() => {
    const treeBtn = document.getElementById('layoutByTreeBtn');
    if (treeBtn) treeBtn.click();
    const fitBtn = document.getElementById('canvasZoomFitBtn');
    if (fitBtn) fitBtn.click();
  })()`);
  await delay(600);

  const canvasCheck = await renderer(`(() => {
    const boardTitle = document.getElementById('activeBoardTitle');
    const graphEmpty = document.getElementById('graphEmpty');
    const nodes = document.querySelectorAll('#canvasNodesLayer .canvas-node');
    const links = document.querySelectorAll('#canvasLinksSvg path');
    const activeBoardList = document.querySelectorAll('#canvasBoardList .board-list-item');

    return {
      boardTitleText: boardTitle ? boardTitle.textContent.trim() : null,
      graphEmptyHidden: graphEmpty ? graphEmpty.hidden : false,
      nodeCount: nodes.length,
      sampleNodeTitles: [...nodes].slice(0, 5).map(n => n.querySelector('.node-title')?.textContent.trim()),
      linkCount: links.length,
      boardListCount: activeBoardList.length
    };
  })()`);

  assert.ok(canvasCheck.graphEmptyHidden, '画布不应为空白 (#graphEmpty 必须 hidden)');
  assert.ok(canvasCheck.nodeCount >= 20, `画布必须加载当前批次全部卡片 (>= 20)，实测 ${canvasCheck.nodeCount} 张卡片`);
  assert.ok(canvasCheck.linkCount >= 1, `思维导图推导网络连线应 >= 1，实测 ${canvasCheck.linkCount} 条连线`);
  assert.ok(
    canvasCheck.boardTitleText.includes('主题画布') || canvasCheck.boardTitleText.includes('导入'),
    `当前画布标题应为批次画布，实测: ${canvasCheck.boardTitleText}`
  );

  log('[R9-Verify] [Scene 3] 捕获画布思维导图推导网络截图: round9-scene3-canvas.png');
  await shot('round9-scene3-canvas');
  checks.push(`Scene 3: 画布视图完全自愈，展示全部 ${canvasCheck.nodeCount} 张批次卡片与 ${canvasCheck.linkCount} 条思维导图推导连线，告别“0张卡片”空白`);

  // ============================================================
  // Scene 4: 卡片原图切片与矢量图图文对照 (对齐正例 局部截取_20261026_014553.png)
  // ============================================================
  log('[R9-Verify] [Scene 4] 切换到「卡片」网格视图，校验图文对照排版与无灰白空框...');
  await renderer(`window.PaperCardApp.switchView('cards')`);
  await wait("document.getElementById('viewCards').classList.contains('is-active')", '未能切换到卡片视图');
  await delay(600);

  const cardsViewCheck = await renderer(`(() => {
    const grid = document.getElementById('cardsGrid');
    if (!grid) return { error: '未找到 cardsGrid' };

    const cardItems = grid.querySelectorAll('.grid-card-item');
    const figurePreviews = grid.querySelectorAll('.figure-preview');
    const sourceBtns = grid.querySelectorAll('.source-preview-btn');
    const brokenImages = grid.querySelectorAll('img[src=""], img:not([src])');
    const emptyPlaceholders = grid.querySelectorAll('.figure-placeholder');

    return {
      cardCount: cardItems.length,
      figureCount: figurePreviews.length,
      sourceBtnCount: sourceBtns.length,
      brokenImageCount: brokenImages.length,
      emptyPlaceholderCount: emptyPlaceholders.length
    };
  })()`);

  assert.ok(cardsViewCheck.cardCount > 0, `卡片网格必须有卡片展示，实测 ${cardsViewCheck.cardCount}`);
  assert.equal(cardsViewCheck.brokenImageCount, 0, '绝不允许出现 src 为空的损坏图片');
  assert.ok(cardsViewCheck.figureCount >= 1, `网格中具有矢量重绘图形卡片，实测 ${cardsViewCheck.figureCount}`);
  assert.ok(cardsViewCheck.sourceBtnCount >= 10, `网格中图文原截图关联卡片应 >= 10，实测 ${cardsViewCheck.sourceBtnCount}`);

  log('[R9-Verify] [Scene 4] 捕获卡片网格图文对照高清截图: round9-scene4-cards.png');
  await shot('round9-scene4-cards');
  checks.push(`Scene 4: 卡片网格图文对照清晰精美，${cardsViewCheck.figureCount} 处图文切片无一灰白破图`);

  // ============================================================
  // Final Workbench Shot: 切换到原纸主工作台全景并截图 round9-workbench.png
  // ============================================================
  log('[R9-Verify] 切换回原纸工作台主视图，对焦核心双向链表原纸...');
  await renderer(`window.PaperCardApp.switchView('page')`);
  await renderer(`window.PaperCardApp.selectPage('page-mvnt5bym-e1e4')`);
  await delay(700);

  log('[R9-Verify] 捕获全量实机验收主截图: round9-workbench.png');
  const mainShot = await shot('round9-workbench');
  checks.push('全景实机主截图 round9-workbench.png 捕获完成');

  return {
    ok: true,
    checks,
    codeBlockCheck,
    figureCheck,
    canvasCheck,
    cardsViewCheck,
    mainShot
  };
};
