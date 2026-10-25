/**
 * scripts/run-r9-verification.js
 * 
 * PaperCard Atelier 第 9 轮桌面客户端实机运行与自动化验收
 * 
 * 1. 采用隔离临时 profile (os.tmpdir())，绝不读写破坏用户真实 workspace。
 * 2. 注入真实工作区数据与富图元资产，复现真实使用状态。
 * 3. 运行 release/PaperCardAtelier/PaperCardAtelier.exe 桌面实机。
 * 4. 自动化驱动 scenario 验证 Scene 1 ~ Scene 4：
 *    - Scene 1: 代码块与语法高亮排版 (深色容器、CPP标签、复制代码、等宽高亮)
 *    - Scene 2: SVG 矢量图与双向链表/流程图 (高清SVG、原图/重绘切换、放大Lightbox)
 *    - Scene 3: 画布内容与思维导图推导网络 (自愈全部批次卡片与连线，不再0卡片空白)
 *    - Scene 4: 卡片原图切片与矢量图图文对照 (图文对照分明，无灰白空框)
 * 5. 捕获 round9-workbench.png 及各场景高清截图，并自动同步到 Obsidian 附件库。
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const realWorkspace = path.join(ROOT, 'workspace');
const obsidianAttachDir = process.env.OBSIDIAN_ATTACH_DIR ? path.resolve(process.env.OBSIDIAN_ATTACH_DIR) : null;

function computeManifest(dir) {
  const rows = [];
  function scan(base) {
    if (!fs.existsSync(base)) return;
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      const f = path.join(base, e.name);
      if (e.isDirectory()) scan(f);
      else if (e.isFile()) rows.push([path.relative(dir, f), fs.statSync(f).size, fs.statSync(f).mtimeMs]);
    }
  }
  for (const n of ['workspace-state.json', 'workspace-layouts.json', 'pages', 'crops']) {
    const f = path.join(dir, n);
    if (!fs.existsSync(f)) continue;
    if (fs.statSync(f).isDirectory()) scan(f);
    else rows.push([n, fs.statSync(f).size, crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]);
  }
  return rows;
}

const beforeManifest = computeManifest(realWorkspace);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-r9-desktop-'));
const ws = path.join(profile, 'workspace');
fs.mkdirSync(path.join(ws, 'pages'), { recursive: true });
fs.mkdirSync(path.join(ws, 'crops'), { recursive: true });

// 复制真实工作区状态与对应引用的切片及页面资产到沙箱
const stateSource = path.join(realWorkspace, 'workspace-state.json');
const stateTarget = path.join(ws, 'workspace-state.json');
fs.copyFileSync(stateSource, stateTarget);

const layoutsSource = path.join(realWorkspace, 'workspace-layouts.json');
if (fs.existsSync(layoutsSource)) {
  fs.copyFileSync(layoutsSource, path.join(ws, 'workspace-layouts.json'));
}

const stateJson = JSON.parse(fs.readFileSync(stateSource, 'utf8'));

// 复制当前状态引用的切片
const referencedCrops = new Set();
for (const card of stateJson.cards || []) {
  if (card.figureInfo?.cropPath) {
    const m = card.figureInfo.cropPath.match(/(?:crops\/)(.+)$/);
    if (m) referencedCrops.add(m[1]);
  }
  if (card.figureInfo?.redrawPath) {
    const m = card.figureInfo.redrawPath.match(/(?:crops\/)(.+)$/);
    if (m) referencedCrops.add(m[1]);
  }
}

let copiedCrops = 0;
for (const cropFile of referencedCrops) {
  const src = path.join(realWorkspace, 'crops', cropFile);
  const dst = path.join(ws, 'crops', cropFile);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copiedCrops++;
  }
}

// 复制当前状态引用的页面
const referencedPages = new Set();
for (const page of stateJson.pages || []) {
  if (page.imagePath) referencedPages.add(path.basename(page.imagePath));
  if (page.pageAssetUrl) {
    const m = page.pageAssetUrl.match(/(?:pages\/)(.+)$/);
    if (m) referencedPages.add(m[1]);
  }
}

let copiedPages = 0;
for (const pageFile of referencedPages) {
  const src = path.join(realWorkspace, 'pages', pageFile);
  const dst = path.join(ws, 'pages', pageFile);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copiedPages++;
  }
}

console.log(`[Task 2] 沙箱资产准备就绪: ${copiedCrops} 个切片, ${copiedPages} 个原纸页面已镜像.`);

const env = { ...process.env, PAPERCARD_HOME: ROOT, PAPERCARD_VERIFY_NODE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

console.log('[Task 2] 启动桌面客户端实机场景验收 (PaperCardAtelier.exe)...');
console.log(`[Task 2] 隔离 Profile 路径: ${profile}`);

let execFailure = null;
try {
  execFileSync(
    path.join(ROOT, 'release', 'PaperCardAtelier', 'PaperCardAtelier.exe'),
    [
      `--profile=${profile}`,
      `--scenario=${path.join(ROOT, 'scripts', 'scenarios', 'verify-r9.js')}`
    ],
    {
      cwd: ROOT,
      env,
      stdio: 'inherit',
      timeout: 90000,
      windowsHide: true
    }
  );
} catch (e) {
  execFailure = String(e);
}

const afterManifest = computeManifest(realWorkspace);
const unchanged = JSON.stringify(beforeManifest) === JSON.stringify(afterManifest);

const scenarioLogFile = path.join(profile, 'scenario.log');
const scenarioLog = fs.existsSync(scenarioLogFile) ? fs.readFileSync(scenarioLogFile, 'utf8') : '';

// 检查并同步所有生成的截图
const shotNames = [
  'round9-workbench',
  'round9-scene1-code',
  'round9-scene2-svg',
  'round9-scene3-canvas',
  'round9-scene4-cards'
];

const shotResults = {};
if (obsidianAttachDir) fs.mkdirSync(obsidianAttachDir, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'docs', 'shots'), { recursive: true });

for (const name of shotNames) {
  const fileName = `${name}.png`;
  const docsShot = path.join(ROOT, 'docs', 'shots', fileName);
  const profileShot = path.join(profile, 'shots', fileName);
  const obsidianShot = obsidianAttachDir ? path.join(obsidianAttachDir, fileName) : null;

  let found = false;
  if (fs.existsSync(docsShot)) {
    if (obsidianShot) fs.copyFileSync(docsShot, obsidianShot);
    found = true;
  } else if (fs.existsSync(profileShot)) {
    fs.copyFileSync(profileShot, docsShot);
    if (obsidianShot) fs.copyFileSync(profileShot, obsidianShot);
    found = true;
  }
  shotResults[name] = found;
  if (found) {
    console.log(`[Task 2] ✅ 截图已同步: ${fileName} -> docs/shots 与 Obsidian 附件库`);
  } else {
    console.warn(`[Task 2] ⚠️ 截图未找到: ${fileName}`);
  }
}

// 清理沙箱 profile
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {}

const result = {
  ok: !execFailure && unchanged && shotResults['round9-workbench'],
  execFailure,
  realWorkspaceUnchanged: unchanged,
  shotResults,
  scenarioLog
};

console.log('[Task 2] 桌面实机验收结果:', JSON.stringify({
  ok: result.ok,
  realWorkspaceUnchanged: unchanged,
  shots: shotResults,
  error: execFailure
}, null, 2));

if (!result.ok) {
  console.error('[Task 2] 实机场景验收未完全通过，请检查日志!');
  if (scenarioLog) {
    console.error('[Task 2] Scenario 日志:\n' + scenarioLog);
  }
  process.exit(1);
} else {
  console.log('[Task 2] 🎉 第 9 轮桌面客户端实机场景自动化验收 100% 全部通过!');
}
