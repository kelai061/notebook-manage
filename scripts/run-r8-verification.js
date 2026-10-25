/**
 * PaperCard Atelier 第 8 轮桌面实机运行与截图验收
 *
 * 1. 采用隔离临时 profile (os.tmpdir())，绝不读写破坏用户真实 workspace。
 * 2. 注入包含 Markdown 表格、LaTeX 公式、红笔提示词及图表分区的丰富用例。
 * 3. 运行 release/PaperCardAtelier/PaperCardAtelier.exe 桌面实机。
 * 4. 自动化驱动 scenario 验证 #modifyPageBtn, #deleteBatchBtn, #deletePageBtn, #regionHintBtn, #redPenPlugin 及编辑器排版。
 * 5. 捕获 round8-workbench.png 并自动同步到 Obsidian 附件库。
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-r8-desktop-'));
const ws = path.join(profile, 'workspace');
fs.mkdirSync(path.join(ws, 'pages'), { recursive: true });
fs.mkdirSync(path.join(ws, 'crops'), { recursive: true });

// 从真实工作区复制一张纸张与截图作为沙箱图元
const sourcePages = fs.readdirSync(path.join(realWorkspace, 'pages')).filter((n) => /\.(jpe?g|png)$/i.test(n));
const pageFixtureName = sourcePages[0] || 'page-01.jpg';
if (fs.existsSync(path.join(realWorkspace, 'pages', pageFixtureName))) {
  fs.copyFileSync(path.join(realWorkspace, 'pages', pageFixtureName), path.join(ws, 'pages', 'fixture.jpg'));
}

const sourceCrops = fs.readdirSync(path.join(realWorkspace, 'crops')).filter((n) => /\.(svg|png)$/i.test(n));
if (sourceCrops.length > 0) {
  fs.copyFileSync(path.join(realWorkspace, 'crops', sourceCrops[0]), path.join(ws, 'crops', 'fixture-crop.svg'));
}

// 构造高质量的 R8 验证状态
const fixtureState = {
  schemaVersion: 6,
  revision: 1,
  activeBatchId: 'batch-math-01',
  batches: [
    { batchId: 'batch-math-01', title: '高等数学导数与级数手稿', createdAt: Date.now() - 3600000, synthesis: null },
    { batchId: 'batch-phy-02', title: '大学物理力学讲义', createdAt: Date.now() - 7200000, synthesis: null }
  ],
  pages: [
    {
      pageId: 'page-math-01',
      batchId: 'batch-math-01',
      title: '第 1 页 · 泰勒级数展开与极值判定',
      imagePath: path.join(ws, 'pages', 'fixture.jpg'),
      pageAssetUrl: 'app://local/pages/fixture.jpg',
      width: 2480,
      height: 3508,
      rotation: 0,
      partitionedAt: Date.now() - 1800000,
      corrections: null,
      regions: [
        {
          regionId: 'reg-01',
          kind: 'process',
          bbox: { x: 0.08, y: 0.12, w: 0.84, h: 0.35 },
          label: '推导区 1',
          redPenHint: '注意第二行负号展开，原稿右上角为草稿无需录入',
          aiHint: '注意第二行负号展开，原稿右上角为草稿无需录入',
          cropPath: 'app://local/crops/fixture-crop.svg'
        },
        {
          regionId: 'reg-02',
          kind: 'thought',
          bbox: { x: 0.08, y: 0.52, w: 0.84, h: 0.4 },
          label: '思考区 2',
          redPenHint: '结合柯西中值定理对照',
          aiHint: '结合柯西中值定理对照'
        }
      ]
    }
  ],
  cards: [
    {
      cardId: 'c1',
      batchId: 'batch-math-01',
      pageId: 'page-math-01',
      regionId: 'reg-01',
      title: '泰勒公式二阶展开与极值收敛性分析',
      kind: 'process',
      subject: '高等数学',
      course: '微积分II',
      chapter: '第4章 微分中值定理与导数应用',
      tags: ['泰勒公式', '极值判定', '误差项'],
      editableContent: `### 核心推导

设函数 $f(x)$ 在点 $x_0$ 处具有直到 $n+1$ 阶连续导数，其展开式为：

$$f(x) = \\sum_{k=0}^{n} \\frac{f^{(k)}(x_0)}{k!} (x - x_0)^k + R_n(x)$$

其中拉格朗日余项表达为：

$$R_n(x) = \\frac{f^{(n+1)}(\\xi)}{(n+1)!} (x - x_0)^{n+1}, \\quad \\xi \\in (x_0, x)$$

| 阶数 $n$ | 近似多项式 $P_n(x)$ | 余项误差量级 $R_n(x)$ | 收敛速度 |
| :---: | :--- | :---: | :---: |
| 1 | $f(x_0) + f'(x_0)(x - x_0)$ | $O((x - x_0)^2)$ | 线性 |
| 2 | $P_1(x) + \\frac{f''(x_0)}{2}(x - x_0)^2$ | $O((x - x_0)^3)$ | 二次 |
| 3 | $P_2(x) + \\frac{f'''(x_0)}{6}(x - x_0)^3$ | $O((x - x_0)^4)$ | 高阶极佳 |

> **红笔批注提示**：重点关注二阶导数 $f''(x_0) < 0$ 时极大值的严格负号判定。`,
      previewContent: '',
      structureBlocks: [
        { kind: 'heading', level: 3, text: '核心推导' },
        { kind: 'formula', text: 'f(x) = \\sum_{k=0}^{n} \\frac{f^{(k)}(x_0)}{k!} (x - x_0)^k + R_n(x)' }
      ],
      intraPageLinks: [],
      crossPageHypotheses: [],
      redPenHint: '注意第二行负号展开，原稿右上角为草稿无需录入',
      aiHint: '注意第二行负号展开，原稿右上角为草稿无需录入',
      figureInfo: {
        enabled: true,
        cropPath: 'app://local/crops/fixture-crop.svg',
        redrawMode: 'keep_crop'
      },
      createdAt: Date.now() - 1000000,
      updatedAt: Date.now() - 500000
    },
    {
      cardId: 'c2',
      batchId: 'batch-math-01',
      pageId: 'page-math-01',
      regionId: 'reg-02',
      title: '柯西中值定理与几何直观',
      kind: 'thought',
      subject: '高等数学',
      course: '微积分II',
      chapter: '第4章 微分中值定理与导数应用',
      tags: ['柯西中值定理', '几何直观'],
      editableContent: '若函数 $f(x), g(x)$ 满足柯西定理条件，则存在 $\\xi$ 使得 $\\frac{f(b)-f(a)}{g(b)-g(a)} = \\frac{f\'(\\xi)}{g\'(\\xi)}$。',
      previewContent: '',
      structureBlocks: [],
      intraPageLinks: [],
      crossPageHypotheses: [],
      redPenHint: '结合柯西中值定理对照',
      aiHint: '结合柯西中值定理对照',
      figureInfo: { enabled: false },
      createdAt: Date.now() - 900000,
      updatedAt: Date.now() - 400000
    }
  ],
  canvases: [],
  canvasLayout: [],
  knowledgeRelations: [],
  archives: [],
  operationLog: [],
  synthesis: null
};

fs.writeFileSync(path.join(ws, 'workspace-state.json'), JSON.stringify(fixtureState, null, 2), 'utf8');

const env = { ...process.env, PAPERCARD_HOME: ROOT, PAPERCARD_VERIFY_NODE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

console.log('[Task 4] 启动桌面客户端实机场景验收 (PaperCardAtelier.exe)...');
console.log(`[Task 4] 隔离 Profile 路径: ${profile}`);

let execFailure = null;
try {
  execFileSync(
    path.join(ROOT, 'release', 'PaperCardAtelier', 'PaperCardAtelier.exe'),
    [
      `--profile=${profile}`,
      `--scenario=${path.join(ROOT, 'scripts', 'scenarios', 'verify-r8.js')}`
    ],
    {
      cwd: ROOT,
      env,
      stdio: 'inherit',
      timeout: 60000,
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

// 检查截图并同步至 Obsidian 附件库
const generatedShot = path.join(ROOT, 'docs', 'shots', 'round8-workbench.png');
let shotExists = fs.existsSync(generatedShot);

if (shotExists) {
  if (obsidianAttachDir) {
    fs.mkdirSync(obsidianAttachDir, { recursive: true });
    const obsidianTarget = path.join(obsidianAttachDir, 'round8-workbench.png');
    fs.copyFileSync(generatedShot, obsidianTarget);
    console.log(`[Task 4] ✅ 截图已同步至 Obsidian 附件库: ${obsidianTarget}`);
  }
} else {
  // 检查是否在 profile/shots 下
  const profileShot = path.join(profile, 'shots', 'round8-workbench.png');
  if (fs.existsSync(profileShot)) {
    fs.mkdirSync(path.join(ROOT, 'docs', 'shots'), { recursive: true });
    fs.copyFileSync(profileShot, generatedShot);
    if (obsidianAttachDir) {
      fs.mkdirSync(obsidianAttachDir, { recursive: true });
      fs.copyFileSync(profileShot, path.join(obsidianAttachDir, 'round8-workbench.png'));
    }
    shotExists = true;
    console.log(`[Task 4] ✅ 截图已从 profile 同步至 docs/shots`);
  }
}

// 清理沙箱 profile
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {}

const result = {
  ok: !execFailure && unchanged && shotExists,
  execFailure,
  realWorkspaceUnchanged: unchanged,
  shotExists,
  scenarioLog
};

console.log('[Task 4] 桌面实机验收结果:', JSON.stringify({
  ok: result.ok,
  realWorkspaceUnchanged: unchanged,
  shotExists,
  error: execFailure
}, null, 2));

if (!result.ok) {
  console.error('[Task 4] Scenario Log:\n', scenarioLog);
  process.exit(1);
} else {
  console.log('[Task 4] ✅ 第 8 轮桌面实机与截图验收 100% 通过！');
}
