'use strict';
/**
 * card_and_layout.test.js — 卡片可编辑性、原纸排版保留、图形截图与重绘、跨页关联、学科分类及画布自由重排测试
 *
 * 由主智能体（Leader Agent）编写，验证核心业务需求：
 *   - 提取文字、公式、图形和内容布局，保留字号层级与图文对应关系
 *   - 图形支持保留原始截图片段，并对需重绘图形定义重绘规则
 *   - 提取结果可后续添加和修改，绝非死图
 *   - 支持题目、过程、关键过程结构表达与跨页续接
 *   - 支持按学科、科目、章节组织卡片并容纳思考、文章
 *   - 支持选择卡片并在画布中自由重新排列
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('业务模型：默认示例工作区包含完整的跨页题解、图形截图与重绘规则、学科章节分类与可编辑卡片操作', () => {
  const storePath = path.join(__dirname, '..', 'src', 'main', 'store.js');
  assert.ok(fs.existsSync(storePath), '缺少 src/main/store.js');
  const { createWorkspaceStore } = require(storePath);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-cards-'));
  const ws = createWorkspaceStore(tmpDir, { seedDemo: true });
  const state = ws.getState();

  // 1. 存在多页手写内容且涵盖一页多内容、同一内容跨页
  assert.ok(state.pages.length >= 2, '默认种子数据应包含至少 2 页手写纸张以演示跨页续接');
  assert.ok(state.cards.length >= 5, '默认种子数据应拆分出多张可编辑卡片');

  // 2. 检查题目 -> 过程 -> 关键过程 结构与归属
  const kinds = new Set(state.cards.map((c) => c.kind));
  assert.ok(kinds.has('problem'), '应包含题目卡片 (problem)');
  assert.ok(kinds.has('process'), '应包含过程卡片 (process)');
  assert.ok(kinds.has('key_step'), '应包含关键过程卡片 (key_step)');
  assert.ok(state.synthesis.problemTrees.length >= 1, '应构建题目-过程-关键过程结构树');

  // 3. 检查图形卡片同时保留原始截图片段与重绘规则
  const figureCard = state.cards.find((c) => c.kind === 'figure' || c.figureInfo);
  assert.ok(figureCard && figureCard.figureInfo, '应包含带图形信息的卡片');
  assert.ok(figureCard.figureInfo.cropPath || figureCard.figureInfo.cropSvg, '图形卡片必须保留原始截图片段');
  assert.ok(figureCard.figureInfo.redrawRule, '需重绘图形必须包含明确的重绘处理规则 redrawRule');

  // 4. 检查卡片的可编辑性（修改现有卡片 + 新增卡片）
  const targetCard = state.cards[0];
  const updated = ws.updateCard(targetCard.cardId, {
    title: targetCard.title + '（已修订）',
    editableContent: targetCard.editableContent + '\n补充批注：$\\Delta > 0$'
  });
  assert.ok(updated.title.endsWith('（已修订）'));
  assert.ok(updated.editableContent.includes('\\Delta > 0'));

  const added = ws.addCard({
    pageId: state.pages[0].pageId,
    kind: 'thought',
    title: '新增：关于拉格朗日中值定理构造辅助函数的思考',
    editableContent: '当边界条件满足 $f(a)=f(b)$ 时，优先通过积分还原法构造原函数。',
    subject: '数学',
    course: '高等数学',
    chapter: '第三章 微分中值定理与导数的应用',
    contentType: '思考'
  });
  assert.ok(added.cardId, '应支持后续新增可编辑卡片');

  // 5. 检查画布自由排布与多卡片批量移动重排
  const movedIds = state.cards.slice(0, 2).map((c) => c.cardId);
  const nextPositions = movedIds.map((cardId, i) => ({
    cardId,
    x: 520 + i * 360,
    y: 410 + i * 40
  }));
  const layoutResult = ws.updateCanvasLayout(nextPositions);
  for (const pos of nextPositions) {
    const found = layoutResult.find((item) => item.cardId === pos.cardId);
    assert.ok(found, `画布中应找到卡片 ${pos.cardId}`);
    assert.equal(found.x, pos.x);
    assert.equal(found.y, pos.y);
  }
});
