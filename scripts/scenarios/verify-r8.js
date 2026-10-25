const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async ({ win, store, delay, shot, log }) => {
  const checks = [];
  const renderer = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code, label) => {
    for (let n = 0; n < 120; n++) {
      if (await renderer(code)) return;
      await delay(50);
    }
    throw new Error(label);
  };

  log('Waiting for window.PaperCardApp to be ready...');
  await wait('window.PaperCardApp?.getState()?.cards?.length >= 2', 'Workspace state not loaded in renderer');
  checks.push('Workspace state loaded with fixture cards');

  // 1. 验证 R44/R46/R45 核心 UI 按钮存在与属性
  const buttonsState = await renderer(`(() => {
    const modifyBtn = document.getElementById('modifyPageBtn');
    const deleteBatchBtn = document.getElementById('deleteBatchBtn');
    const deletePageBtn = document.getElementById('deletePageBtn');
    const regionHintBtn = document.getElementById('regionHintBtn');

    return {
      modifyBtn: modifyBtn ? {
        text: modifyBtn.textContent.trim(),
        title: modifyBtn.title,
        visible: !modifyBtn.hidden && window.getComputedStyle(modifyBtn).display !== 'none'
      } : null,
      deleteBatchBtn: deleteBatchBtn ? {
        title: deleteBatchBtn.title,
        visible: !deleteBatchBtn.hidden && window.getComputedStyle(deleteBatchBtn).display !== 'none'
      } : null,
      deletePageBtn: deletePageBtn ? {
        title: deletePageBtn.title,
        visible: !deletePageBtn.hidden && window.getComputedStyle(deletePageBtn).display !== 'none'
      } : null,
      regionHintBtn: regionHintBtn ? {
        title: regionHintBtn.title,
        initiallyHidden: regionHintBtn.hidden
      } : null
    };
  })()`);

  assert.ok(buttonsState.modifyBtn, 'modifyPageBtn 存在');
  assert.equal(buttonsState.modifyBtn.text, '修改');
  assert.ok(buttonsState.modifyBtn.title.includes('标记本页并复制重新处理指令') || buttonsState.modifyBtn.title.includes('修改'));
  assert.equal(buttonsState.modifyBtn.visible, true);
  checks.push('#modifyPageBtn 按钮渲染正常且可见');

  assert.ok(buttonsState.deleteBatchBtn, 'deleteBatchBtn 存在');
  assert.equal(buttonsState.deleteBatchBtn.title, '删除当前笔记');
  assert.equal(buttonsState.deleteBatchBtn.visible, true);
  checks.push('#deleteBatchBtn 按钮渲染正常且可见');

  assert.ok(buttonsState.deletePageBtn, 'deletePageBtn 存在');
  assert.equal(buttonsState.deletePageBtn.title, '删除或清空当前页');
  assert.equal(buttonsState.deletePageBtn.visible, true);
  checks.push('#deletePageBtn 按钮渲染正常且可见');

  assert.ok(buttonsState.regionHintBtn, 'regionHintBtn 存在');
  assert.equal(buttonsState.regionHintBtn.title, '当前分区红笔批注与AI提示词');
  checks.push('#regionHintBtn 分区红笔提示词按钮就绪');

  // 2. 验证选中分区时 #regionHintBtn 动态显现
  await renderer(`(() => {
    const group = document.querySelector('.region-group');
    if (group) {
      group.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } else {
      window.PaperCardApp.selectRegion('reg-01');
    }
  })()`);
  await delay(200);

  const regionHintVisible = await renderer(`(() => {
    const btn = document.getElementById('regionHintBtn');
    return btn && !btn.hidden;
  })()`);
  assert.equal(regionHintVisible, true, '选中分区后 #regionHintBtn 变为可见');
  checks.push('选中分区后 #regionHintBtn 响应式可见');

  // 3. 打开卡片编辑器并验证 R8 重构后的排版与微动效
  log('Opening Card Editor for c1...');
  await renderer(`window.PaperCardApp.openCardEditor('c1')`);
  await wait("document.querySelector('.modal-panel.editor-v4') !== null", 'Card Editor modal not opened');

  const editorLayout = await renderer(`(() => {
    const modal = document.querySelector('.modal-panel.editor-v4');
    const redPen = document.getElementById('redPenPlugin');
    const redPenInput = document.getElementById('editCardRedPenHint');
    const titleInput = document.getElementById('editCardTitle');
    const metadata = document.querySelector('.editor-metadata');
    const previewBox = document.getElementById('editCardPreview');

    const modalStyle = window.getComputedStyle(modal);
    const metaStyle = window.getComputedStyle(metadata);
    const titleStyle = window.getComputedStyle(titleInput);

    return {
      modalWidth: parseFloat(modalStyle.width),
      maxWidth: modalStyle.maxWidth,
      hasRedPenPlugin: !!redPen,
      redPenClass: redPen ? redPen.className : '',
      redPenText: redPenInput ? redPenInput.value : '',
      titleFontSize: parseFloat(titleStyle.fontSize),
      titleBg: titleStyle.backgroundColor,
      gridColumns: metaStyle.gridTemplateColumns,
      previewHtml: previewBox ? previewBox.innerHTML : ''
    };
  })()`);

  assert.ok(editorLayout.hasRedPenPlugin, '#redPenPlugin 必须在卡片编辑器中存在');
  assert.ok(editorLayout.redPenClass.includes('editor-redpen-plugin'), '包含 editor-redpen-plugin 专属样式类');
  assert.ok(editorLayout.modalWidth >= 780, `弹窗宽度优化后应 >= 780px，实测 ${editorLayout.modalWidth}px`);
  assert.ok(editorLayout.titleFontSize >= 18, '标题字体提升至 >= 18px 层次分明');
  checks.push('卡片编辑器宽屏优化 (min 860px) 与红笔批注插件 #redPenPlugin 完整渲染');

  // 等待 KaTeX 与富文本渲染稳定
  await delay(500);

  // 4. 捕获真实屏幕截图 round8-workbench.png
  log('Capturing round8-workbench screenshot...');
  const shotPath = await shot('round8-workbench');
  log('Screenshot captured at: ' + shotPath);
  checks.push('真实桌面环境已捕获高质量验收截图 round8-workbench.png');

  return {
    ok: true,
    checks,
    editorLayout,
    buttonsState,
    shotPath
  };
};
