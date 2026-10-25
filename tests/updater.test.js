'use strict';
/**
 * updater.test.js — 客户端内同步更新模块单元测试
 *
 * 测试范围：
 * 1. 语义化版本号 (semver) 解析与比较
 * 2. GitHub Releases 数据模拟解析与更新检查 (checkForUpdates)
 * 3. IPC 通道定义、Preload API 导出与 Contracts 契约白名单
 * 4. 更新包下载流转、HTTP 302 重定向与真实进度广播
 * 5. 安装程序调用演练模式 (installUpdate dryRun) 与错误边界
 * 6. 前端渲染层 UI 结构完整性与状态机流转
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');

const updater = require('../src/main/updater');
const contracts = require('../src/shared/contracts');

// ============================================================
// 1. 语义化版本号比较 (Semver Comparison)
// ============================================================
test('Updater 1: 语义化版本号 (semver) 正确解析与对比', () => {
  // 解析测试
  const p1 = updater.parseSemver('1.0.0');
  assert.equal(p1.major, 1);
  assert.equal(p1.minor, 0);
  assert.equal(p1.patch, 0);

  const p2 = updater.parseSemver('v2.3.4-beta.1');
  assert.equal(p2.major, 2);
  assert.equal(p2.minor, 3);
  assert.equal(p2.patch, 4);
  assert.equal(p2.prerelease, 'beta.1');

  // 对比测试
  assert.equal(updater.compareSemver('1.1.0', '1.0.0'), 1);
  assert.equal(updater.compareSemver('1.0.0', '1.1.0'), -1);
  assert.equal(updater.compareSemver('1.0.0', '1.0.0'), 0);
  assert.equal(updater.compareSemver('v1.0.0', '1.0.0'), 0);
  assert.equal(updater.compareSemver('2.0.0', '1.9.9'), 1);
  assert.equal(updater.compareSemver('1.0.1', '1.0.0'), 1);
  assert.equal(updater.compareSemver('1.0.0-beta', '1.0.0'), -1);

  // isNewerVersion 判定
  assert.equal(updater.isNewerVersion('1.1.0', '1.0.0'), true);
  assert.equal(updater.isNewerVersion('2.0.0', '1.0.0'), true);
  assert.equal(updater.isNewerVersion('1.0.0', '1.0.0'), false);
  assert.equal(updater.isNewerVersion('0.9.5', '1.0.0'), false);
});

// ============================================================
// 2. Releases 数据模拟解析与更新检查 (checkForUpdates)
// ============================================================
test('Updater 2: GitHub Releases 数据解析、Asset 选取与更新检查', async () => {
  assert.equal(updater.DEFAULT_REPO, 'kelai061/notebook-manage');
  assert.equal(updater.DEFAULT_API_URL, 'https://api.github.com/repos/kelai061/notebook-manage/releases/latest');

  const mockReleaseNewer = {
    tag_name: 'v1.1.0',
    name: 'PaperCard Atelier 1.1.0 正式发布',
    body: '## 1.1.0 更新日志\n- 支持软件内同步更新\n- 性能优化与修复',
    published_at: '2026-10-25T12:00:00Z',
    assets: [
      {
        name: 'PaperCardAtelier-Setup-1.1.0.exe',
        browser_download_url: 'https://github.com/kelai061/notebook-manage/releases/download/v1.1.0/Setup-1.1.0.exe',
        size: 52428800
      },
      {
        name: 'PaperCardAtelier-1.1.0-win.zip',
        browser_download_url: 'https://github.com/kelai061/notebook-manage/releases/download/v1.1.0/win.zip',
        size: 51200000
      }
    ]
  };

  // 1. 发现新版本场景
  const checkResult1 = await updater.checkForUpdates({
    currentVersion: '1.0.0',
    mockRelease: mockReleaseNewer
  });

  assert.equal(checkResult1.hasUpdate, true, '应识别出存在新版本');
  assert.equal(checkResult1.currentVersion, '1.0.0');
  assert.equal(checkResult1.latestVersion, '1.1.0');
  assert.ok(checkResult1.releaseNotes.includes('软件内同步更新'));
  assert.equal(
    checkResult1.downloadUrl,
    'https://github.com/kelai061/notebook-manage/releases/download/v1.1.0/Setup-1.1.0.exe',
    '应优先选取 Windows Setup .exe 安装包'
  );
  assert.equal(checkResult1.assets.length, 2);

  // 验证契约校验函数
  assert.doesNotThrow(() => contracts.validateUpdateInfo(checkResult1));

  // 2. 当前已是最新版本场景
  const mockReleaseSame = {
    tag_name: 'v1.0.0',
    name: 'v1.0.0',
    body: '初始版本',
    assets: []
  };

  const checkResult2 = await updater.checkForUpdates({
    currentVersion: '1.0.0',
    mockRelease: mockReleaseSame
  });

  assert.equal(checkResult2.hasUpdate, false, '版本相同不应触发更新');
  assert.equal(checkResult2.latestVersion, '1.0.0');

  // 3. 选取资产兜底逻辑 (只存在 zip 包)
  const zipOnlyRelease = {
    tag_name: 'v1.2.0',
    assets: [{ name: 'bundle.zip', browser_download_url: 'https://example.com/bundle.zip', size: 12345 }]
  };
  const bestAsset = updater.pickBestAsset(zipOnlyRelease);
  assert.equal(bestAsset.downloadUrl, 'https://example.com/bundle.zip');
});

// ============================================================
// 3. IPC 通道定义与 Preload 白名单授权契约
// ============================================================
test('Updater 3: contracts 通道白名单、IPC 桥接契约与 preload.js 导出', () => {
  // contracts.js 验证
  assert.ok(contracts.IPC_CHANNELS.includes('updater:check'), 'IPC_CHANNELS 必须包含 updater:check');
  assert.ok(contracts.IPC_CHANNELS.includes('updater:download'), 'IPC_CHANNELS 必须包含 updater:download');
  assert.ok(contracts.IPC_CHANNELS.includes('updater:install'), 'IPC_CHANNELS 必须包含 updater:install');
  assert.ok(contracts.UPDATER_CHANNELS, '必须导出 UPDATER_CHANNELS 常量对象');
  assert.equal(contracts.UPDATER_CHANNELS.CHECK, 'updater:check');
  assert.equal(contracts.UPDATER_CHANNELS.DOWNLOAD, 'updater:download');
  assert.equal(contracts.UPDATER_CHANNELS.INSTALL, 'updater:install');
  assert.equal(contracts.UPDATER_CHANNELS.PROGRESS, 'updater:progress');

  // preload.js 文件验证
  const preloadPath = path.join(__dirname, '..', 'src', 'main', 'preload.js');
  const preloadAltPath = path.join(__dirname, '..', 'src', 'preload', 'preload.js');
  assert.ok(fs.existsSync(preloadPath), '必须存在 src/main/preload.js');
  assert.ok(fs.existsSync(preloadAltPath), '必须存在 src/preload/preload.js');

  const preloadCode = fs.readFileSync(preloadPath, 'utf8');
  assert.ok(preloadCode.includes("exposeInMainWorld('electronAPI'"), 'preload 必须向主世界暴露 electronAPI');
  assert.ok(preloadCode.includes('checkUpdate('), 'electronAPI 必须包含 checkUpdate');
  assert.ok(preloadCode.includes('downloadUpdate('), 'electronAPI 必须包含 downloadUpdate');
  assert.ok(preloadCode.includes('installUpdate('), 'electronAPI 必须包含 installUpdate');
  assert.ok(preloadCode.includes('onUpdateProgress('), 'electronAPI 必须包含 onUpdateProgress');

  // api.js 桥接层验证
  const apiCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'api.js'), 'utf8');
  assert.ok(apiCode.includes('checkUpdate(') && apiCode.includes('downloadUpdate('), 'api.js 必须桥接更新方法');
});

// ============================================================
// 4. 下载更新包、HTTP 302 重定向与进度广播流转
// ============================================================
test('Updater 4: 本地 HTTP 服务模拟下载流转、302 重定向与真实进度广播', async () => {
  const dummyPayload = Buffer.alloc(1024 * 64, 'X'); // 64 KB 模拟安装包
  let redirectHit = false;

  // 搭建本地测试 HTTP 服务器，模拟 GitHub -> CDN 302 重定向链路
  const server = http.createServer((req, res) => {
    if (req.url === '/download/setup.exe') {
      redirectHit = true;
      res.writeHead(302, { Location: '/cdn/setup.exe' });
      res.end();
      return;
    }

    if (req.url === '/cdn/setup.exe') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': dummyPayload.length
      });
      // 分段发送模拟网络流
      const half = dummyPayload.length / 2;
      res.write(dummyPayload.subarray(0, half));
      setTimeout(() => {
        res.end(dummyPayload.subarray(half));
      }, 50);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const initialUrl = `http://127.0.0.1:${port}/download/setup.exe`;

  const progressEvents = [];
  const tmpDir = path.join(os.tmpdir(), `papercard-test-${Date.now()}`);

  try {
    const downloadRes = await updater.downloadUpdate(initialUrl, {
      targetDir: tmpDir,
      fileName: 'TestSetup.exe',
      onProgress: (p) => {
        progressEvents.push(p);
      }
    });

    assert.equal(redirectHit, true, '应成功跟踪 HTTP 302 重定向');
    assert.ok(fs.existsSync(downloadRes.filePath), '下载的文件应存在于指定目录');
    assert.equal(downloadRes.fileName, 'TestSetup.exe');
    assert.equal(downloadRes.fileSize, dummyPayload.length);

    // 核对文件内容完整性
    const downloadedBuf = fs.readFileSync(downloadRes.filePath);
    assert.deepEqual(downloadedBuf, dummyPayload);

    // 核对进度广播
    assert.ok(progressEvents.length > 0, '应产生至少一条进度广播事件');
    const lastEvent = progressEvents[progressEvents.length - 1];
    assert.equal(lastEvent.percent, 100, '最后一条进度广播百分比应为 100%');
    assert.equal(lastEvent.transferred, dummyPayload.length);
  } finally {
    server.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

// ============================================================
// 5. 安装更新程序演练模式 (installUpdate) 与错误处理
// ============================================================
test('Updater 5: installUpdate 演练模式验证与异常文件边界校验', async () => {
  // 1. 文件不存在时的错误抛出
  await assert.rejects(
    async () => {
      await updater.installUpdate('D:/not-exists/non-existent-setup.exe');
    },
    /安装包文件不存在/,
    '文件不存在时应抛出明确异常'
  );

  // 2. dryRun 演练模式验证
  const dummyFile = path.join(os.tmpdir(), `dryrun-test-${Date.now()}.exe`);
  fs.writeFileSync(dummyFile, 'MZ-DUMMY');

  try {
    const res = await updater.installUpdate(dummyFile, { dryRun: true });
    assert.equal(res.ok, true);
    assert.equal(res.dryRun, true);
    assert.equal(res.launched, true);
    assert.ok(res.message.includes('演练模式'));
  } finally {
    try {
      fs.unlinkSync(dummyFile);
    } catch {}
  }
});

// ============================================================
// 6. 前端 UI 结构与 UpdaterUI 控制器状态流转
// ============================================================
test('Updater 6: 前端 index.html 元素、CSS 规范与 UpdaterUIController 六态自洽流转', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
  const cssPath = path.join(__dirname, '..', 'src', 'renderer', 'styles', 'workspace-v4.css');
  const uiJsPath = path.join(__dirname, '..', 'src', 'renderer', 'js', 'updaterUI.js');

  assert.ok(fs.existsSync(htmlPath), '缺少 index.html');
  assert.ok(fs.existsSync(cssPath), '缺少 workspace-v4.css');
  assert.ok(fs.existsSync(uiJsPath), '缺少 updaterUI.js');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  // 1. 顶栏更新按钮与气泡徽标
  assert.ok(html.includes('id="checkUpdateBtn"'), 'HTML 应包含检查更新按钮 #checkUpdateBtn');
  assert.ok(html.includes('id="updateBadge"'), 'HTML 应包含更新提示气泡 #updateBadge');

  // 2. 模态弹窗及各状态元素
  assert.ok(html.includes('id="updaterModal"'), 'HTML 应包含更新模态框 #updaterModal');
  assert.ok(html.includes('id="updaterStateChecking"'), '应包含检查中状态容器 #updaterStateChecking');
  assert.ok(html.includes('id="updaterStateLatest"'), '应包含已是最新状态容器 #updaterStateLatest');
  assert.ok(html.includes('id="updaterLatestHeadline"'), '应包含已是最新标题 #updaterLatestHeadline');
  assert.ok(html.includes('id="updaterStateAvailable"'), '应包含发现新版本状态容器 #updaterStateAvailable');
  assert.ok(html.includes('id="updaterNewVersion"'), '应包含新版本标签 #updaterNewVersion');
  assert.ok(html.includes('id="updaterReleaseNotes"'), '应包含更新日志容器 #updaterReleaseNotes');
  assert.ok(html.includes('id="updaterStateDownloading"'), '应包含下载进度容器 #updaterStateDownloading');
  assert.ok(html.includes('id="updaterProgressBar"'), '应包含真实进度条 #updaterProgressBar');
  assert.ok(html.includes('id="updaterDownloadPercent"'), '应包含下载百分比 #updaterDownloadPercent');
  assert.ok(html.includes('id="updaterStateReady"'), '应包含下载就绪容器 #updaterStateReady');
  assert.ok(html.includes('id="updaterInstallBtn"'), '应包含立即安装并重启按钮 #updaterInstallBtn');
  assert.ok(html.includes('id="updaterActionBtn"'), '应包含操作按钮 #updaterActionBtn');

  // 3. CSS 样式规范
  assert.ok(css.includes('.updater-dialog'), 'CSS 应包含 .updater-dialog 弹窗样式');
  assert.ok(css.includes('.updater-progress-bar'), 'CSS 应包含 .updater-progress-bar 进度条');
  assert.ok(css.includes('.update-badge'), 'CSS 应包含 .update-badge 气泡提示');

  // 4. 控制器状态机流转单元验证
  const { UpdaterUIController } = require('../src/renderer/js/updaterUI');
  assert.ok(typeof UpdaterUIController === 'function', 'updaterUI 必须导出 UpdaterUIController');

  // 模拟 DOM 节点验证状态切换
  const fakeElements = {
    checkUpdateBtn: {},
    updateBadge: { hidden: true },
    updaterModal: { open: false, showModal() { this.open = true; }, close() { this.open = false; } },
    updaterCancelBtn: { hidden: false, textContent: '' },
    updaterActionBtn: { hidden: true, textContent: '' },
    updaterInstallBtn: { hidden: true, textContent: '' },
    updaterStateChecking: { hidden: true },
    updaterStateLatest: { hidden: true },
    updaterStateAvailable: { hidden: true },
    updaterStateDownloading: { hidden: true },
    updaterStateReady: { hidden: true },
    updaterStateError: { hidden: true },
    updaterCurrentVerTag: { textContent: '' },
    updaterLatestHeadline: { textContent: '' },
    updaterNewVersion: { textContent: '' },
    updaterReleaseNotes: { textContent: '' },
    updaterProgressBar: { style: { width: '0%' } },
    updaterDownloadPercent: { textContent: '0%' },
    updaterDownloadMeta: { textContent: '' },
    updaterErrorMessage: { textContent: '' }
  };

  const controller = new UpdaterUIController();
  // 注入 fake 元素测试状态机逻辑
  controller.$ = (id) => fakeElements[id] || null;
  controller.initElements();

  // 测试切换至 checking
  controller.switchState('checking');
  assert.equal(fakeElements.updaterStateChecking.hidden, false);
  assert.equal(fakeElements.updaterStateAvailable.hidden, true);

  // 测试切换至 latest
  controller.switchState('latest', { currentVersion: '1.0.0' });
  assert.equal(fakeElements.updaterStateLatest.hidden, false);
  assert.equal(fakeElements.updaterLatestHeadline.textContent, '当前已是最新版本 (v1.0.0)');

  // 测试切换至 available
  controller.switchState('available', { latestVersion: '1.1.0', releaseNotes: '全新特性' });
  assert.equal(fakeElements.updaterStateAvailable.hidden, false);
  assert.equal(fakeElements.updaterNewVersion.textContent, 'v1.1.0');
  assert.equal(fakeElements.updaterReleaseNotes.textContent, '全新特性');
  assert.equal(fakeElements.updaterActionBtn.hidden, false);
  assert.equal(fakeElements.updaterActionBtn.textContent, '立即下载更新');

  // 测试切换至 downloading
  controller.switchState('downloading');
  assert.equal(fakeElements.updaterStateDownloading.hidden, false);
  assert.equal(fakeElements.updaterCancelBtn.hidden, true); // 下载期间禁止随意关闭

  // 测试进度更新
  controller.handleProgressUpdate({ percent: 75, transferred: 7864320, total: 10485760, speed: 2097152 });
  assert.equal(fakeElements.updaterProgressBar.style.width, '75%');
  assert.equal(fakeElements.updaterDownloadPercent.textContent, '75%');

  // 测试切换至 ready
  controller.switchState('ready');
  assert.equal(fakeElements.updaterStateReady.hidden, false);
  assert.equal(fakeElements.updaterInstallBtn.hidden, false);
  assert.equal(fakeElements.updaterInstallBtn.textContent, '立即安装并重启');
});
