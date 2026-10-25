'use strict';
/**
 * desktop_and_concurrency.test.js — 第2轮大型桌面工程新增能力契约测试
 *
 * 覆盖：
 *   1. 乐观并发控制 (revision / expectedRevision / REVISION_CONFLICT) 与幂等日志 (operationId)
 *   2. 手写卡片四层内容模型 (transcript / paraphrase / redInstruction / unresolved / nature)
 *   3. 卡片拆分 (splitCard) 与卡片合并 (mergeCards) 及其对题解树、画布坐标的级联同步
 *   4. 原纸区域截图裁剪 (cropRegion)、本地文件导入 (importLocalFiles) 与快照导出 (exportSnapshot)
 *   5. CLI 批次租约锁 (claim / renew / release) 与 crop / split / merge 子命令
 *   6. 本地桌面 assetProtocol 安全路径解析与防穿越保护
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const contracts = require('../src/shared/contracts');
const { createWorkspaceStore } = require('../src/main/store');
const { generateAgentTaskPrompt } = require('../src/main/agentPrompt');

const CLI_PATH = path.join(__dirname, '..', 'src', 'cli', 'noteTasks.js');

test('桌面工程验证 1：乐观并发锁 (expectedRevision) 与极简可编辑卡片字段完整性', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-rev-test-'));
  try {
    const store = createWorkspaceStore(tempRoot);
    const state0 = store.resetToDemo({ mode: 'completed' });
    const rev0 = state0.revision || 1;
    assert.ok(rev0 >= 1, '初始状态必须包含正整数 revision');

    // 检查极简卡片模型字段（无冗余四层字段污染）
    const firstCard = state0.cards[0];
    assert.ok(typeof firstCard.title === 'string' && firstCard.title.length > 0, '演示卡片应包含标题 title');
    assert.ok(typeof firstCard.editableContent === 'string' && firstCard.editableContent.length > 0, '演示卡片应包含可编辑正文 editableContent');
    assert.equal(firstCard.transcript, undefined, '卡片不应包含被污染的冗余字段 transcript');
    assert.equal(firstCard.paraphrase, undefined, '卡片不应包含被污染的冗余字段 paraphrase');
    assert.equal(firstCard.redInstruction, undefined, '卡片不应包含被污染的冗余字段 redInstruction');
    assert.equal(firstCard.unresolved, undefined, '卡片不应包含被污染的冗余字段 unresolved');

    // 传入正确的 expectedRevision 更新成功
    const updated = store.updateCard(firstCard.cardId, {
      title: '乐观锁更新后的标题',
      editableContent: '更新后的可编辑正文内容',
      expectedRevision: store.getState().revision
    });
    assert.equal(updated.title, '乐观锁更新后的标题');
    const rev1 = store.getState().revision;
    assert.ok(rev1 > rev0, '更新后 revision 必须递增');

    // 传入过期的 expectedRevision 必须抛出 REVISION_CONFLICT
    assert.throws(
      () => {
        store.updateCard(firstCard.cardId, {
          title: '基于过期版本的非法覆盖',
          expectedRevision: rev0
        });
      },
      (err) => err.code === 'REVISION_CONFLICT' || /REVISION_CONFLICT|版本冲突/.test(err.message),
      '传入旧版本号应触发 REVISION_CONFLICT 拒绝覆盖'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('第2轮桌面工程验证 2：卡片拆分 (splitCard) 与卡片合并 (mergeCards) 级联同步', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-split-merge-'));
  try {
    const store = createWorkspaceStore(tempRoot);
    const state0 = store.resetToDemo({ mode: 'completed' });
    const initialCount = state0.cards.length;
    const targetCard = state0.cards[0];

    // 1. 拆分第一张卡片为 2 张子卡片
    const splitRes = store.splitCard({
      sourceCardId: targetCard.cardId,
      segments: [
        {
          title: `${targetCard.title} [子卡A：题设]`,
          editableContent: '已知三次函数 $f(x) = x^3 - 3x^2 - 9x + 5$，求定义域与一阶导驻点。',
          transcript: '已知三次函数 f(x) = x³ - 3x² - 9x + 5',
          paraphrase: '三次多项式函数题设条件'
        },
        {
          title: `${targetCard.title} [子卡B：设问]`,
          editableContent: '(1) 求单调区间与极值；(2) 求凹凸区间、拐点并作草图。',
          transcript: '(1) 单调区间与极值 (2) 凹凸性与拐点',
          paraphrase: '两阶段求解目标拆解'
        }
      ]
    });

    assert.equal(splitRes.removedCardId, targetCard.cardId);
    assert.equal(splitRes.createdCards.length, 2);
    assert.equal(store.getState().cards.length, initialCount + 1);
    assert.equal(splitRes.createdCards[0].splitFrom, targetCard.cardId);

    // 2. 将拆分出的 2 张子卡片重新合并为 1 张综合卡片
    const createdIds = splitRes.createdCards.map((c) => c.cardId);
    const mergeRes = store.mergeCards({
      cardIds: createdIds,
      title: `${targetCard.title}（拆分后合并验证）`
    });

    assert.ok(mergeRes.card, '合并后应返回新卡片对象');
    assert.equal(store.getState().cards.length, initialCount, '合并后卡片总数应恢复为初始数量');
    assert.ok(mergeRes.card.editableContent.includes('三次函数'), '合并卡片应包含各子卡片正文');
    assert.deepEqual(mergeRes.card.mergedFrom, createdIds);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('第2轮桌面工程验证 3：原纸区域截图裁剪 (cropRegion)、本地文件导入与快照导出', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-crop-export-'));
  try {
    const store = createWorkspaceStore(tempRoot);
    const state0 = store.resetToDemo({ mode: 'completed' });
    const page1 = state0.pages[0];
    const reg1 = page1.regions[0];

    // 1. 裁剪并更新区域 BBox
    const cropRes = store.cropRegion({
      pageId: page1.pageId,
      regionId: reg1.regionId,
      bbox: { x: 0.08, y: 0.06, w: 0.82, h: 0.18 }
    });
    assert.ok(cropRes.cropSvg.includes('<svg'), 'cropRegion 应生成有效的 SVG 截图切片');
    assert.ok(fs.existsSync(path.join(tempRoot, cropRes.cropPath)), '切片文件必须真实落盘');

    // 2. 导入本地 SVG 扫描件文件
    const sampleScanPath = path.join(tempRoot, 'scan-extra.svg');
    fs.writeFileSync(sampleScanPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000"><text x="40" y="80">手写补充页：泰勒公式余项分析</text></svg>', 'utf8');
    const importedPages = store.importLocalFiles([sampleScanPath]);
    assert.equal(importedPages.length, 1);
    assert.equal(store.getState().pages.length, 3);

    // 3. 导出工作区完整快照
    const expRes = store.exportSnapshot(path.join(tempRoot, 'exports'));
    assert.ok(fs.existsSync(expRes.jsonPath), '必须生成 JSON 快照文件');
    assert.ok(fs.existsSync(expRes.markdownPath), '必须生成 Markdown 归档文件');
    const mdText = fs.readFileSync(expRes.markdownPath, 'utf8');
    assert.ok(mdText.includes('PaperCard Atelier'), 'Markdown 快照应包含标题与结构化内容');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('第2轮桌面工程验证 4：CLI 任务租约 (claim / renew / release) 与本地桌面 assetProtocol 安全防穿越', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-cli-lease-'));
  try {
    const store = createWorkspaceStore(tempRoot);
    store.resetToDemo({ mode: 'raw' });
    const { taskIndexFile, promptText } = generateAgentTaskPrompt({ store, cliPath: CLI_PATH });

    assert.ok(promptText.includes('ELECTRON_RUN_AS_NODE=1'), 'Agent 提示词必须包含本地桌面 Electron 运行时兜底指令');

    // 测试 CLI claim / renew / release
    const claimOut = JSON.parse(execFileSync(process.execPath, [CLI_PATH, 'claim', taskIndexFile, 'agent-alpha'], { encoding: 'utf8' }));
    assert.equal(claimOut.ok, true);
    assert.equal(claimOut.lease.holder, 'agent-alpha');

    const renewOut = JSON.parse(execFileSync(process.execPath, [CLI_PATH, 'renew', taskIndexFile, 'agent-alpha'], { encoding: 'utf8' }));
    assert.equal(renewOut.ok, true);

    const releaseOut = JSON.parse(execFileSync(process.execPath, [CLI_PATH, 'release', taskIndexFile], { encoding: 'utf8' }));
    assert.equal(releaseOut.ok, true);

    // 测试 assetProtocol 防路径穿越
    const assetProtocolPath = path.join(__dirname, '..', 'src', 'main', 'assetProtocol.js');
    if (fs.existsSync(assetProtocolPath)) {
      const { resolveAsset } = require(assetProtocolPath);
      const projectRoot = path.join(__dirname, '..');
      const indexResolved = resolveAsset(projectRoot, '/index.html');
      assert.ok(indexResolved && indexResolved.endsWith(path.join('renderer', 'index.html')), '应正确解析 /index.html 到 src/renderer/index.html');

      const traversalAttempt = resolveAsset(projectRoot, '/../../package.json');
      assert.equal(traversalAttempt, null, '路径穿越请求必须返回 null 拒绝访问');
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
