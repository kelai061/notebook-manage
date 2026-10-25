'use strict';
/**
 * store.js — 本地工作区存储引擎、原子落盘机制与乐观并发控制
 *
 * 核心能力：
 *   1. 状态持久化于 `<rootDir>/workspace-state.json`，原子安全落盘（临时文件 + 原子重命名）。
 *   2. 乐观并发控制 (Optimistic Concurrency Control)：
 *      - `state.revision`（正整数，每次保存自增 1）。
 *      - `expectedRevision` 冲突检测（contracts.validateRevisionConflict），避免多 Agent 或并发 UI 覆写。
 *      - `state.operationLog` 幂等操作日志（记录最近 200 条操作，支持幂等重试）。
 *   3. 极简卡片模型：
 *      - `editableContent`：可编辑结构化正文与公式。
 *      - `kind`：题目 (`problem`) / 过程 (`process`) / 关键过程 (`key_step`) / 图形 (`figure`) / 公式 (`formula_block`) / 思考 (`thought`) / 文章 (`article`)。
 *      - `figureInfo`：保留原始截图片段 (`cropPath` / `cropSvg`) + 重绘规则 (`redrawMode` / `redrawRule`)。
 *      - `intraPageLinks` / `crossPageHypotheses`：同页与跨页关联。
 *   4. 卡片生命周期：
 *      - 卡片拆分 (`splitCard`) 与卡片合并 (`mergeCards`)，自动维护关联关系、题解树与画布布局。
 *      - 原纸区域截图提取 (`cropRegion`)，写入 `crops/<regionId>.svg` 并同步更新卡片图文信息。
 *      - 本地文件批量导入 (`importLocalFiles`)，支持 `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`。
 *      - 工作区快照导出 (`exportSnapshot`)，输出 `papercard-snapshot.json` 与 `papercard-snapshot.md`。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contracts = require('../shared/contracts');
const {withWorkspaceLock}=require('./workspaceTransactions');

/**
 * 辅助函数：原子保存 JSON 数据
 */
function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  const jsonContent = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, jsonContent, 'utf8');

  let lastError;
  for(let attempt=0;attempt<5;attempt++) {
    try {fs.renameSync(tmpPath,filePath);return;} catch(error) {
      lastError=error;
      if(!['EPERM','EBUSY','EACCES'].includes(error.code))break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15);
    }
  }
  try {fs.unlinkSync(tmpPath);} catch {}
  lastError.retryable=true;
  throw lastError;
}

/**
 * 辅助函数：生成精细仿真手写原纸的内联 SVG 画面
 */
function generateHandwritingSvg(pageNumber) {
  if (pageNumber === 1) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1600" width="100%" height="100%">
  <defs>
    <pattern id="paper-grid-1" width="30" height="30" patternUnits="userSpaceOnUse">
      <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#ede5d2" stroke-width="0.8" opacity="0.85"/>
    </pattern>
    <filter id="ink-bleed" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <rect width="1200" height="1600" fill="#fdfbf5"/>
  <rect width="1200" height="1600" fill="url(#paper-grid-1)"/>
  <line x1="80" y1="0" x2="80" y2="1600" stroke="#f1a9a0" stroke-width="1.5" stroke-dasharray="8 4"/>
  <circle cx="40" cy="200" r="12" fill="#e8dfcb"/>
  <circle cx="40" cy="800" r="12" fill="#e8dfcb"/>
  <circle cx="40" cy="1400" r="12" fill="#e8dfcb"/>

  <g id="ink-header" filter="url(#ink-bleed)">
    <text x="120" y="70" font-family="'Caveat', 'Kaiti', 'STKaiti', cursive, sans-serif" font-size="28" font-weight="bold" fill="#1e293b">
      高等数学（上）随堂自测 · 第三章 导数应用综合题（一页多题型）
    </text>
    <line x1="120" y1="85" x2="1080" y2="85" stroke="#334155" stroke-width="2"/>
  </g>

  <g id="region-svg-101">
    <rect x="110" y="100" width="980" height="250" fill="#fefae0" fill-opacity="0.25" stroke="#d4a373" stroke-width="1.5" stroke-dasharray="6 4" rx="8"/>
    <text x="130" y="145" font-family="'STKaiti', serif" font-size="24" font-weight="bold" fill="#0f172a">
      【例题】已知三次函数 f(x) = x³ - 3x² - 9x + 5
    </text>
    <text x="130" y="195" font-family="'STKaiti', serif" font-size="20" fill="#1e293b">
      (1) 试讨论该函数的单调递增与递减区间，并求所有极值点与极值；
    </text>
    <text x="130" y="240" font-family="'STKaiti', serif" font-size="20" fill="#1e293b">
      (2) 讨论曲线凹凸性并求拐点坐标，手绘函数大致形态草图。
    </text>
    <text x="130" y="295" font-family="'Kaiti', serif" font-size="18" fill="#c2410c">
      ✎ 随堂提示：先求一阶导得驻点，符号表划分单调区间；再作图验证！
    </text>
  </g>

  <g id="region-svg-102">
    <rect x="110" y="380" width="560" height="580" fill="#f0f9ff" fill-opacity="0.25" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="6 4" rx="8"/>
    <text x="130" y="425" font-family="'STKaiti', serif" font-size="22" font-weight="bold" fill="#0369a1">
      解：(1) 对原函数求一阶导数：
    </text>
    <text x="160" y="480" font-family="'STKaiti', serif" font-size="24" fill="#0f172a">
      f'(x) = 3x² - 6x - 9
    </text>
    <text x="160" y="535" font-family="'STKaiti', serif" font-size="24" fill="#0f172a">
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= 3(x² - 2x - 3) = 3(x - 3)(x + 1)
    </text>
    <text x="130" y="605" font-family="'STKaiti', serif" font-size="20" fill="#1e293b">
      令 f'(x) = 0，解得方程的两个驻点为：
    </text>
    <rect x="180" y="635" width="340" height="60" fill="#ffffff" stroke="#0284c7" stroke-width="2" rx="4"/>
    <text x="210" y="675" font-family="'Times New Roman', serif" font-size="26" font-weight="bold" fill="#0284c7">
      x₁ = -1 ,&nbsp;&nbsp;&nbsp;&nbsp;x₂ = 3
    </text>
    <text x="130" y="750" font-family="'STKaiti', serif" font-size="20" fill="#1e293b">
      计算对应函数值：
    </text>
    <text x="160" y="800" font-family="'Times New Roman', serif" font-size="22" fill="#0f172a">
      f(-1) = (-1) - 3(1) - 9(-1) + 5 = 10
    </text>
    <text x="160" y="850" font-family="'Times New Roman', serif" font-size="22" fill="#0f172a">
      f(3) = 27 - 3(9) - 9(3) + 5 = -22
    </text>
  </g>

  <g id="region-svg-103">
    <rect x="700" y="380" width="390" height="580" fill="#faf5ff" fill-opacity="0.3" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="6 4" rx="8"/>
    <text x="720" y="420" font-family="'STKaiti', serif" font-size="20" font-weight="bold" fill="#7e22ce">
      【手绘函数图像草图】
    </text>
    <line x1="740" y1="680" x2="1050" y2="680" stroke="#475569" stroke-width="2"/>
    <line x1="840" y1="920" x2="840" y2="460" stroke="#475569" stroke-width="2"/>
    <text x="1035" y="705" font-family="'Times New Roman', serif" font-size="18" fill="#475569">x</text>
    <text x="820" y="475" font-family="'Times New Roman', serif" font-size="18" fill="#475569">y</text>
    <text x="825" y="700" font-family="'Times New Roman', serif" font-size="16" fill="#475569">O</text>

    <path d="M 750 900 C 780 880, 800 520, 820 540 S 880 840, 930 830 S 990 480, 1030 460" fill="none" stroke="#2563eb" stroke-width="3.5" stroke-linecap="round"/>

    <circle cx="815" cy="540" r="5" fill="#dc2626"/>
    <text x="735" y="530" font-family="'Times New Roman', serif" font-size="15" fill="#dc2626">(-1, 10) 极大</text>
    <line x1="790" y1="540" x2="840" y2="540" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="3 3"/>

    <circle cx="930" cy="830" r="5" fill="#dc2626"/>
    <text x="915" y="865" font-family="'Times New Roman', serif" font-size="15" fill="#dc2626">(3, -22) 极小</text>
    <line x1="905" y1="830" x2="955" y2="830" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="3 3"/>

    <circle cx="872" cy="685" r="4" fill="#16a34a"/>
    <text x="880" y="675" font-family="'STKaiti', serif" font-size="14" fill="#16a34a">拐点 (1,-6)</text>
    <text x="730" y="940" font-family="'Kaiti', serif" font-size="15" fill="#6b7280">※ 待跨页通过二阶导严格验证</text>
  </g>

  <g id="region-svg-104">
    <rect x="110" y="990" width="980" height="480" fill="#f0fdf4" fill-opacity="0.3" stroke="#22c55e" stroke-width="1.5" stroke-dasharray="6 4" rx="8"/>
    <text x="130" y="1035" font-family="'STKaiti', serif" font-size="22" font-weight="bold" fill="#15803d">
      【关键步骤】单调区间与极值判定汇总表：
    </text>
    <rect x="140" y="1060" width="920" height="220" fill="#ffffff" stroke="#334155" stroke-width="1.5"/>
    <line x1="140" y1="1130" x2="1060" y2="1130" stroke="#334155" stroke-width="1.2"/>
    <line x1="140" y1="1200" x2="1060" y2="1200" stroke="#334155" stroke-width="1.2"/>
    <line x1="320" y1="1060" x2="320" y2="1280" stroke="#334155" stroke-width="1.2"/>
    <line x1="470" y1="1060" x2="470" y2="1280" stroke="#334155" stroke-width="1.2"/>
    <line x1="620" y1="1060" x2="620" y2="1280" stroke="#334155" stroke-width="1.2"/>
    <line x1="770" y1="1060" x2="770" y2="1280" stroke="#334155" stroke-width="1.2"/>
    <line x1="920" y1="1060" x2="920" y2="1280" stroke="#334155" stroke-width="1.2"/>

    <text x="210" y="1105" font-family="'Times New Roman', serif" font-size="18" fill="#1e293b">x</text>
    <text x="350" y="1105" font-family="'Times New Roman', serif" font-size="18" fill="#1e293b">(-∞, -1)</text>
    <text x="530" y="1105" font-family="'Times New Roman', serif" font-size="18" fill="#1e293b">-1</text>
    <text x="670" y="1105" font-family="'Times New Roman', serif" font-size="18" fill="#1e293b">(-1, 3)</text>
    <text x="835" y="1105" font-family="'Times New Roman', serif" font-size="18" fill="#1e293b">3</text>
    <text x="955" y="1105" font-family="'Times New Roman', serif" font-size="18" fill="#1e293b">(3, +∞)</text>

    <text x="200" y="1175" font-family="'Times New Roman', serif" font-size="18" fill="#1e293b">f'(x)</text>
    <text x="390" y="1175" font-family="'Times New Roman', serif" font-size="22" font-weight="bold" fill="#15803d">+</text>
    <text x="535" y="1175" font-family="'Times New Roman', serif" font-size="20" fill="#1e293b">0</text>
    <text x="705" y="1175" font-family="'Times New Roman', serif" font-size="22" font-weight="bold" fill="#dc2626">-</text>
    <text x="835" y="1175" font-family="'Times New Roman', serif" font-size="20" fill="#1e293b">0</text>
    <text x="995" y="1175" font-family="'Times New Roman', serif" font-size="22" font-weight="bold" fill="#15803d">+</text>

    <text x="200" y="1250" font-family="'Times New Roman', serif" font-size="18" fill="#1e293b">f(x)</text>
    <text x="375" y="1250" font-family="'STKaiti', serif" font-size="18" fill="#15803d">单调递增 ↗</text>
    <text x="495" y="1250" font-family="'STKaiti', serif" font-size="16" fill="#dc2626">极大值 10</text>
    <text x="690" y="1250" font-family="'STKaiti', serif" font-size="18" fill="#dc2626">单调递减 ↘</text>
    <text x="800" y="1250" font-family="'STKaiti', serif" font-size="16" fill="#dc2626">极小值 -22</text>
    <text x="975" y="1250" font-family="'STKaiti', serif" font-size="18" fill="#15803d">单调递增 ↗</text>

    <text x="140" y="1335" font-family="'STKaiti', serif" font-size="20" font-weight="bold" fill="#0f172a">
      结论：单调增区间为 (-∞, -1) 和 (3, +∞)；单调减区间为 (-1, 3)。极大值为 10，极小值为 -22。
    </text>
    <text x="140" y="1385" font-family="'Kaiti', serif" font-size="19" fill="#dc2626">
      ➜ [跨页续接提示] 二阶导数求解凹凸区间与拐点证明过程见第 2 页！
    </text>
  </g>
</svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1600" width="100%" height="100%">
  <defs>
    <pattern id="paper-grid-2" width="30" height="30" patternUnits="userSpaceOnUse">
      <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#ede5d2" stroke-width="0.8" opacity="0.85"/>
    </pattern>
  </defs>
  <rect width="1200" height="1600" fill="#fdfbf5"/>
  <rect width="1200" height="1600" fill="url(#paper-grid-2)"/>
  <line x1="80" y1="0" x2="80" y2="1600" stroke="#f1a9a0" stroke-width="1.5" stroke-dasharray="8 4"/>
  <circle cx="40" cy="200" r="12" fill="#e8dfcb"/>
  <circle cx="40" cy="800" r="12" fill="#e8dfcb"/>
  <circle cx="40" cy="1400" r="12" fill="#e8dfcb"/>

  <g id="ink-header-p2">
    <text x="120" y="70" font-family="'STKaiti', serif" font-size="28" font-weight="bold" fill="#1e293b">
      高等数学（上）· 跨页承接 P1 解答与中值定理反思笔记
    </text>
    <line x1="120" y1="85" x2="1080" y2="85" stroke="#334155" stroke-width="2"/>
  </g>

  <g id="region-svg-201">
    <rect x="110" y="100" width="980" height="470" fill="#eff6ff" fill-opacity="0.3" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="6 4" rx="8"/>
    <text x="130" y="145" font-family="'STKaiti', serif" font-size="22" font-weight="bold" fill="#1d4ed8">
      【跨页续接上一页解答 (2)】求曲线凹凸性与拐点：
    </text>
    <text x="150" y="200" font-family="'STKaiti', serif" font-size="22" fill="#0f172a">
      对一阶导数 f'(x) = 3x² - 6x - 9 进一步求导，得二阶导数：
    </text>
    <text x="180" y="260" font-family="'Times New Roman', serif" font-size="26" font-weight="bold" fill="#0f172a">
      f''(x) = (3x² - 6x - 9)' = 6x - 6 = 6(x - 1)
    </text>
    <text x="150" y="325" font-family="'STKaiti', serif" font-size="20" fill="#1e293b">
      令 f''(x) = 0，解得零点 x = 1。
    </text>
    <text x="180" y="375" font-family="'STKaiti', serif" font-size="20" fill="#15803d">
      ① 当 x &lt; 1 时，f''(x) &lt; 0，曲线在 (-∞, 1) 内为凸（凹向下方 ∩）；
    </text>
    <text x="180" y="425" font-family="'STKaiti', serif" font-size="20" fill="#15803d">
      ② 当 x &gt; 1 时，f''(x) &gt; 0，曲线在 (1, +∞) 内为凹（凹向上方 ∪）。
    </text>
    <text x="150" y="485" font-family="'STKaiti', serif" font-size="20" fill="#0f172a">
      在 x = 1 处二阶导异号，故存在拐点。代入得 f(1) = 1 - 3 - 9 + 5 = -6。
    </text>
    <rect x="180" y="505" width="460" height="50" fill="#ffffff" stroke="#2563eb" stroke-width="2" rx="4"/>
    <text x="210" y="540" font-family="'STKaiti', serif" font-size="22" font-weight="bold" fill="#2563eb">
      结论：曲线唯一拐点坐标为 (1, -6)
    </text>
  </g>

  <g id="region-svg-202">
    <rect x="110" y="600" width="980" height="390" fill="#fffbeb" fill-opacity="0.3" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="6 4" rx="8"/>
    <text x="130" y="645" font-family="'STKaiti', serif" font-size="22" font-weight="bold" fill="#b45309">
      【随堂反思与解题灵感】极值点与拐点的本质联系
    </text>
    <text x="150" y="700" font-family="'STKaiti', serif" font-size="20" fill="#1e293b">
      1. 思考发现：三次函数拐点的横坐标恰好是两个极值点驻点连线的中点：
    </text>
    <text x="200" y="750" font-family="'Times New Roman', serif" font-size="24" font-weight="bold" fill="#b45309">
      x_拐 = (x₁ + x₂) / 2 = (-1 + 3) / 2 = 1 !
    </text>
    <text x="150" y="805" font-family="'STKaiti', serif" font-size="20" fill="#1e293b">
      三次多项式图像必然关于拐点 (1, -6) 呈现中心对称！可作为做题验算技巧。
    </text>
    <text x="150" y="860" font-family="'STKaiti', serif" font-size="20" fill="#1e293b">
      2. 辨析：f'(x)=0 是极值可导函数的必要条件，而非充分条件（如 y = x³）；
    </text>
    <text x="150" y="905" font-family="'STKaiti', serif" font-size="20" fill="#1e293b">
      &nbsp;&nbsp;&nbsp;同理 f''(x)=0 也只是拐点的必要条件，必须两侧异号才构成拐点！
    </text>
  </g>

  <g id="region-svg-203">
    <rect x="110" y="1020" width="980" height="480" fill="#faf5ff" fill-opacity="0.3" stroke="#9333ea" stroke-width="1.5" stroke-dasharray="6 4" rx="8"/>
    <text x="130" y="1065" font-family="'STKaiti', serif" font-size="22" font-weight="bold" fill="#7e22ce">
      【复习札记】微分中值定理与导数应用知识脉络
    </text>
    <text x="150" y="1120" font-family="'STKaiti', serif" font-size="20" fill="#1e293b">
      罗尔定理 → 拉格朗日中值定理 → 柯西中值定理，三者是微分学大厦的基石。
    </text>
    <text x="150" y="1170" font-family="'STKaiti', serif" font-size="20" fill="#1e293b">
      导数应用大题的标准四步法：
    </text>
    <text x="180" y="1220" font-family="'STKaiti', serif" font-size="19" fill="#475569">
      Step 1: 确定定义域，求一阶导 f'(x)；
    </text>
    <text x="180" y="1265" font-family="'STKaiti', serif" font-size="19" fill="#475569">
      Step 2: 解驻点与不可导点，列单调性与极值表；
    </text>
    <text x="180" y="1310" font-family="'STKaiti', serif" font-size="19" fill="#475569">
      Step 3: 求二阶导 f''(x)，判别凸凹性与拐点；
    </text>
    <text x="180" y="1355" font-family="'STKaiti', serif" font-size="19" fill="#475569">
      Step 4: 结合渐近线与特征点，画出函数形态图。
    </text>
  </g>
</svg>`;
}

const DEMO_FIGURE_CROP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 580" width="100%" height="100%">
  <rect width="390" height="580" fill="#fdfbf5"/>
  <rect width="390" height="580" fill="none" stroke="#a855f7" stroke-width="2"/>
  <line x1="40" y1="300" x2="350" y2="300" stroke="#475569" stroke-width="2"/>
  <line x1="140" y1="540" x2="140" y2="80" stroke="#475569" stroke-width="2"/>
  <path d="M 50 520 C 80 500, 100 140, 120 160 S 180 460, 230 450 S 290 100, 330 80" fill="none" stroke="#2563eb" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="115" cy="160" r="5" fill="#dc2626"/>
  <text x="35" y="150" font-family="'Times New Roman', serif" font-size="15" fill="#dc2626">(-1, 10) 极大</text>
  <circle cx="230" cy="450" r="5" fill="#dc2626"/>
  <text x="215" y="485" font-family="'Times New Roman', serif" font-size="15" fill="#dc2626">(3, -22) 极小</text>
  <circle cx="172" cy="305" r="4" fill="#16a34a"/>
  <text x="180" y="295" font-family="'STKaiti', serif" font-size="14" fill="#16a34a">拐点 (1,-6)</text>
</svg>`;

/**
 * 默认种子状态：手写纸质笔记重构的完整真实示例数据（含四层卡片模型与版本号）
 */
const DEFAULT_DEMO_STATE = Object.freeze({
  revision: 1,
  operationLog: [],
  pages: [
    {
      pageId: 'page-demo-01',
      title: '高等数学·极值与拐点综合题及函数草图（一页多内容）',
      imagePath: 'sample://math-handwriting-p1.svg',
      width: 1200,
      height: 1600,
      importedAt: 1761350000000,
      partitionedAt: 1761350100000,
      pageSummary: '包含一道三次函数极值与拐点综合题，包含题干、前半部分导数推导、手绘函数草图与一处关键驻点判别。',
      svgPreview: generateHandwritingSvg(1),
      regions: [
        {
          regionId: 'region-demo-101',
          kind: 'problem',
          bbox: { x: 0.06, y: 0.05, w: 0.88, h: 0.18 },
          label: '例题题干：三次多项式极值与拐点综合题',
          cropPath: 'crops/demo-101.svg',
          cropSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 180"><rect width="100%" height="100%" fill="#fefae0"/><text x="20" y="60" font-size="28" font-family="sans-serif">【例题】f(x) = x³ - 3x² - 9x + 5</text></svg>'
        },
        {
          regionId: 'region-demo-102',
          kind: 'process',
          bbox: { x: 0.06, y: 0.25, w: 0.52, h: 0.38 },
          label: '解题推导（一）：一阶导数与驻点计算',
          cropPath: 'crops/demo-102.svg',
          cropSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 380"><rect width="100%" height="100%" fill="#f0f9ff"/><text x="20" y="60" font-size="24">f\'(x) = 3(x-3)(x+1) = 0</text></svg>'
        },
        {
          regionId: 'region-demo-103',
          kind: 'figure',
          bbox: { x: 0.60, y: 0.25, w: 0.34, h: 0.38 },
          label: '手绘草图：三次函数形态与切线水平特征',
          cropPath: 'crops/demo-figure-103.svg',
          cropSvg: DEMO_FIGURE_CROP_SVG
        },
        {
          regionId: 'region-demo-104',
          kind: 'key_step',
          bbox: { x: 0.06, y: 0.65, w: 0.88, h: 0.28 },
          label: '关键步骤（一）：一阶导符号表与极值判别',
          cropPath: 'crops/demo-104.svg',
          cropSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 280"><rect width="100%" height="100%" fill="#f0fdf4"/><text x="20" y="50" font-size="22">单调增区间 (-∞, -1) U (3, +∞)；极值 10 与 -22</text></svg>'
        }
      ]
    },
    {
      pageId: 'page-demo-02',
      title: '高等数学·跨页二阶导数关键过程与拉格朗日思考笔记（跨页续接）',
      imagePath: 'sample://math-handwriting-p2.svg',
      width: 1200,
      height: 1600,
      importedAt: 1761350200000,
      partitionedAt: 1761350300000,
      pageSummary: '跨页续接上一页求解二阶导数与拐点坐标，附带拉格朗日中值定理与凸凹性几何意义的深入反思笔记及文章段落。',
      svgPreview: generateHandwritingSvg(2),
      regions: [
        {
          regionId: 'region-demo-201',
          kind: 'key_step',
          bbox: { x: 0.06, y: 0.05, w: 0.88, h: 0.32 },
          label: '跨页关键推导：二阶导数与拐点坐标判定',
          cropPath: 'crops/demo-201.svg',
          cropSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 320"><rect width="100%" height="100%" fill="#eff6ff"/><text x="20" y="50" font-size="24">f\'\'(x) = 6(x-1) = 0 =&gt; 拐点 (1, -6)</text></svg>'
        },
        {
          regionId: 'region-demo-202',
          kind: 'thought',
          bbox: { x: 0.06, y: 0.39, w: 0.88, h: 0.26 },
          label: '解题反思：极值与拐点充要条件及对称性思考',
          cropPath: 'crops/demo-202.svg',
          cropSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 260"><rect width="100%" height="100%" fill="#fffbeb"/><text x="20" y="50" font-size="22">拐点横坐标恰为两极值点中点，具有中心对称性</text></svg>'
        },
        {
          regionId: 'region-demo-203',
          kind: 'article',
          bbox: { x: 0.06, y: 0.67, w: 0.88, h: 0.28 },
          label: '方法札记：微分中值定理知识网络与复习指南',
          cropPath: 'crops/demo-203.svg',
          cropSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 280"><rect width="100%" height="100%" fill="#faf5ff"/><text x="20" y="50" font-size="22">罗尔定理 -&gt; 拉格朗日 -&gt; 柯西定理</text></svg>'
        }
      ]
    }
  ],
  cards: [
    {
      cardId: 'card-demo-101',
      pageId: 'page-demo-01',
      regionId: 'region-demo-101',
      kind: 'problem',
      title: '例题：讨论函数 f(x) = x³ - 3x² - 9x + 5 的单调性、极值与拐点',
      editableContent: '已知三次函数 f(x) = x³ - 3x² - 9x + 5：\n(1) 讨论该函数的单调增减区间与所有极值点；\n(2) 讨论曲线凹凸性并求拐点坐标，手绘函数形态草图。',
      typography: { headingScale: 1.4, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
      structureBlocks: [
        { kind: 'problem', text: '讨论三次多项式函数的单调性、极值与凹凸性', latex: 'f(x) = x^3 - 3x^2 - 9x + 5' }
      ],
      figureInfo: null,
      intraPageLinks: [],
      crossPageHypotheses: [],
      subject: '数学',
      course: '高等数学',
      chapter: '第三章 微分中值定理与导数的应用',
      contentType: '题目',
      tags: ['高等数学', '导数应用', '极值与拐点'],
      x: 80,
      y: 80,
      w: 320,
      h: 220,
      cluster: 'problem-1',
      updatedAt: 1761350400000
    },
    {
      cardId: 'card-demo-102',
      pageId: 'page-demo-01',
      regionId: 'region-demo-102',
      kind: 'process',
      title: '解题推导（一）：一阶导数计算与驻点求解',
      editableContent: '对 f(x) 求一阶导数：\nf\'(x) = 3x² - 6x - 9 = 3(x - 3)(x + 1)\n令 f\'(x) = 0，解得驻点 x₁ = -1，x₂ = 3。\n代入原函数得 f(-1) = 10，f(3) = -22。',
      typography: { headingScale: 1.2, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
      structureBlocks: [
        { kind: 'process', text: '求一阶导数因式分解求驻点', latex: 'f\'(x) = 3(x - 3)(x + 1) = 0 \\implies x_1 = -1, x_2 = 3' }
      ],
      figureInfo: null,
      intraPageLinks: [
        { targetRegionId: 'region-demo-101', type: 'belongs_to_problem', note: '归属于极值与拐点综合例题' }
      ],
      crossPageHypotheses: [],
      subject: '数学',
      course: '高等数学',
      chapter: '第三章 微分中值定理与导数的应用',
      contentType: '过程',
      tags: ['求导计算', '驻点', '因式分解'],
      x: 440,
      y: 80,
      w: 320,
      h: 220,
      cluster: 'problem-1',
      updatedAt: 1761350410000
    },
    {
      cardId: 'card-demo-103',
      pageId: 'page-demo-01',
      regionId: 'region-demo-103',
      kind: 'figure',
      title: '手绘草图：函数曲线形态与极值点切线示意',
      editableContent: '1. 极大值点 (-1, 10) 与极小值点 (3, -22) 处切线水平；\n2. 拐点处于 (1, -6)，曲线由上凸转为下凹。',
      typography: { headingScale: 1.2, bodyScale: 1.0, alignment: 'center', preserveLineBreaks: true },
      structureBlocks: [
        { kind: 'figure', text: '手绘草图展示了函数极大值点、极小值点以及凹凸转换过程' }
      ],
      figureInfo: {
        cropPath: 'crops/demo-figure-103.svg',
        cropSvg: DEMO_FIGURE_CROP_SVG,
        redrawMode: 'svg_redraw',
        redrawRule: '以直角坐标系重绘 y = x³ - 3x² - 9x + 5 曲线，标注水平切线与拐点坐标 (1, -6)。'
      },
      intraPageLinks: [
        { targetRegionId: 'region-demo-102', type: 'figure_reference', note: '草图对应一阶求导所得驻点与增减区间' }
      ],
      crossPageHypotheses: [
        { targetPageId: 'page-demo-02', targetRegionId: 'region-demo-201', type: 'figure_reference', confidence: 0.95, reason: '草图中的拐点标注将在第2页二阶求导中精确计算' }
      ],
      subject: '数学',
      course: '高等数学',
      chapter: '第三章 微分中值定理与导数的应用',
      contentType: '图表',
      tags: ['手绘草图', '函数图像'],
      x: 800,
      y: 80,
      w: 320,
      h: 220,
      cluster: 'problem-1',
      updatedAt: 1761350420000
    },
    {
      cardId: 'card-demo-104',
      pageId: 'page-demo-01',
      regionId: 'region-demo-104',
      kind: 'key_step',
      title: '关键步骤（一）：一阶导数符号表与极值结论',
      editableContent: '• x ∈ (-∞, -1) 时 f\'(x) > 0，单调递增 ↗\n• x ∈ (-1, 3) 时 f\'(x) < 0，单调递减 ↘\n• x ∈ (3, +∞) 时 f\'(x) > 0，单调递增 ↗\n极大值 f(-1) = 10，极小值 f(3) = -22（跨页继续求二阶导）。',
      typography: { headingScale: 1.3, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
      structureBlocks: [
        { kind: 'key_step', text: '单调性与极值点汇总判定', latex: 'f_{max} = f(-1) = 10, f_{min} = f(3) = -22' }
      ],
      figureInfo: null,
      intraPageLinks: [
        { targetRegionId: 'region-demo-102', type: 'derivation_next', note: '根据一阶导驻点划分区间建立符号表' }
      ],
      crossPageHypotheses: [
        { targetPageId: 'page-demo-02', targetRegionId: 'region-demo-201', type: 'cross_page_cont', confidence: 0.99, reason: '第1页末尾写明转入第2页二阶导数计算' }
      ],
      subject: '数学',
      course: '高等数学',
      chapter: '第三章 微分中值定理与导数的应用',
      contentType: '关键过程',
      tags: ['关键步骤', '符号表', '极值'],
      x: 80,
      y: 340,
      w: 320,
      h: 220,
      cluster: 'problem-1',
      updatedAt: 1761350430000
    },
    {
      cardId: 'card-demo-201',
      pageId: 'page-demo-02',
      regionId: 'region-demo-201',
      kind: 'key_step',
      title: '跨页续接：二阶导数求解、凹凸区间与拐点坐标',
      editableContent: '对 f\'(x) = 3x² - 6x - 9 求二阶导数：\nf\'\'(x) = 6x - 6 = 6(x - 1)，令 f\'\'(x) = 0 得 x = 1。\n• x < 1 时 f\'\'(x) < 0，曲线上凸 ∩；\n• x > 1 时 f\'\'(x) > 0，曲线下凹 ∪。\n代入得 f(1) = -6，唯一拐点坐标为 (1, -6)。',
      typography: { headingScale: 1.3, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
      structureBlocks: [
        { kind: 'key_step', text: '二阶导求拐点核心推导', latex: 'f\'\'(x)=6(x-1)=0 \\implies (1, -6)' }
      ],
      figureInfo: null,
      intraPageLinks: [],
      crossPageHypotheses: [
        { targetPageId: 'page-demo-01', targetRegionId: 'region-demo-104', type: 'cross_page_cont', confidence: 0.99, reason: '严格承接 P1 未完成的二阶导与拐点判断' }
      ],
      subject: '数学',
      course: '高等数学',
      chapter: '第三章 微分中值定理与导数的应用',
      contentType: '关键过程',
      tags: ['跨页续接', '二阶导数', '拐点'],
      x: 440,
      y: 340,
      w: 320,
      h: 220,
      cluster: 'problem-1',
      updatedAt: 1761350440000
    },
    {
      cardId: 'card-demo-202',
      pageId: 'page-demo-02',
      regionId: 'region-demo-202',
      kind: 'thought',
      title: '思考反思：关于极值与拐点判别的充要条件区别',
      editableContent: '1. f\'(x₀) = 0 只是极值必要条件（如 y = x³ 在 x = 0 无极值）；\n2. 拐点要求 f\'\'(x) 在零点两侧异号；\n3. 三次多项式拐点横坐标恰为两极值驻点中点：x_拐 = (x₁ + x₂) / 2 = 1，图像关于拐点中心对称。',
      typography: { headingScale: 1.2, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
      structureBlocks: [
        { kind: 'thought', text: '极值与拐点的充要条件对比及中心对称性', latex: 'x_c = (x_1 + x_2)/2' }
      ],
      figureInfo: null,
      intraPageLinks: [
        { targetRegionId: 'region-demo-201', type: 'thought_extension', note: '对二阶导求拐点结果的本质几何规律思考' }
      ],
      crossPageHypotheses: [],
      subject: '数学',
      course: '高等数学',
      chapter: '第三章 微分中值定理与导数的应用',
      contentType: '思考',
      tags: ['核心考点', '对称性'],
      x: 800,
      y: 340,
      w: 320,
      h: 220,
      cluster: 'thought-cluster',
      updatedAt: 1761350450000
    },
    {
      cardId: 'card-demo-203',
      pageId: 'page-demo-02',
      regionId: 'region-demo-203',
      kind: 'article',
      title: '方法札记：微分中值定理在导数应用中的知识网络',
      editableContent: '罗尔定理 → 拉格朗日中值定理 → 柯西中值定理构成微分学应用骨架。\n导数应用大题标准四步法：\n① 求定义域与一阶导 f\'(x)；② 解驻点列极值表；\n③ 求二阶导 f\'\'(x) 判凹凸与拐点；④ 结合特征点作图。',
      typography: { headingScale: 1.2, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
      structureBlocks: [
        { kind: 'article', text: '总结中值定理与导数应用之间的理论链路' }
      ],
      figureInfo: null,
      intraPageLinks: [
        { targetRegionId: 'region-demo-202', type: 'related_topic', note: '理论网络延伸' }
      ],
      crossPageHypotheses: [],
      subject: '数学',
      course: '高等数学',
      chapter: '第三章 微分中值定理与导数的应用',
      contentType: '文章',
      tags: ['总结札记', '方法论'],
      x: 440,
      y: 600,
      w: 320,
      h: 220,
      cluster: 'summary-cluster',
      updatedAt: 1761350460000
    }
  ],
  synthesis: {
    completedAt: 1761350500000,
    relations: [
      { fromCardId: 'card-demo-102', toCardId: 'card-demo-101', type: 'belongs_to_problem', label: '一阶导求解归属题干' },
      { fromCardId: 'card-demo-103', toCardId: 'card-demo-102', type: 'figure_reference', label: '草图对应驻点推导' },
      { fromCardId: 'card-demo-104', toCardId: 'card-demo-102', type: 'derivation_next', label: '驻点划分区间建立符号表' },
      { fromCardId: 'card-demo-201', toCardId: 'card-demo-104', type: 'cross_page_cont', label: '跨页推导续接：由一阶导转入二阶导' },
      { fromCardId: 'card-demo-202', toCardId: 'card-demo-201', type: 'thought_extension', label: '由拐点延伸对称性思考' },
      { fromCardId: 'card-demo-203', toCardId: 'card-demo-202', type: 'related_topic', label: '中值定理知识脉络总结' }
    ],
    problemTrees: [
      {
        problemCardId: 'card-demo-101',
        processCardIds: ['card-demo-102'],
        keyStepCardIds: ['card-demo-104', 'card-demo-201'],
        figureCardIds: ['card-demo-103'],
        thoughtCardIds: ['card-demo-202', 'card-demo-203']
      }
    ],
    canvasLayout: [
      { cardId: 'card-demo-101', x: 80, y: 80, w: 320, h: 230, cluster: 'problem-1' },
      { cardId: 'card-demo-102', x: 440, y: 80, w: 320, h: 230, cluster: 'problem-1' },
      { cardId: 'card-demo-103', x: 800, y: 80, w: 320, h: 230, cluster: 'problem-1' },
      { cardId: 'card-demo-104', x: 80, y: 350, w: 320, h: 230, cluster: 'problem-1' },
      { cardId: 'card-demo-201', x: 440, y: 350, w: 320, h: 230, cluster: 'problem-1' },
      { cardId: 'card-demo-202', x: 800, y: 350, w: 320, h: 230, cluster: 'thought-cluster' },
      { cardId: 'card-demo-203', x: 440, y: 620, w: 320, h: 230, cluster: 'summary-cluster' }
    ],
    taxonomyAssignments: [
      { cardId: 'card-demo-101', subject: '数学', course: '高等数学', chapter: '第三章 微分中值定理与导数的应用', contentType: '题目', tags: ['高等数学', '导数应用', '极值与拐点'] },
      { cardId: 'card-demo-102', subject: '数学', course: '高等数学', chapter: '第三章 微分中值定理与导数的应用', contentType: '过程', tags: ['求导计算', '驻点', '因式分解'] },
      { cardId: 'card-demo-103', subject: '数学', course: '高等数学', chapter: '第三章 微分中值定理与导数的应用', contentType: '图表', tags: ['手绘草图', '几何图形', '函数图像'] },
      { cardId: 'card-demo-104', subject: '数学', course: '高等数学', chapter: '第三章 微分中值定理与导数的应用', contentType: '关键过程', tags: ['关键步骤', '符号表', '极大值'] },
      { cardId: 'card-demo-201', subject: '数学', course: '高等数学', chapter: '第三章 微分中值定理与导数的应用', contentType: '关键过程', tags: ['跨页续接', '二阶导数', '拐点'] },
      { cardId: 'card-demo-202', subject: '数学', course: '高等数学', chapter: '第三章 微分中值定理与导数的应用', contentType: '思考', tags: ['核心考点', '反思随笔', '对称性'] },
      { cardId: 'card-demo-203', subject: '数学', course: '高等数学', chapter: '第三章 微分中值定理与导数的应用', contentType: '文章', tags: ['总结札记', '方法论', '知识图谱'] }
    ]
  }
});

/**
 * 创建或加载工作区存储
 * @param {string} rootDir 工作区持久化目录
 * @param {object} options 选项配置，如 { seedDemo: boolean }
 */
function createWorkspaceStore(rootDir, options = {seedDemo:false}) {
  return withWorkspaceLock(path.resolve(rootDir),()=>initializeWorkspaceStore(rootDir,options));
}
function initializeWorkspaceStore(rootDir, options) {
  const normalizedRoot = path.resolve(rootDir);
  const tasksDir = path.join(normalizedRoot, 'agent-tasks');
  const cropsDir = path.join(normalizedRoot, 'crops');
  const pagesDir = path.join(normalizedRoot, 'pages');
  const exportsDir = path.join(normalizedRoot, 'exports');
  const stateFile = path.join(normalizedRoot, 'workspace-state.json');
  const layoutFile = path.join(normalizedRoot, 'workspace-layouts.json');

  if (!fs.existsSync(normalizedRoot)) {
    fs.mkdirSync(normalizedRoot, { recursive: true });
  }

  let state;
  if (fs.existsSync(stateFile)) {
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/,''));
    } catch (error) {
      throw new Error(`工作区状态无法读取，已保留原文件: ${error.message}`);
    }
  }

  if (!state) {
    const templateFile = path.join(normalizedRoot, 'workspace-state.template.json');
    if (options.seedDemo !== true && fs.existsSync(templateFile)) {
      try {
        state = JSON.parse(fs.readFileSync(templateFile, 'utf8').replace(/^\uFEFF/,''));
      } catch {}
    }
    if (!state) {
      if (options.seedDemo === true) {
        state = JSON.parse(JSON.stringify(DEFAULT_DEMO_STATE));
      } else {
        state = {
          schemaVersion: 7,
          revision: 1,
          operationLog: [],
          pages: [],
          cards: [],
          synthesis: null,
          batches: [],
          activeBatchId: null,
          knowledgeRelations: [],
          archives: [],
          canvases: [],
          canvasLayout: []
        };
      }
    }
    writeJsonAtomic(stateFile, state);
  } else {
    // 补齐新增字段
    if (!state.revision) state.revision = 1;
    if (!Array.isArray(state.operationLog)) state.operationLog = [];
  }

  let persistedRevision=state.revision;
  if(fs.existsSync(layoutFile)) {
    try {
      const overlay=JSON.parse(fs.readFileSync(layoutFile,'utf8'));
      if(overlay.baseRevision===persistedRevision && overlay.revision>state.revision) {
        state.canvases=overlay.canvases;
        state.canvasLayout=overlay.canvasLayout;
        const positions=new Map(overlay.canvasLayout.map(p=>[p.cardId,p]));
        for(const card of state.cards) {
          const position=positions.get(card.cardId);
          if(position) for(const key of ['x','y','w','h','cluster']) if(position[key]!==undefined)card[key]=position[key];
        }
        if(overlay.synthesisLayout && overlay.activeBatchId===state.activeBatchId) {
          state.synthesis={...(state.synthesis || {completedAt:null}),canvasLayout:overlay.synthesisLayout};
          const batch=state.batches?.find(b=>b.batchId===state.activeBatchId);
          if(batch)batch.synthesis=state.synthesis;
        }
        state.revision=overlay.revision;
      }
    } catch(error) {
      throw new Error('画布状态无法读取，已保留原文件: '+error.message);
    }
  }

  /**
   * 一个画布对应一次笔记里的一种学科。历史数据按 学科/科目/章节 生成了大量画布，
   * 这里把自动生成的批次画布按 (批次, 学科) 合并；用户自己命名的主题画布不动。
   */

  function localVisualPath(value) {
    if(typeof value!=='string')return null;
    let relative=value.startsWith('app://local/')?value.slice(12):value;
    try {relative=decodeURIComponent(relative.split('?')[0]);}catch{return null;}
    if(relative.includes('\\') || !/^(?:pages|crops)\//.test(relative))return null;
    const full=path.resolve(normalizedRoot,relative);
    const rel=path.relative(normalizedRoot,full);
    if(rel.startsWith('..')||path.isAbsolute(rel))return null;
    if(fs.existsSync(full)) {
      const real=fs.realpathSync(full),rootReal=fs.realpathSync(normalizedRoot),inside=path.relative(rootReal,real);
      if(inside.startsWith('..')||path.isAbsolute(inside))return null;
    }
    return {relative:relative.replaceAll('\\','/'),full,url:'app://local/'+relative};
  }
  const verifiedVisualAssets=new Set();
  function persistVisual(value,folder) {
    if(typeof value!=='string')return null;
    let bytes,extension;
    const data=value.match(/^data:image\/(svg\+xml|png|jpe?g|webp)((?:;[^,]*)?),([\s\S]*)$/i);
    if(data) {
      bytes=/;base64/i.test(data[2])?Buffer.from(data[3],'base64'):Buffer.from(decodeURIComponent(data[3]),'utf8');
      extension={'svg+xml':'.svg',png:'.png',jpg:'.jpg',jpeg:'.jpg',webp:'.webp'}[data[1].toLowerCase()];
    } else if(/<svg\b/i.test(value)) {bytes=Buffer.from(value,'utf8');extension='.svg';}
    else return null;
    const hash=crypto.createHash('sha256').update(bytes).digest('hex');
    const name='visual-'+hash+extension;
    const relative=folder+'/'+name,full=path.join(normalizedRoot,folder,name);
    fs.mkdirSync(path.dirname(full),{recursive:true});
    const inside=path.relative(fs.realpathSync(normalizedRoot),fs.realpathSync(path.dirname(full)));
    if(inside.startsWith('..')||path.isAbsolute(inside))throw new Error('图像资产目录越界');
    if(fs.existsSync(full)) {
      if(!verifiedVisualAssets.has(relative)&&crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')!==hash)throw new Error('已有图像资产与内容摘要不一致，原始状态已保留');
    } else {
      const temp=full+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';
      fs.writeFileSync(temp,bytes);
      try{fs.renameSync(temp,full);}catch(error){try{fs.unlinkSync(temp);}catch{}throw error;}
    }
    verifiedVisualAssets.add(relative);
    return {relative,full,url:'app://local/'+relative};
  }
  function extractVisual(owner,key,pathKey,folder) {
    if(!owner || typeof owner[key]!=='string')return false;
    const asset=persistVisual(owner[key],folder);
    if(!asset)return false;
    owner[pathKey]=asset.url;
    return true;
  }
  function externalizeVisuals() {
    for(const page of state.pages || []) {
      extractVisual(page,'svgPreview','svgPreviewPath','pages');
      for(const region of page.regions || [])extractVisual(region,'cropSvg','cropPath','crops');
    }
    for(const card of state.cards || []) {
      const figure=card.figureInfo;if(!figure)continue;
      extractVisual(figure,'cropSvg','cropPath','crops');
      extractVisual(figure,'redrawSvg','redrawPath','crops');
      extractVisual(figure,'redrawPath','redrawPath','crops');
      if(extractVisual(figure,'vectorPreview','vectorPreviewPath','crops')&&!figure.redrawPath)figure.redrawPath=figure.vectorPreviewPath;
      if(extractVisual(figure,'redrawDataUrl','redrawDataPath','crops')&&!figure.redrawPath)figure.redrawPath=figure.redrawDataPath;
    }
    state.schemaVersion=6;
  }
  function pageSvg(page) {
    if(typeof page.svgPreview==='string'&&page.svgPreview)return page.svgPreview;
    const asset=localVisualPath(page.svgPreviewPath);
    if(asset&&fs.existsSync(asset.full))return fs.readFileSync(asset.full,'utf8');
    throw new Error('原纸SVG资源不可用，已保留页面和卡片数据');
  }
  function boardSubject(board) {
    const ids=new Set(board.cardIds || []);
    const counts=new Map();
    for(const card of state.cards || []) {
      if(!ids.has(card.cardId))continue;
      const subject=String(card.subject || '').trim();
      if(subject)counts.set(subject,(counts.get(subject) || 0)+1);
    }
    if(counts.size)return [...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0][0];
    const title=String(board.title || '').trim();
    return title.includes(' / ') ? title.split(' / ')[0].trim() : '';
  }
  function isAutoBoard(board) {
    const title=String(board.title || '').trim();
    if(title.includes(' / '))return true;
    if(board.auto !== true)return false;
    return title==='主题画布' || title===boardSubject(board);
  }
  function mergeLayouts(base,extra) {
    const merged=new Map(base.map(p=>[p.cardId,p]));
    for(const position of extra) if(position?.cardId) merged.set(position.cardId,position);
    return [...merged.values()];
  }
  function mergeRelations(base,extra) {
    const merged=new Map(base.map(r=>[r.fromCardId+'::'+r.toCardId+'::'+(r.type || ''),r]));
    for(const relation of extra) if(relation?.fromCardId && relation?.toCardId) merged.set(relation.fromCardId+'::'+relation.toCardId+'::'+(relation.type || ''),relation);
    return [...merged.values()];
  }
  function consolidateCanvases() {
    const kept=[],groups=new Map(),liveIds=new Set((state.cards || []).map(c=>c.cardId));
    for(const board of state.canvases) {
      const cardIds=[...(board.cardIds || [])].filter(id=>liveIds.has(id));
      if(board.scope!=='batch' || !isAutoBoard(board)) {kept.push({...board,cardIds:cardIds.length?cardIds:(board.cardIds || [])});continue;}
      const subject=boardSubject(board);
      if(!subject) {kept.push({...board,cardIds,auto:true});continue;}
      const key=(board.batchId || '')+'::'+subject,group=groups.get(key);
      if(!group) {
        groups.set(key,{canvasId:board.canvasId,title:subject,scope:'batch',batchId:board.batchId,cardIds:[...cardIds],layout:[...(board.layout || [])],relations:[...(board.relations || [])],auto:true});
        continue;
      }
      for(const id of cardIds) if(!group.cardIds.includes(id)) group.cardIds.push(id);
      group.layout=mergeLayouts(group.layout,board.layout || []);
      group.relations=mergeRelations(group.relations,board.relations || []);
    }
    const merged=[...groups.values()].sort((a,b)=>b.cardIds.length-a.cardIds.length || a.title.localeCompare(b.title));
    state.canvases=[...kept,...merged];
  }

  function consolidateBatchCanvases() {
    state.canvases = state.canvases || [];
    state.batches = state.batches || [];
    let modified = false;

    for (const batch of state.batches) {
      const batchCards = (state.cards || []).filter(c => c.batchId === batch.batchId);
      if (!batchCards.length) continue;
      const batchCardIds = batchCards.map(c => c.cardId);
      const batchCardIdSet = new Set(batchCardIds);

      const batchCanvases = state.canvases.filter(c => c.scope === 'batch' && c.batchId === batch.batchId);
      const synthesis = batch.synthesis || (batch.batchId === state.activeBatchId ? state.synthesis : null) || {};
      const synthesisLayout = (synthesis.canvasLayout || []).filter(l => batchCardIdSet.has(l.cardId));
      const synthesisRelations = (synthesis.relations || []).filter(r => batchCardIdSet.has(r.fromCardId) && batchCardIdSet.has(r.toCardId));

      const validAssignedCardIds = new Set(batchCanvases.flatMap(c => (c.cardIds || []).filter(id => batchCardIdSet.has(id))));

      if (batchCanvases.length === 0 || validAssignedCardIds.size === 0) {
        let targetCanvas = batchCanvases.find(c => c.auto) || batchCanvases[0];
        if (!targetCanvas) {
          targetCanvas = {
            canvasId: 'canvas-' + crypto.randomUUID(),
            title: batch.title || '主题画布',
            scope: 'batch',
            batchId: batch.batchId,
            cardIds: [],
            layout: [],
            relations: [],
            auto: true
          };
          state.canvases.push(targetCanvas);
        }
        targetCanvas.cardIds = [...batchCardIds];
        targetCanvas.layout = synthesisLayout.length ? synthesisLayout : (targetCanvas.layout?.length ? targetCanvas.layout : (state.canvasLayout || []).filter(l => batchCardIdSet.has(l.cardId)));
        targetCanvas.relations = synthesisRelations.length ? synthesisRelations : (targetCanvas.relations?.length ? targetCanvas.relations : (state.knowledgeRelations || []).filter(r => batchCardIdSet.has(r.fromCardId) && batchCardIdSet.has(r.toCardId)));
        modified = true;
      } else {
        for (const canvas of batchCanvases) {
          const cIds = new Set(canvas.cardIds || []);
          if ((!canvas.layout || !canvas.layout.length) && (synthesisLayout.length || (state.canvasLayout && state.canvasLayout.length))) {
            const positions = (synthesisLayout.length ? synthesisLayout : state.canvasLayout).filter(l => cIds.has(l.cardId));
            if (positions.length) {
              canvas.layout = positions;
              modified = true;
            }
          }
          if ((!canvas.relations || !canvas.relations.length) && (synthesisRelations.length || (state.knowledgeRelations && state.knowledgeRelations.length))) {
            const rels = (synthesisRelations.length ? synthesisRelations : state.knowledgeRelations).filter(r => cIds.has(r.fromCardId) && cIds.has(r.toCardId));
            if (rels.length) {
              canvas.relations = rels;
              modified = true;
            }
          }
        }
      }

      // 多学科时自动建立/合并学科主题画布
      const subjectMap = new Map();
      for (const card of batchCards) {
        const subj = String(card.subject || '').trim();
        if (subj) {
          if (!subjectMap.has(subj)) subjectMap.set(subj, []);
          subjectMap.get(subj).push(card);
        }
      }
      if (subjectMap.size > 1) {
        for (const [subject, subCards] of subjectMap) {
          const sIds = new Set(subCards.map(c => c.cardId));
          let sCanvas = state.canvases.find(c => c.scope === 'batch' && c.batchId === batch.batchId && c.title === subject);
          if (!sCanvas) {
            sCanvas = {
              canvasId: 'canvas-' + crypto.randomUUID(),
              title: subject,
              scope: 'batch',
              batchId: batch.batchId,
              cardIds: [...sIds],
              layout: (synthesisLayout.length ? synthesisLayout : (state.canvasLayout || [])).filter(l => sIds.has(l.cardId)),
              relations: (synthesisRelations.length ? synthesisRelations : (state.knowledgeRelations || [])).filter(r => sIds.has(r.fromCardId) && sIds.has(r.toCardId)),
              auto: true
            };
            state.canvases.push(sCanvas);
            modified = true;
          } else {
            if (!sCanvas.cardIds || !sCanvas.cardIds.length) {
              sCanvas.cardIds = [...sIds];
              modified = true;
            }
            if (!sCanvas.layout || !sCanvas.layout.length) {
              sCanvas.layout = (synthesisLayout.length ? synthesisLayout : (state.canvasLayout || [])).filter(l => sIds.has(l.cardId));
              modified = true;
            }
            if (!sCanvas.relations || !sCanvas.relations.length) {
              sCanvas.relations = (synthesisRelations.length ? synthesisRelations : (state.knowledgeRelations || [])).filter(r => sIds.has(r.fromCardId) && sIds.has(r.toCardId));
              modified = true;
            }
          }
        }
      }
    }

    return modified;
  }

  function normalizeBatches() {
    state.batches = state.batches || [];
    if (!state.batches.length && ((state.pages || []).length || (state.cards || []).length)) {
      state.batches.push({batchId:'batch-legacy', title:'已有笔记', createdAt:Date.now(), synthesis:state.synthesis || null});
      state.activeBatchId = 'batch-legacy';
    }
    state.activeBatchId = state.activeBatchId || state.batches[0]?.batchId || null;
    for (const page of state.pages || []) { page.batchId ||= state.activeBatchId; page.rotation ??= page.rotated90CW ? 90 : 0; }
    for (const card of state.cards || []) card.batchId ||= (state.pages || []).find(p=>p.pageId===card.pageId)?.batchId || state.activeBatchId;
    state.knowledgeRelations ||= [];
    state.archives ||= [];
    if(!Array.isArray(state.canvases)) {
      state.canvases=[];
      for(const batch of state.batches) {
        const cards=(state.cards || []).filter(c=>c.batchId===batch.batchId);
        // One notebook + one subject = one theme board. Chapter/course detail stays
        // inside the board; it must not multiply boards.
        const groups=new Map();
        for(const card of cards) {
          const subject=String(card.subject || '').trim() || '未分类';
          if(!groups.has(subject))groups.set(subject,[]);
          groups.get(subject).push(card);
        }
        if(!groups.size)groups.set('',[]);
        const confirmedRelations=[...(batch.synthesis?.relations || []),...(batch.batchId===state.activeBatchId ? state.synthesis?.relations || [] : []),...(state.knowledgeRelations || [])];
        for(const card of cards) {
          for(const link of card.intraPageLinks || []) {
            if(link.confirmed===false || ['unconfirmed','hypothesis','rejected'].includes(link.status))continue;
            const candidates=link.targetCardId ? cards.filter(c=>c.cardId===link.targetCardId) : cards.filter(c=>c.pageId===card.pageId && c.regionId===link.targetRegionId);
            if(candidates.length!==1 || candidates[0].cardId===card.cardId)continue;
            confirmedRelations.push({fromCardId:card.cardId,toCardId:candidates[0].cardId,type:link.type || 'related_topic',label:link.label || link.note || '',evidenceSource:'intraPageLinks'});
          }
        }
        const uniqueRelations=[...new Map(confirmedRelations.map(r=>[r.fromCardId+'::'+r.toCardId+'::'+r.type,r])).values()];
        for(const [subject,members] of groups) {
          const volumes=Math.max(1,Math.ceil(members.length/40));
          for(let part=0;part<volumes;part++) {
            const selected=members.slice(part*40,(part+1)*40);
            const ids=new Set(selected.map(c=>c.cardId));
            const title=(subject||'主题画布')+(volumes>1 ? ' · '+(part+1)+'/'+volumes : '');
            state.canvases.push({
              canvasId:'canvas-'+crypto.randomUUID(),title,scope:'batch',batchId:batch.batchId,
              cardIds:[...ids],
              // Legacy global positions remain in canvasLayout as a backup. A new
              // topic starts with an empty layout so its forest can be arranged locally.
              layout:[],
              relations:uniqueRelations.filter(r=>ids.has(r.fromCardId)&&ids.has(r.toCardId)),
              auto:true
            });
          }
        }
      }
    }
    state.schemaVersion=6;
    const layoutById=new Map((state.canvasLayout || []).map(l=>[l.cardId,l]));
    for(const card of state.cards || []) {const old=layoutById.get(card.cardId);if(old)for(const key of ['x','y','w','h','cluster'])card[key] ??= old[key];}
    state.canvasLayout=(state.cards || []).map(c=>({...layoutById.get(c.cardId),cardId:c.cardId,x:c.x ?? 80,y:c.y ?? 80,w:c.w ?? 320,h:c.h ?? 220,cluster:c.cluster || 'default'}));
    consolidateCanvases();
    consolidateBatchCanvases();
  }
  const needsStructure=state.schemaVersion<6 || !Array.isArray(state.batches) || !Array.isArray(state.canvases);
  const hasInlineVisuals = (state.pages || []).some(p => p.svgPreview && !p.svgPreviewPath) || (state.cards || []).some(c => c.figureInfo && ((c.figureInfo.cropSvg && !c.figureInfo.cropPath) || (c.figureInfo.redrawSvg && !c.figureInfo.redrawPath)));
  const needsMigration=needsStructure || hasInlineVisuals || state.schemaVersion<6;
  if(needsMigration) {
    require('./migrationBackup').backupBeforeMigration(normalizedRoot);
    if(needsStructure)normalizeBatches();
    externalizeVisuals();state.revision=Number(state.revision || 1)+1;
    state.schemaVersion=6;
    writeJsonAtomic(stateFile,state);persistedRevision=state.revision;
  }
  const healedCanvases = consolidateBatchCanvases();
  if(healedCanvases && !needsMigration) {
    writeJsonAtomic(stateFile, state);
    persistedRevision = state.revision;
  }
  const knowledgeIndexPath=path.join(normalizedRoot,'knowledge','index.md');
  if(fs.existsSync(knowledgeIndexPath))state.knowledgeMarkdownPath=knowledgeIndexPath;
  function beginBatch(title = '导入批次') {
    const old = state.batches.find(b=>b.batchId===state.activeBatchId);
    if (old) {old.synthesis = state.synthesis; archiveBatch({batchId:old.batchId,_save:false});}
    const batch = {batchId:'batch-'+crypto.randomUUID(), title, createdAt:Date.now(), synthesis:null};
    state.batches.push(batch); state.activeBatchId=batch.batchId; state.synthesis=null;
    state.canvases.push({canvasId:'canvas-'+crypto.randomUUID(),title:'主题画布',scope:'batch',batchId:batch.batchId,cardIds:[],layout:[],relations:[],auto:true});
    return batch;
  }
  function switchBatch({batchId, expectedRevision} = {}) {
    contracts.validateRevisionConflict(state.revision,expectedRevision);
    const batch=state.batches.find(b=>b.batchId===batchId);
    if (!batch) throw new Error('找不到批次: '+batchId);
    const old=state.batches.find(b=>b.batchId===state.activeBatchId); if(old) old.synthesis=state.synthesis;
    state.activeBatchId=batchId; state.synthesis=batch.synthesis || null; saveState(state); return peek();
  }
  function saveKnowledgeRelations({relations,expectedRevision} = {}) {
    contracts.validateRevisionConflict(state.revision, expectedRevision);
    if (!Array.isArray(relations)) throw new Error('relations 必须是数组');
    const ids=new Set(state.cards.map(c=>c.cardId));
    for(const r of relations) if(!ids.has(r.fromCardId)||!ids.has(r.toCardId)) throw new Error('关联引用不存在的卡片');
    state.knowledgeRelations=relations.map(r=>({...r, relationId:r.relationId || crypto.randomUUID()}));
    saveState(state); return state.knowledgeRelations;
  }
  let snapshot=null;
  let transactionDepth=0;
  let batchScope=null;
  let taskMode=null;
  function fileSignature() {
    return [stateFile,layoutFile].map(file=>{
      try {const stat=fs.statSync(file,{bigint:true});return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;} catch(error) {if(error.code==='ENOENT')return '-';throw error;}
    }).join('|');
  }
  let lastSignature=fileSignature();
  function loadLatest() {
    const latest=JSON.parse(fs.readFileSync(stateFile,'utf8').replace(/^\uFEFF/,''));
    persistedRevision=latest.revision;
    if(fs.existsSync(layoutFile)) {
      const overlay=JSON.parse(fs.readFileSync(layoutFile,'utf8').replace(/^\uFEFF/,''));
      if(overlay.baseRevision===persistedRevision && overlay.revision>latest.revision) {
        latest.canvases=overlay.canvases;latest.canvasLayout=overlay.canvasLayout;
        const positions=new Map(overlay.canvasLayout.map(p=>[p.cardId,p]));
        for(const card of latest.cards) {const pos=positions.get(card.cardId);if(pos)for(const key of ['x','y','w','h','cluster'])if(pos[key]!==undefined)card[key]=pos[key];}
        if(overlay.synthesisLayout && overlay.activeBatchId===latest.activeBatchId) {
          latest.synthesis={...(latest.synthesis || {completedAt:null}),canvasLayout:overlay.synthesisLayout};
          const batch=latest.batches.find(b=>b.batchId===latest.activeBatchId);if(batch)batch.synthesis=latest.synthesis;
        }
        latest.revision=overlay.revision;
      }
    }
    const indexPath=path.join(normalizedRoot,'knowledge','index.md');
    if(fs.existsSync(indexPath))latest.knowledgeMarkdownPath=indexPath;
    state=latest;
    const needsExternalize = (state.pages || []).some(p => p.svgPreview && !p.svgPreviewPath) || (state.cards || []).some(c => c.figureInfo && ((c.figureInfo.cropSvg && !c.figureInfo.cropPath) || (c.figureInfo.redrawSvg && !c.figureInfo.redrawPath)));
    if(state.schemaVersion<6 || needsExternalize) {
      require('./migrationBackup').backupBeforeMigration(normalizedRoot);
      externalizeVisuals();state.revision++;
      state.schemaVersion=6;
      writeJsonAtomic(stateFile,state);persistedRevision=state.revision;
    }
    snapshot=null;lastSignature=fileSignature();
  }
  function refreshFromDisk({force=false} = {}) {
    if(transactionDepth)return {changed:false,revision:state.revision};
    if(!force && fileSignature()===lastSignature)return {changed:false,revision:state.revision};
    return withWorkspaceLock(normalizedRoot,()=>{loadLatest();return {changed:true,revision:state.revision};});
  }
  function scopedState() {
    const id=batchScope || state.activeBatchId;
    const batch=state.batches.find(b=>b.batchId===id);
    return contracts.activeBatchState({...state,activeBatchId:id,synthesis:batchScope ? batch?.synthesis || null : state.synthesis});
  }
  function assertPageScope(pageId) {
    if(batchScope && !state.pages.some(p=>p.pageId===pageId&&p.batchId===batchScope)) {
      const error=new Error('页面不属于此任务绑定批次');error.code='SCOPE_MISMATCH';throw error;
    }
  }
  function assertCardScope(cardId) {
    if(batchScope && !state.cards.some(c=>c.cardId===cardId&&c.batchId===batchScope)) {
      const error=new Error('卡片不属于此任务绑定批次');error.code='SCOPE_MISMATCH';throw error;
    }
  }
  function synthesisForScope() {
    return batchScope && batchScope!==state.activeBatchId ? state.batches.find(b=>b.batchId===batchScope)?.synthesis || null : state.synthesis;
  }
  function setScopedSynthesis(value) {
    const batch=state.batches.find(b=>b.batchId===(batchScope || state.activeBatchId));
    if(batch)batch.synthesis=value;
    if(!batchScope || batchScope===state.activeBatchId)state.synthesis=value;
  }
  function invalidateSynthesis(batchId) {
    const batch=state.batches.find(b=>b.batchId===batchId);
    if(batch)batch.synthesis=null;
    if(state.activeBatchId===batchId)state.synthesis=null;
  }
  function transact(operation) {
    if(transactionDepth)return operation();
    return withWorkspaceLock(normalizedRoot,()=>{
      loadLatest();transactionDepth++;
      try {return operation();} catch(error) {loadLatest();throw error;} finally {transactionDepth--;}
    });
  }
  function runInBatch(batchId,operation,{mode} = {}) {
    return transact(()=>{
      if(!state.batches.some(b=>b.batchId===batchId)) {const error=new Error('任务绑定批次不存在');error.code='BATCH_NOT_FOUND';throw error;}
      const oldScope=batchScope,oldMode=taskMode;batchScope=batchId;taskMode=mode;
      try{return operation();}finally{batchScope=oldScope;taskMode=oldMode;}
    });
  }
  function getState() {
    refreshFromDisk();
    // A revision has one detached read snapshot. Consumers treat it as read-only.
    if(!snapshot || snapshot.revision!==state.revision) snapshot=structuredClone(state);
    return snapshot;
  }
  function peek() {
    refreshFromDisk();
    return {revision:state.revision,activeBatchId:state.activeBatchId,pagesCount:state.pages.length,cardsCount:state.cards.length,canvasCount:state.canvases.length};
  }

  /**
   * 记录幂等日志并维护容量
   */
  function logOperation(operationId, summary) {
    if (!operationId) return;
    state.operationLog = state.operationLog || [];
    state.operationLog.unshift({
      operationId,
      batchId:batchScope || state.activeBatchId,
      timestamp: Date.now(),
      resultSummary: summary
    });
    if (state.operationLog.length > 200) {
      state.operationLog.length = 200;
    }
  }

  /**
   * 校验幂等性：若操作已成功记录，则返回历史摘要
   */
  function findLoggedOperation(operationId) {
    if (!operationId || !Array.isArray(state.operationLog)) return null;
    return state.operationLog.find((op) => op.operationId === operationId && (!batchScope || op.batchId===batchScope)) || null;
  }

  /**
   * 保存状态（自增 revision 并原子落盘）
   */
  function saveState(nextState, expectedRevision, {lightweight=false} = {}) {
    if (expectedRevision !== undefined && expectedRevision !== null) {
      contracts.validateRevisionConflict(state.revision, expectedRevision);
    }
    const currentRev = Number(state.revision || 1);
    if(nextState!==state) state=structuredClone(nextState);
    externalizeVisuals();
    // Identity migration happens once at load; normal saves only synchronize small metadata.
    state.canvasLayout=state.cards.map(c=>({cardId:c.cardId,x:c.x ?? 80,y:c.y ?? 80,w:c.w ?? 320,h:c.h ?? 220,cluster:c.cluster || 'default'}));
    const active = state.batches.find(b=>b.batchId===state.activeBatchId); if(active) active.synthesis=state.synthesis;
    state.revision = currentRev + 1;
    if (!Array.isArray(state.operationLog)) state.operationLog = [];
    if(lightweight) {
      writeJsonAtomic(layoutFile,{version:1,baseRevision:persistedRevision,revision:state.revision,activeBatchId:state.activeBatchId,canvases:state.canvases,canvasLayout:state.canvasLayout,synthesisLayout:state.synthesis?.canvasLayout});
    } else {
      writeJsonAtomic(stateFile,state);
      persistedRevision=state.revision;
    }
    snapshot=null;
    lastSignature=fileSignature();
    return {revision:state.revision};
  }

  function resetToDemo(options = {}) {
    if (options && options.mode === 'raw') {
      const demo = JSON.parse(JSON.stringify(DEFAULT_DEMO_STATE));
      for (const p of demo.pages) {
        p.partitionedAt = null;
        p.regions = [];
      }
      demo.cards = [];
      demo.synthesis = null;
      demo.revision = 1;
      demo.operationLog = [];
      state = demo;
    } else {
      state = JSON.parse(JSON.stringify(DEFAULT_DEMO_STATE));
      state.revision = 1;
      state.operationLog = [];
    }
    normalizeBatches();
    externalizeVisuals();
    snapshot=null;
    writeJsonAtomic(stateFile, state);
    persistedRevision=state.revision;
    if(fs.existsSync(layoutFile)) fs.unlinkSync(layoutFile);
    return getState();
  }

  /**
   * 导入单张纸张
   */
  function importPage({ title, imagePath, width = 1200, height = 1600, svgPreview = '', rawNotes = '', newBatch = false }) {
    if(newBatch || !state.activeBatchId) beginBatch(title || '导入纸张');
    const pageId = `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const sha256 = crypto.createHash('sha256').update(`${title || ''}:${imagePath || ''}:${Date.now()}`).digest('hex');

    const defaultSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
      <rect width="100%" height="100%" fill="#fdfbf5"/>
      <text x="50" y="80" font-family="sans-serif" font-size="24" fill="#334155">${title || '未命名手写纸张'}</text>
    </svg>`;

    const page = {
      pageId,
      batchId: state.activeBatchId,
      rotation: 0,
      sha256,
      title: title || `手写纸张 ${state.pages.length + 1}`,
      imagePath: imagePath || `sample://${pageId}.svg`,
      width,
      height,
      svgPreview: svgPreview || defaultSvg,
      rawNotes,
      importedAt: Date.now(),
      partitionedAt: null,
      regions: []
    };

    state.pages = state.pages || [];
    state.pages.push(page);
    state.synthesis = null;

    saveState(state);
    return page;
  }

  /**
   * 保存页面分区信息 (Phase 1)
   */
  function savePagePartition(pageId, payload) {
    if (pageId && typeof pageId === 'object') { payload=pageId; pageId=payload.pageId; }
    assertPageScope(pageId);
    const expectedRevision = payload?.expectedRevision;
    if (expectedRevision !== undefined && expectedRevision !== null) {
      contracts.validateRevisionConflict(state.revision, expectedRevision);
    }

    if (payload?.operationId) {
      const existing = findLoggedOperation(payload.operationId);
      if (existing) {
        return (state.pages || []).find((p) => p.pageId === pageId) || existing;
      }
    }

    const { pageSummary = '', regions } = payload;
    contracts.validatePagePartitionPayload({ pageId, pageSummary, regions });

    const page = (state.pages || []).find((p) => p.pageId === pageId);
    if (!page) {
      throw new Error(`找不到页面: ${pageId}`);
    }

    const existingCards=state.cards.filter(c=>c.pageId===pageId && c.regionId!=null);
    const ids=new Set(regions.map(r=>r.regionId));
    const mapping=payload.regionIdMap || {};
    if(new Set(Object.values(mapping)).size!==Object.values(mapping).length || Object.values(mapping).some(id=>!ids.has(id)))throw new Error('regionIdMap必须一一映射到提交区域');
    if(existingCards.some(c=>!ids.has(mapping[c.regionId] || c.regionId))) throw new Error('重新分区必须保留已有卡片对应 regionId；请使用 region:update 调整范围');
    const enrichedRegions = regions.map((reg) => {
      const oldId=Object.keys(mapping).find(id=>mapping[id]===reg.regionId) || reg.regionId;
      const copy = { ...(page.regions || []).find(r=>r.regionId===oldId), ...reg };
      if(copy.polygon) copy.points=copy.polygon;
      if(copy.points) copy.polygon=copy.points;
      if (!copy.cropPath) {
        copy.cropPath = `crops/${copy.regionId}.svg`;
      }
      if (!copy.cropSvg) {
        const { w, h } = copy.bbox;
        copy.cropSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(w * page.width || 800)} ${Math.round(h * page.height || 600)}">
          <rect width="100%" height="100%" fill="#faf7ee" stroke="#d4cbb8" stroke-width="2"/>
          <text x="20" y="40" font-family="sans-serif" font-size="20" fill="#2d3748">${copy.label || copy.regionId} [${copy.kind}]</text>
        </svg>`;
      }
      return copy;
    });

    for(const card of existingCards) {
      card.regionId=mapping[card.regionId] || card.regionId;
      card.intraPageLinks=(card.intraPageLinks || []).map(link=>({...link,targetRegionId:mapping[link.targetRegionId] || link.targetRegionId}));
    }
    page.pageSummary = pageSummary;
    page.regions = enrichedRegions;
    page.partitionedAt = Date.now();
    if(payload.reprocess) {
      const now=Date.now();
      const pageRequest=page.corrections && !page.corrections.resolvedAt;
      if(pageRequest)page.corrections.partitionResolvedAt=now;
      for(const region of page.regions) {
        if(pageRequest && (!region.corrections || region.corrections.resolvedAt))region.corrections={requestedAt:page.corrections.requestedAt,kind:'partition',reason:page.corrections.reason};
        if(region.corrections && !region.corrections.resolvedAt)region.corrections.partitionResolvedAt=now;
      }
    }
    for(const reg of page.regions) cropRegion({pageId,regionId:reg.regionId,_save:false});
    invalidateSynthesis(page.batchId);

    logOperation(payload?.operationId, { action: 'savePagePartition', pageId, count: regions.length });
    saveState(state);
    return page;
  }

  /**
   * 保存单个分区对应的可编辑卡片 (Phase 2)
   */
  function saveRegionCard(payload) {
    const expectedRevision = payload?.expectedRevision;
    if (expectedRevision !== undefined && expectedRevision !== null) {
      contracts.validateRevisionConflict(state.revision, expectedRevision);
    }

    if (payload?.operationId) {
      const existing = findLoggedOperation(payload.operationId);
      if (existing) {
        return (state.cards || []).find((c) => c.pageId === payload.pageId && c.regionId === payload.regionId) || existing;
      }
    }

    if(taskMode!=='recognition' && contracts.computeTaskPhase(scopedState())==='page_partition') throw new Error('请先完成当前批次所有页面分区');
    assertPageScope(payload.pageId);
    contracts.validateCardFillPayload(payload);
    if(batchScope) {
      for(const link of payload.intraPageLinks || []) {
        if(link.targetCardId)assertCardScope(link.targetCardId);
        if(link.targetRegionId && !state.pages.find(p=>p.pageId===payload.pageId)?.regions.some(r=>r.regionId===link.targetRegionId))throw new Error('同页关联目标不存在');
      }
      for(const link of payload.crossPageHypotheses || []) {
        if(link.targetPageId)assertPageScope(link.targetPageId);
        if(link.targetCardId)assertCardScope(link.targetCardId);
      }
    }

    const page = (state.pages || []).find((p) => p.pageId === payload.pageId);
    if (!page) {
      throw new Error(`对应页面不存在: ${payload.pageId}`);
    }
    const region = (page.regions || []).find((r) => r.regionId === payload.regionId);
    if (!region) {
      throw new Error(`页面 ${payload.pageId} 中未找到分区: ${payload.regionId}`);
    }

    state.cards = state.cards || [];
    let card = state.cards.find((c) => c.pageId === payload.pageId && c.regionId === payload.regionId);

    if(card && payload.cardId && payload.cardId!==card.cardId) throw new Error('重新识别必须保留原卡片ID');
    const cardId = payload.cardId || (card ? card.cardId : `card-${payload.pageId}-${payload.regionId}`);
    const kind = payload.kind || region.kind || 'process';

    if(payload.reprocess && region.corrections)region.corrections.resolvedAt=Date.now();
    if(page.corrections && !page.corrections.resolvedAt && page.corrections.partitionResolvedAt && page.regions.every(r=>!r.corrections || r.corrections.resolvedAt))page.corrections.resolvedAt=Date.now();
    const cardData = {
      cardId,
      batchId: page.batchId,
      previewContent: payload.previewContent ?? (card?.previewContentIsCustom ? card.previewContent : payload.editableContent) ?? '',
      previewContentIsCustom: payload.previewContentIsCustom ?? (payload.previewContent !== undefined ? payload.previewContent !== payload.editableContent : Boolean(card?.previewContentIsCustom)),
      unreadable: Boolean(payload.unreadable),
      pageId: payload.pageId,
      regionId: payload.regionId,
      kind,
      title: payload.title.trim(),
      editableContent: payload.editableContent.trim(),
      typography: payload.typography || { headingScale: 1.0, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
      structureBlocks: payload.structureBlocks,
      figureInfo: {cropPath:region.cropPath,cropSvg:region.cropSvg,redrawMode:'keep_crop',...(card?.figureInfo || {}),...(payload.figureInfo || {})},
      intraPageLinks: payload.intraPageLinks || [],
      crossPageHypotheses: payload.crossPageHypotheses || [],
      subject: payload.subject || card?.subject || '未分类',
      course: payload.course || card?.course || '未分类',
      chapter: payload.chapter || card?.chapter || '未分类章节',
      contentType: payload.contentType || card?.contentType || (kind === 'problem' ? '题目' : kind === 'thought' ? '思考' : kind === 'article' ? '文章' : '题解卡片'),
      tags: payload.tags || card?.tags || [],
      redPenHint: payload.redPenHint || payload.aiHint || card?.redPenHint || region.redPenHint || region.aiHint || '',
      aiHint: payload.aiHint || payload.redPenHint || card?.aiHint || region.aiHint || region.redPenHint || '',
      x: card?.x ?? (80 + ((state.cards.length) % 3) * 340),
      y: card?.y ?? (80 + Math.floor((state.cards.length) / 3) * 260),
      w: card?.w ?? 320,
      h: card?.h ?? 220,
      cluster: card?.cluster ?? 'default',
      updatedAt: Date.now()
    };

    if (card) {
      Object.assign(card, cardData);
    } else {
      state.cards.push(cardData);
      card = cardData;
    }

    logOperation(payload?.operationId, { action: 'saveRegionCard', cardId, title: card.title });
    saveState(state);
    return card;
  }

  /**
   * 保存整页所有分区对应的可编辑卡片 (Phase 2: page_card_fill)
   */
  function savePageCards(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('整页卡片提交格式无效：必须为 JSON 对象');
    }
    const expectedRevision = payload?.expectedRevision;
    if (expectedRevision !== undefined && expectedRevision !== null) {
      contracts.validateRevisionConflict(state.revision, expectedRevision);
    }

    if (payload?.operationId) {
      const existing = findLoggedOperation(payload.operationId);
      if (existing) {
        const pageCards = (state.cards || []).filter((c) => c.pageId === payload.pageId);
        return { pageId: payload.pageId, cards: pageCards, count: pageCards.length };
      }
    }

    if (taskMode !== 'recognition' && contracts.computeTaskPhase(scopedState()) === 'page_partition') {
      throw new Error('请先完成当前批次所有页面分区');
    }
    assertPageScope(payload.pageId);
    contracts.validatePageCardsPayload(payload);

    const page = (state.pages || []).find((p) => p.pageId === payload.pageId);
    if (!page) {
      throw new Error(`对应页面不存在: ${payload.pageId}`);
    }

    if (typeof payload.pageSummary === 'string' && payload.pageSummary.trim()) {
      page.pageSummary = payload.pageSummary.trim();
    }

    state.cards = state.cards || [];
    const savedCards = [];

    for (const cardPayload of payload.cards) {
      const region = (page.regions || []).find((r) => r.regionId === cardPayload.regionId);
      if (!region) {
        throw new Error(`页面 ${payload.pageId} 中未找到分区: ${cardPayload.regionId}`);
      }

      if (batchScope) {
        for (const link of cardPayload.intraPageLinks || []) {
          if (link.targetCardId) assertCardScope(link.targetCardId);
          if (link.targetRegionId && !page.regions.some((r) => r.regionId === link.targetRegionId)) {
            throw new Error('同页关联目标不存在');
          }
        }
        for (const link of cardPayload.crossPageHypotheses || []) {
          if (link.targetPageId) assertPageScope(link.targetPageId);
          if (link.targetCardId) assertCardScope(link.targetCardId);
        }
      }

      let card = state.cards.find((c) => c.pageId === payload.pageId && c.regionId === cardPayload.regionId);
      if (card && cardPayload.cardId && cardPayload.cardId !== card.cardId) {
        throw new Error('重新识别必须保留原卡片ID');
      }

      const cardId = cardPayload.cardId || (card ? card.cardId : `card-${payload.pageId}-${cardPayload.regionId}`);
      const kind = cardPayload.kind || region.kind || 'process';

      if (region.corrections) {
        region.corrections.resolvedAt = Date.now();
      }

      const cardData = {
        cardId,
        batchId: page.batchId,
        previewContent: cardPayload.previewContent ?? (card?.previewContentIsCustom ? card.previewContent : cardPayload.editableContent) ?? '',
        previewContentIsCustom: cardPayload.previewContentIsCustom ?? (cardPayload.previewContent !== undefined ? cardPayload.previewContent !== cardPayload.editableContent : Boolean(card?.previewContentIsCustom)),
        unreadable: Boolean(cardPayload.unreadable),
        pageId: payload.pageId,
        regionId: cardPayload.regionId,
        kind,
        title: cardPayload.title.trim(),
        editableContent: cardPayload.editableContent.trim(),
        typography: cardPayload.typography || card?.typography || { headingScale: 1.0, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
        structureBlocks: cardPayload.structureBlocks,
        figureInfo: {
          cropPath: region.cropPath,
          cropSvg: region.cropSvg,
          redrawMode: 'keep_crop',
          ...(card?.figureInfo || {}),
          ...(cardPayload.figureInfo || {})
        },
        intraPageLinks: cardPayload.intraPageLinks || [],
        crossPageHypotheses: cardPayload.crossPageHypotheses || [],
        subject: cardPayload.subject || card?.subject || '未分类',
        course: cardPayload.course || card?.course || '未分类',
        chapter: cardPayload.chapter || card?.chapter || '未分类章节',
        contentType: cardPayload.contentType || card?.contentType || (kind === 'problem' ? '题目' : kind === 'thought' ? '思考' : kind === 'article' ? '文章' : '题解卡片'),
        tags: cardPayload.tags || card?.tags || [],
        redPenHint: cardPayload.redPenHint || cardPayload.aiHint || card?.redPenHint || region.redPenHint || region.aiHint || '',
        aiHint: cardPayload.aiHint || cardPayload.redPenHint || card?.aiHint || region.aiHint || region.redPenHint || '',
        x: card?.x ?? (80 + ((state.cards.length) % 3) * 340),
        y: card?.y ?? (80 + Math.floor((state.cards.length) / 3) * 260),
        w: card?.w ?? 320,
        h: card?.h ?? 220,
        cluster: card?.cluster ?? 'default',
        updatedAt: Date.now()
      };

      if (card) {
        Object.assign(card, cardData);
      } else {
        state.cards.push(cardData);
        card = cardData;
      }
      savedCards.push(card);
    }

    if (page.corrections) {
      page.corrections.resolvedAt = Date.now();
    }

    logOperation(payload?.operationId, { action: 'savePageCards', pageId: payload.pageId, count: savedCards.length });
    saveState(state);
    return { pageId: payload.pageId, cards: savedCards, count: savedCards.length };
  }

  /**
   * 保存全局关联、画布排布与学科分类 (Phase 3)
   */
  function saveGlobalSynthesis(payload) {
    const expectedRevision = payload?.expectedRevision;
    if (expectedRevision !== undefined && expectedRevision !== null) {
      contracts.validateRevisionConflict(state.revision, expectedRevision);
    }

    if (payload?.operationId) {
      const existing = findLoggedOperation(payload.operationId);
      if (existing) {
        return state.synthesis || existing;
      }
    }

    if(['page_partition','region_card_fill'].includes(contracts.computeTaskPhase(scopedState()))) throw new Error('请先完成分区与全部卡片转录');
    const allCardIds = scopedState().cards.map((c) => c.cardId);
    contracts.validateGlobalSynthesisPayload(payload, allCardIds);
    const allowed=new Set(allCardIds);
    for(const item of [...(payload.canvasLayout || []),...(payload.taxonomyAssignments || [])])if(!allowed.has(item.cardId))throw new Error('整理引用了任务批次外卡片');
    for(const relation of payload.relations || [])if(!allowed.has(relation.fromCardId)||!allowed.has(relation.toCardId))throw new Error('整理关系必须在任务批次内部');
    for(const tree of payload.problemTrees || [])for(const [key,value] of Object.entries(tree))if(/(?:Id|Ids)$/.test(key))for(const id of Array.isArray(value)?value:[value])if(id && !allowed.has(id))throw new Error('题解树引用任务批次外卡片');

    const taxonomyMap = new Map((payload.taxonomyAssignments || []).map((t) => [t.cardId, t]));
    const layoutMap = new Map((payload.canvasLayout || []).map((l) => [l.cardId, l]));

    for (const card of state.cards || []) {
      if (taxonomyMap.has(card.cardId)) {
        const t = taxonomyMap.get(card.cardId);
        card.subject = t.subject;
        card.course = t.course;
        card.chapter = t.chapter;
        card.contentType = t.contentType;
        card.tags = t.tags || [];
      }
      if (layoutMap.has(card.cardId)) {
        const l = layoutMap.get(card.cardId);
        card.x = l.x;
        card.y = l.y;
        card.w = l.w ?? card.w ?? 320;
        card.h = l.h ?? card.h ?? 230;
        card.cluster = l.cluster || card.cluster || 'default';
      }
    }

    const priorUiSynthesis=state.synthesis;
    state.synthesis = {
      completedAt: Date.now(),
      relations: payload.relations || [],
      problemTrees: payload.problemTrees || [],
      canvasLayout: payload.canvasLayout || [],
      taxonomyAssignments: payload.taxonomyAssignments || []
    };

    const synthesisBatch=state.batches.find(b=>b.batchId===(batchScope || state.activeBatchId));
    if(synthesisBatch)synthesisBatch.synthesis=state.synthesis;

    // 自动维护批次画布：同步卡片、坐标与关联关系
    state.canvases = state.canvases || [];
    const targetBatchId = batchScope || state.activeBatchId;
    const batchCards = (state.cards || []).filter(c => c.batchId === targetBatchId);
    const batchCardIds = batchCards.map(c => c.cardId);
    const batchCardIdSet = new Set(batchCardIds);
    const layoutCardIds = (payload.canvasLayout || []).map(l => l.cardId).filter(id => batchCardIdSet.has(id));
    const effectiveCardIds = [...new Set([...layoutCardIds, ...batchCardIds])];

    let defaultCanvas = state.canvases.find(c => c.scope === 'batch' && c.batchId === targetBatchId && (c.auto || c.title === (synthesisBatch?.title || '主题画布') || c.title === '主题画布'));
    if (!defaultCanvas) {
      defaultCanvas = state.canvases.find(c => c.scope === 'batch' && c.batchId === targetBatchId);
    }
    if (!defaultCanvas) {
      defaultCanvas = {
        canvasId: 'canvas-' + crypto.randomUUID(),
        title: synthesisBatch?.title || '主题画布',
        scope: 'batch',
        batchId: targetBatchId,
        cardIds: [],
        layout: [],
        relations: [],
        auto: true
      };
      state.canvases.push(defaultCanvas);
    }

    defaultCanvas.cardIds = effectiveCardIds;
    defaultCanvas.layout = (payload.canvasLayout || []).filter(l => batchCardIdSet.has(l.cardId));
    defaultCanvas.relations = (payload.relations || []).filter(r => batchCardIdSet.has(r.fromCardId) && batchCardIdSet.has(r.toCardId));

    // 若 payload.problemTrees 或学科分类中划分了多个学科主题，为每个学科主题同步维护/合并对应的学科画布（title: subject）
    const subjectMap = new Map();
    for (const card of batchCards) {
      const subj = String(card.subject || '').trim();
      if (subj) {
        if (!subjectMap.has(subj)) subjectMap.set(subj, []);
        subjectMap.get(subj).push(card);
      }
    }
    if (subjectMap.size > 1) {
      for (const [subject, subCards] of subjectMap) {
        const sIds = new Set(subCards.map(c => c.cardId));
        let sCanvas = state.canvases.find(c => c.scope === 'batch' && c.batchId === targetBatchId && c.title === subject);
        if (!sCanvas) {
          sCanvas = {
            canvasId: 'canvas-' + crypto.randomUUID(),
            title: subject,
            scope: 'batch',
            batchId: targetBatchId,
            cardIds: [],
            layout: [],
            relations: [],
            auto: true
          };
          state.canvases.push(sCanvas);
        }
        sCanvas.cardIds = [...sIds];
        sCanvas.layout = (payload.canvasLayout || []).filter(l => sIds.has(l.cardId));
        sCanvas.relations = (payload.relations || []).filter(r => sIds.has(r.fromCardId) && sIds.has(r.toCardId));
      }
    }

    logOperation(payload?.operationId, { action: 'saveGlobalSynthesis', completedAt: state.synthesis.completedAt });
    const result=state.synthesis;
    if(batchScope && batchScope!==state.activeBatchId)state.synthesis=priorUiSynthesis;
    saveState(state);
    return result;
  }

  /**
   * 更新现有卡片（支持四层内容模型、动态修改，绝非死图）
   */
  function updateCard(cardId, patch, expectedRevision) {
    let scopeSynthesis=synthesisForScope();
    assertCardScope(cardId);
    const expRev = patch?.expectedRevision ?? expectedRevision;
    if (expRev !== undefined && expRev !== null) {
      contracts.validateRevisionConflict(state.revision, expRev);
    }

    if (patch?.operationId) {
      const existing = findLoggedOperation(patch.operationId);
      if (existing) {
        return (state.cards || []).find((c) => c.cardId === cardId) || existing;
      }
    }

    state.cards = state.cards || [];
    const card = state.cards.find((c) => c.cardId === cardId);
    if (!card) {
      throw new Error(`未找到卡片: ${cardId}`);
    }

    const resolvedPatch={...patch};
    if(patch.previewContent !== undefined) resolvedPatch.previewContentIsCustom=patch.previewContentIsCustom ?? (patch.previewContent !== (patch.editableContent ?? card.editableContent));
    else if(patch.editableContent !== undefined && !card.previewContentIsCustom) resolvedPatch.previewContent=patch.editableContent;
    if(batchScope && (patch.batchId && patch.batchId!==card.batchId || patch.pageId && patch.pageId!==card.pageId))throw new Error('任务不能移动卡片到其他批次');
    Object.assign(card, resolvedPatch, { updatedAt: Date.now() });

    if (scopeSynthesis && Array.isArray(scopeSynthesis.taxonomyAssignments)) {
      const taxItem = scopeSynthesis.taxonomyAssignments.find((t) => t.cardId === cardId);
      if (taxItem) {
        if (patch.subject !== undefined) taxItem.subject = patch.subject;
        if (patch.course !== undefined) taxItem.course = patch.course;
        if (patch.chapter !== undefined) taxItem.chapter = patch.chapter;
        if (patch.contentType !== undefined) taxItem.contentType = patch.contentType;
        if (patch.tags !== undefined) taxItem.tags = patch.tags;
      }
    }

    logOperation(patch?.operationId, { action: 'updateCard', cardId, title: card.title });
    setScopedSynthesis(scopeSynthesis);
    saveState(state);
    return card;
  }

  /**
   * 手动添加新卡片
   */
  function addCard(cardData) {
    let scopeSynthesis=synthesisForScope();
    if(cardData.pageId)assertPageScope(cardData.pageId);
    const cardId = cardData.cardId || `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const kind = cardData.kind || 'thought';

    const newCard = {
      cardId,
      batchId: batchScope || state.activeBatchId,
      previewContent: cardData.previewContent ?? cardData.editableContent ?? '',
      previewContentIsCustom: cardData.previewContentIsCustom ?? (cardData.previewContent !== undefined && cardData.previewContent !== cardData.editableContent),
      pageId: cardData.pageId || (scopedState().pages[0]?.pageId || 'page-custom'),
      regionId: cardData.regionId || `region-custom-${Date.now().toString(36)}`,
      kind,
      title: cardData.title || '新增卡片',
      editableContent: cardData.editableContent || '',
      typography: cardData.typography || { headingScale: 1.0, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
      structureBlocks: cardData.structureBlocks || [{ kind, text: cardData.editableContent || '' }],
      figureInfo: cardData.figureInfo || null,
      intraPageLinks: cardData.intraPageLinks || [],
      crossPageHypotheses: cardData.crossPageHypotheses || [],
      subject: cardData.subject || '未分类',
      course: cardData.course || '通识',
      chapter: cardData.chapter || '未分类章节',
      contentType: cardData.contentType || (kind === 'thought' ? '思考' : kind === 'article' ? '文章' : '题解卡片'),
      tags: cardData.tags || [],
      x: cardData.x ?? (80 + ((state.cards?.length || 0) % 3) * 340),
      y: cardData.y ?? (80 + Math.floor((state.cards?.length || 0) / 3) * 260),
      w: cardData.w ?? 320,
      h: cardData.h ?? 220,
      cluster: cardData.cluster || 'custom',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    state.cards = state.cards || [];
    state.cards.push(newCard);

    if (scopeSynthesis) {
      if (Array.isArray(scopeSynthesis.canvasLayout)) {
        scopeSynthesis.canvasLayout.push({
          cardId: newCard.cardId,
          x: newCard.x,
          y: newCard.y,
          w: newCard.w,
          h: newCard.h,
          cluster: newCard.cluster
        });
      }
      if (Array.isArray(scopeSynthesis.taxonomyAssignments)) {
        scopeSynthesis.taxonomyAssignments.push({
          cardId: newCard.cardId,
          subject: newCard.subject,
          course: newCard.course,
          chapter: newCard.chapter,
          contentType: newCard.contentType,
          tags: newCard.tags
        });
      }
    }

    setScopedSynthesis(scopeSynthesis);
    saveState(state);
    return newCard;
  }

  /**
   * 删除卡片并清理其关联合成数据
   */
  function deleteCard(cardId, expectedRevision) {
    let scopeSynthesis=synthesisForScope();
    assertCardScope(cardId);
    if (expectedRevision !== undefined && expectedRevision !== null) {
      contracts.validateRevisionConflict(state.revision, expectedRevision);
    }

    state.cards = (state.cards || []).filter((c) => c.cardId !== cardId);
    state.knowledgeRelations=state.knowledgeRelations.filter(r=>r.fromCardId!==cardId && r.toCardId!==cardId);
    replaceCanvasCards([cardId],[]);

    if (scopeSynthesis) {
      if (Array.isArray(scopeSynthesis.canvasLayout)) {
        scopeSynthesis.canvasLayout = scopeSynthesis.canvasLayout.filter((l) => l.cardId !== cardId);
      }
      if (Array.isArray(scopeSynthesis.taxonomyAssignments)) {
        scopeSynthesis.taxonomyAssignments = scopeSynthesis.taxonomyAssignments.filter((t) => t.cardId !== cardId);
      }
      if (Array.isArray(scopeSynthesis.relations)) {
        scopeSynthesis.relations = scopeSynthesis.relations.filter((r) => r.fromCardId !== cardId && r.toCardId !== cardId);
      }
      if (Array.isArray(scopeSynthesis.problemTrees)) {
        for (const tree of scopeSynthesis.problemTrees) {
          tree.processCardIds = (tree.processCardIds || []).filter((id) => id !== cardId);
          tree.keyStepCardIds = (tree.keyStepCardIds || []).filter((id) => id !== cardId);
          tree.figureCardIds = (tree.figureCardIds || []).filter((id) => id !== cardId);
          tree.thoughtCardIds = (tree.thoughtCardIds || []).filter((id) => id !== cardId);
        }
        scopeSynthesis.problemTrees = scopeSynthesis.problemTrees.filter((tree) => tree.problemCardId !== cardId);
      }
    }

    setScopedSynthesis(scopeSynthesis);
    saveState(state);
    return true;
  }

  /**
   * 更新画布卡片坐标 (自由排布)
   */
  function updateCanvasLayout(positions, expectedRevision, canvasId) {
    let scopeSynthesis=synthesisForScope();
    for(const position of positions || [])assertCardScope(position.cardId);
    if(canvasId) return saveCanvas({canvasId,layout:positions,expectedRevision}).layout;
    if (expectedRevision !== undefined && expectedRevision !== null) {
      contracts.validateRevisionConflict(state.revision, expectedRevision);
    }
    if (!Array.isArray(positions)) {
      throw new Error('updateCanvasLayout 参数必须是数组');
    }

    if (!scopeSynthesis) {
      scopeSynthesis = {
        completedAt: null,
        relations: [],
        problemTrees: [],
        canvasLayout: [],
        taxonomyAssignments: []
      };
    }
    scopeSynthesis.canvasLayout = scopeSynthesis.canvasLayout || [];
    const cardMap = new Map((state.cards || []).map((c) => [c.cardId, c]));

    for (const pos of positions) {
      if (!pos.cardId) continue;
      const existing = scopeSynthesis.canvasLayout.find((item) => item.cardId === pos.cardId);
      if (existing) {
        if (pos.x !== undefined) existing.x = pos.x;
        if (pos.y !== undefined) existing.y = pos.y;
        if (pos.w !== undefined) existing.w = pos.w;
        if (pos.h !== undefined) existing.h = pos.h;
        if (pos.cluster !== undefined) existing.cluster = pos.cluster;
      } else {
        scopeSynthesis.canvasLayout.push({
          cardId: pos.cardId,
          x: pos.x,
          y: pos.y,
          w: pos.w || 320,
          h: pos.h || 230,
          cluster: pos.cluster || 'default'
        });
      }

      const card = cardMap.get(pos.cardId);
      if (card) {
        if (pos.x !== undefined) card.x = pos.x;
        if (pos.y !== undefined) card.y = pos.y;
        if (pos.w !== undefined) card.w = pos.w;
        if (pos.h !== undefined) card.h = pos.h;
        if (pos.cluster !== undefined) card.cluster = pos.cluster;
      }
    }

    setScopedSynthesis(scopeSynthesis);
    saveState(state,undefined,{lightweight:true});
    return scopeSynthesis.canvasLayout;
  }

  /**
   * 卡片拆分 (splitCard)
   */
  function splitCard(payload) {
    let scopeSynthesis=synthesisForScope();
    contracts.validateCardSplitPayload(payload);
    const expectedRevision = payload?.expectedRevision;
    if (expectedRevision !== undefined && expectedRevision !== null) {
      contracts.validateRevisionConflict(state.revision, expectedRevision);
    }

    if (payload?.operationId) {
      const existing = findLoggedOperation(payload.operationId);
      if (existing) return existing;
    }

    const { sourceCardId, segments } = payload;
    assertCardScope(sourceCardId);
    state.cards = state.cards || [];
    const sourceCard = state.cards.find((c) => c.cardId === sourceCardId);
    if (!sourceCard) {
      throw new Error(`找不到源卡片: ${sourceCardId}`);
    }

    const createdCards = segments.map((seg, idx) => {
      const cardId = seg.cardId || `${sourceCardId}-part${idx + 1}`;
      const kind = seg.kind || sourceCard.kind || 'process';
      return {
        cardId,
        pageId: sourceCard.pageId,
        regionId: sourceCard.regionId,
        batchId: sourceCard.batchId,
        previewContent: seg.previewContent ?? sourceCard.previewContent ?? '',
        splitFrom: sourceCard.cardId,
        kind,
        title: seg.title.trim(),
        editableContent: seg.editableContent.trim(),
        typography: seg.typography || sourceCard.typography || { headingScale: 1.0, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
        structureBlocks: seg.structureBlocks || [{ kind, text: seg.editableContent }],
        figureInfo: seg.figureInfo || sourceCard.figureInfo || null,
        intraPageLinks: seg.intraPageLinks || sourceCard.intraPageLinks || [],
        crossPageHypotheses: seg.crossPageHypotheses || sourceCard.crossPageHypotheses || [],
        subject: seg.subject || sourceCard.subject || '未分类',
        course: seg.course || sourceCard.course || '通识',
        chapter: seg.chapter || sourceCard.chapter || '未分类章节',
        contentType: seg.contentType || sourceCard.contentType || '题解卡片',
        tags: seg.tags || sourceCard.tags || [],
        x: (sourceCard.x || 80) + idx * 360,
        y: (sourceCard.y || 80) + idx * 40,
        w: sourceCard.w || 320,
        h: sourceCard.h || 220,
        cluster: seg.cluster || sourceCard.cluster || 'default',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    });

    // 从 cards 中剔除 sourceCard 并插入新卡片
    state.cards = state.cards.filter((c) => c.cardId !== sourceCardId);
    state.cards.push(...createdCards);

    // 同步更新 synthesis
    if (scopeSynthesis) {
      if (Array.isArray(scopeSynthesis.canvasLayout)) {
        scopeSynthesis.canvasLayout = scopeSynthesis.canvasLayout.filter((l) => l.cardId !== sourceCardId);
        for (const card of createdCards) {
          scopeSynthesis.canvasLayout.push({
            cardId: card.cardId,
            x: card.x,
            y: card.y,
            w: card.w,
            h: card.h,
            cluster: card.cluster
          });
        }
      }

      if (Array.isArray(scopeSynthesis.taxonomyAssignments)) {
        scopeSynthesis.taxonomyAssignments = scopeSynthesis.taxonomyAssignments.filter((t) => t.cardId !== sourceCardId);
        for (const card of createdCards) {
          scopeSynthesis.taxonomyAssignments.push({
            cardId: card.cardId,
            subject: card.subject,
            course: card.course,
            chapter: card.chapter,
            contentType: card.contentType,
            tags: card.tags
          });
        }
      }

      const newIds = createdCards.map((c) => c.cardId);
      if (Array.isArray(scopeSynthesis.problemTrees)) {
        for (const tree of scopeSynthesis.problemTrees) {
          if (tree.problemCardId === sourceCardId) tree.problemCardId = newIds[0];
          tree.processCardIds = (tree.processCardIds || []).flatMap((id) => (id === sourceCardId ? newIds : [id]));
          tree.keyStepCardIds = (tree.keyStepCardIds || []).flatMap((id) => (id === sourceCardId ? newIds : [id]));
          tree.figureCardIds = (tree.figureCardIds || []).flatMap((id) => (id === sourceCardId ? newIds : [id]));
          tree.thoughtCardIds = (tree.thoughtCardIds || []).flatMap((id) => (id === sourceCardId ? newIds : [id]));
        }
      }

      if (Array.isArray(scopeSynthesis.relations)) {
        scopeSynthesis.relations = scopeSynthesis.relations.map((rel) => {
          if (rel.fromCardId === sourceCardId) rel.fromCardId = newIds[0];
          if (rel.toCardId === sourceCardId) rel.toCardId = newIds[0];
          return rel;
        });
      }
    }

    state.knowledgeRelations=state.knowledgeRelations.map(r=>({...r,fromCardId:r.fromCardId===sourceCardId?createdCards[0].cardId:r.fromCardId,toCardId:r.toCardId===sourceCardId?createdCards[0].cardId:r.toCardId}));
    replaceCanvasCards([sourceCardId],createdCards);
    const result = { removedCardId: sourceCardId, createdCards };
    logOperation(payload?.operationId, { action: 'splitCard', sourceCardId, count: createdCards.length });
    setScopedSynthesis(scopeSynthesis);
    saveState(state);
    return result;
  }

  /**
   * 卡片合并 (mergeCards)
   */
  function mergeCards(payload) {
    let scopeSynthesis=synthesisForScope();
    contracts.validateCardMergePayload(payload);
    const expectedRevision = payload?.expectedRevision;
    if (expectedRevision !== undefined && expectedRevision !== null) {
      contracts.validateRevisionConflict(state.revision, expectedRevision);
    }

    if (payload?.operationId) {
      const existing = findLoggedOperation(payload.operationId);
      if (existing) return existing;
    }

    const { cardIds } = payload;
    for(const id of cardIds)assertCardScope(id);
    state.cards = state.cards || [];
    const sourceCards = cardIds.map((id) => state.cards.find((c) => c.cardId === id));
    for (const [idx, card] of sourceCards.entries()) {
      if (!card) throw new Error(`找不到待合并卡片: ${cardIds[idx]}`);
    }

    if(new Set(sourceCards.map(c=>c.batchId)).size>1) throw new Error('请勿跨批次合并卡片；可添加知识库关联');
    const base = sourceCards[0];
    const mergedCardId = payload.cardId || `card-merged-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const kind = payload.kind || base.kind || 'process';

    const mergedCard = {
      cardId: mergedCardId,
      pageId: base.pageId,
      regionId: base.regionId,
      batchId: base.batchId,
      previewContent: payload.previewContent ?? base.previewContent ?? '',
      mergedFrom: cardIds,
      kind,
      title: payload.title?.trim() || sourceCards.map((c) => c.title).join(' + '),
      editableContent: payload.editableContent?.trim() || sourceCards.map((c) => c.editableContent).join('\n\n---\n\n'),
      typography: payload.typography || base.typography || { headingScale: 1.0, bodyScale: 1.0, alignment: 'left', preserveLineBreaks: true },
      structureBlocks: sourceCards.flatMap((c) => c.structureBlocks || []),
      figureInfo: sourceCards.find((c) => c.figureInfo)?.figureInfo || null,
      intraPageLinks: sourceCards.flatMap((c) => c.intraPageLinks || []).filter((l) => !cardIds.includes(l.targetRegionId)),
      crossPageHypotheses: sourceCards.flatMap((c) => c.crossPageHypotheses || []),
      subject: base.subject || '未分类',
      course: base.course || '通识',
      chapter: base.chapter || '未分类章节',
      contentType: base.contentType || '题解卡片',
      tags: [...new Set(sourceCards.flatMap((c) => c.tags || []))],
      x: base.x || 80,
      y: base.y || 80,
      w: base.w || 320,
      h: base.h || 220,
      cluster: base.cluster || 'default',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const cardIdSet = new Set(cardIds);
    state.cards = state.cards.filter((c) => !cardIdSet.has(c.cardId));
    state.cards.push(mergedCard);
    replaceCanvasCards(cardIds,[mergedCard]);
    state.knowledgeRelations=state.knowledgeRelations.map(r=>({...r,fromCardId:cardIdSet.has(r.fromCardId)?mergedCardId:r.fromCardId,toCardId:cardIdSet.has(r.toCardId)?mergedCardId:r.toCardId})).filter(r=>r.fromCardId!==r.toCardId);

    if (scopeSynthesis) {
      if (Array.isArray(scopeSynthesis.canvasLayout)) {
        scopeSynthesis.canvasLayout = scopeSynthesis.canvasLayout.filter((l) => !cardIdSet.has(l.cardId));
        scopeSynthesis.canvasLayout.push({
          cardId: mergedCard.cardId,
          x: mergedCard.x,
          y: mergedCard.y,
          w: mergedCard.w,
          h: mergedCard.h,
          cluster: mergedCard.cluster
        });
      }

      if (Array.isArray(scopeSynthesis.taxonomyAssignments)) {
        scopeSynthesis.taxonomyAssignments = scopeSynthesis.taxonomyAssignments.filter((t) => !cardIdSet.has(t.cardId));
        scopeSynthesis.taxonomyAssignments.push({
          cardId: mergedCard.cardId,
          subject: mergedCard.subject,
          course: mergedCard.course,
          chapter: mergedCard.chapter,
          contentType: mergedCard.contentType,
          tags: mergedCard.tags
        });
      }

      if (Array.isArray(scopeSynthesis.problemTrees)) {
        for (const tree of scopeSynthesis.problemTrees) {
          if (cardIdSet.has(tree.problemCardId)) tree.problemCardId = mergedCard.cardId;
          const replaceInList = (list) => [...new Set((list || []).map((id) => (cardIdSet.has(id) ? mergedCard.cardId : id)))];
          tree.processCardIds = replaceInList(tree.processCardIds);
          tree.keyStepCardIds = replaceInList(tree.keyStepCardIds);
          tree.figureCardIds = replaceInList(tree.figureCardIds);
          tree.thoughtCardIds = replaceInList(tree.thoughtCardIds);
        }
      }

      if (Array.isArray(scopeSynthesis.relations)) {
        scopeSynthesis.relations = scopeSynthesis.relations
          .map((rel) => {
            if (cardIdSet.has(rel.fromCardId)) rel.fromCardId = mergedCard.cardId;
            if (cardIdSet.has(rel.toCardId)) rel.toCardId = mergedCard.cardId;
            return rel;
          })
          .filter((rel) => rel.fromCardId !== rel.toCardId);
      }
    }

    const result = { mergedCardIds: cardIds, card: mergedCard };
    logOperation(payload?.operationId, { action: 'mergeCards', cardIds, mergedCardId });
    setScopedSynthesis(scopeSynthesis);
    saveState(state);
    return result;
  }

  /**
   * 解析图片真实宽高（支持 JPEG / PNG）
   */
  function readImageDimensions(buf, ext) {
    try {
      if (ext === '.png' && buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      }
      if ((ext === '.jpg' || ext === '.jpeg') && buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
        let offset = 2;
        while (offset + 9 < buf.length) {
          if (buf[offset] !== 0xff) {
            offset += 1;
            continue;
          }
          const marker = buf[offset + 1];
          if (marker === 0xff) {
            offset += 1;
            continue;
          }
          if (marker === 0xd8 || marker === 0xd9) {
            offset += 2;
            continue;
          }
          const segLen = buf.readUInt16BE(offset + 2);
          if (segLen < 2 || offset + 2 + segLen > buf.length) break;
          // SOF0 / SOF1 / SOF2
          if (marker >= 0xc0 && marker <= 0xc3) {
            const height = buf.readUInt16BE(offset + 5);
            const width = buf.readUInt16BE(offset + 7);
            if (width > 0 && height > 0) return { width, height };
          }
          offset += 2 + segLen;
        }
      }
    } catch {
      // ignore and fallback
    }
    return { width: 1200, height: 1600 };
  }

  /**
   * 裁切原纸区域并落盘 SVG 片段
   */
  function cropRegion({ pageId, regionId, bbox, _save = true, expectedRevision } = {}) {
    contracts.validateRevisionConflict(state.revision,expectedRevision);
    assertPageScope(pageId);
    const page = (state.pages || []).find((p) => p.pageId === pageId);
    if (!page) {
      throw new Error(`找不到页面: ${pageId}`);
    }

    const region = (page.regions || []).find((r) => r.regionId === regionId);
    if (!region) {
      throw new Error(`找不到分区: ${regionId}`);
    }

    if (bbox && !contracts.validateBBox(bbox)) throw new Error('无效 bbox');
    if (bbox && contracts.validateBBox(bbox)) {
      region.bbox = bbox;
    }

    if (!fs.existsSync(cropsDir)) {
      fs.mkdirSync(cropsDir, { recursive: true });
    }

    const safeName = crypto.createHash('sha256').update(pageId+'::'+regionId).digest('hex').slice(0,32);
    let cropPath,fullPath;
    const b = region.bbox || { x: 0, y: 0, w: 0.5, h: 0.5 };
    const pageW = page.width || 1200;
    const pageH = page.height || 1600;
    const cropX = Math.max(0, Math.round((b.x || 0) * pageW));
    const cropY = Math.max(0, Math.round((b.y || 0) * pageH));
    const viewBoxW = Math.max(1, Math.round((b.w || 0.5) * pageW));
    const viewBoxH = Math.max(1, Math.round((b.h || 0.5) * pageH));

    if (!contracts.validateBBox(b)) throw new Error('无效 bbox');
    if (region.points && !contracts.validatePolygon(region.points,b)) throw new Error('无效 polygon points');
    let source = pageSvg(page);
    source = embedPageAssets(source);
    source = source.replace(/^\s*<\?xml[^>]*>\s*/, '').replace(/<svg\b[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
    if (!source) throw new Error('页面没有可裁剪的原图');
    const clip = region.points ? `<defs><clipPath id="region-clip"><polygon points="${region.points.map(p=>`${p.x*pageW},${p.y*pageH}`).join(' ')}"/></clipPath></defs>` : '';
    const cropSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cropX} ${cropY} ${viewBoxW} ${viewBoxH}">${clip}<g${region.points ? ' clip-path="url(#region-clip)"' : ''}>${source}</g></svg>`;

    const asset=persistVisual(cropSvg,'crops');
    cropPath=asset.relative;fullPath=asset.full;
    region.cropPath=asset.url;
    region.cropSvg=cropSvg;

    for (const card of state.cards || []) {
      if (card.pageId === pageId && card.regionId === regionId) {
        card.figureInfo = card.figureInfo || {};
        card.figureInfo.cropPath = 'app://local/'+cropPath;
        card.figureInfo.cropSvg = cropSvg;
      }
    }

    if(_save) saveState(state);
    return { region, cropPath, cropUrl:region.cropPath, cropSvg, fullPath };
  }

  /**
   * 批量导入本地文件（支持 .svg, .png, .jpg, .jpeg, .webp）
   */
  function importLocalFiles(filePaths, options = {}) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      throw new Error('importLocalFiles 需要提供非空文件路径数组');
    }

    // 每次导入创建独立批次，旧批次始终保留。
    const previousBatchId=state.activeBatchId;
    const batch = beginBatch(options.title || '导入 '+new Date().toLocaleString('zh-CN'));

    const importedPages = [];
    state.pages = state.pages || [];

    if (!fs.existsSync(pagesDir)) {
      fs.mkdirSync(pagesDir, { recursive: true });
    }

    for (const [idx, fp] of filePaths.entries()) {
      if (!fs.existsSync(fp)) continue;
      const ext = path.extname(fp).toLowerCase();
      const title = path.basename(fp, ext);
      const pageNum = state.pages.length + 1;
      const pageId = options.useSequentialIds
        ? `page-${String(pageNum).padStart(2, '0')}`
        : `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const fileBuf = fs.readFileSync(fp);
      const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');

      let svgPreview = '';
      let pageAssetUrl = null;
      let width = 1200;
      let height = 1600;
      let rawWidth = 1200;
      let rawHeight = 1600;
      let rotated90CW = false;

      if (ext === '.svg') {
        svgPreview = fileBuf.toString('utf8');
        const vb=svgPreview.match(/viewBox=["']\s*([-\d.e+]+)[ ,]+([-\d.e+]+)[ ,]+([\d.e+]+)[ ,]+([\d.e+]+)\s*["']/i);
        if(vb && Number(vb[3])>0 && Number(vb[4])>0) {
          width=rawWidth=Number(vb[3]);height=rawHeight=Number(vb[4]);
          const inner=svgPreview.replace(/^\s*<\?xml[^>]*>\s*/,'').replace(/<svg\b[^>]*>/i,'').replace(/<\/svg>\s*$/i,'');
          svgPreview=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><g transform="translate(${-Number(vb[1])},${-Number(vb[2])})">${inner}</g></svg>`;
        }
      } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        const dims = readImageDimensions(fileBuf, ext);
        rawWidth = dims.width;
        rawHeight = dims.height;
        if (rawWidth > rawHeight && options.autoRotatePortrait === true) {
          width = rawHeight;
          height = rawWidth;
          rotated90CW = true;
        } else {
          width = rawWidth;
          height = rawHeight;
        }
        const assetFileName = `${pageId}${ext}`;
        const destPath = path.join(pagesDir, assetFileName);
        if (path.resolve(fp) !== path.resolve(destPath)) {
          fs.writeFileSync(destPath, fileBuf);
        }
        pageAssetUrl = `app://local/pages/${assetFileName}`;
        const imgTag = rotated90CW
          ? `<image href="${pageAssetUrl}" width="${rawWidth}" height="${rawHeight}" transform="translate(${width}, 0) rotate(90)" preserveAspectRatio="none"/>`
          : `<image href="${pageAssetUrl}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
        svgPreview = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
  ${imgTag}
</svg>`;
      } else {
        continue;
      }

      const newPage = {
        pageId,
        batchId: batch.batchId,
        rotation: rotated90CW ? 90 : 0,
        sha256,
        title: title || `本地导入纸张 ${pageNum}`,
        imagePath: fp,
        pageAssetUrl,
        width,
        height,
        rawWidth,
        rawHeight,
        rotated90CW,
        svgPreview,
        rawNotes: `本地路径: ${fp}`,
        importedAt: Date.now(),
        partitionedAt: null,
        regions: []
      };

      state.pages.push(newPage);
      importedPages.push(newPage);
    }

    if (!importedPages.length) {
      state.batches=state.batches.filter(b=>b.batchId!==batch.batchId);
      state.canvases=state.canvases.filter(c=>c.batchId!==batch.batchId);
      state.activeBatchId=previousBatchId;
      state.synthesis=state.batches.find(b=>b.batchId===previousBatchId)?.synthesis || null;
    }
    if (importedPages.length > 0) {
      state.synthesis = null;
      saveState(state);
    }

    return importedPages;
  }

  /**
   * 导出工作区完整快照（JSON + 格式化排版 Markdown）
   */
  function exportSnapshot(targetDir) {
    const destDir = targetDir ? path.resolve(targetDir) : exportsDir;
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const jsonPath = path.join(destDir, 'papercard-snapshot.json');
    const markdownPath = path.join(destDir, 'papercard-snapshot.md');

    const snapshotData = {
      meta: {
        app: 'PaperCard Atelier',
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        revision: state.revision,
        totalPages: (state.pages || []).length,
        totalCards: (state.cards || []).length
      },
      state: getState()
    };
    writeJsonAtomic(jsonPath, snapshotData);

    const cards = state.cards || [];
    const pages = state.pages || [];

    let md = `# PaperCard Atelier 纸质笔记数字化重构快照\n\n`;
    md += `> 导出时间：${new Date().toLocaleString()} ｜ 工作区版本：v${state.revision} ｜ 纸张数：${pages.length} ｜ 卡片数：${cards.length}\n\n---\n\n`;

    md += `## 一、 原纸导入与内容分区概览\n\n`;
    for (const [idx, page] of pages.entries()) {
      md += `### ${idx + 1}. ${page.title} (\`${page.pageId}\`)\n`;
      md += `- **页面摘要**：${page.pageSummary || '（尚未生成摘要）'}\n`;
      md += `- **分区数量**：${(page.regions || []).length} 个\n`;
      for (const reg of page.regions || []) {
        md += `  - \`[${reg.kind}]\` **${reg.label || reg.regionId}** (bbox: ${JSON.stringify(reg.bbox)})\n`;
      }
      md += `\n`;
    }

    md += `---\n\n## 二、 可编辑卡片列表\n\n`;
    for (const card of cards) {
      md += `### ✦ [${card.kind}] ${card.title}\n`;
      md += `**卡片 ID**：\`${card.cardId}\` ｜ **归属**：${card.subject} > ${card.course} > ${card.chapter}\n\n`;
      md += `${card.editableContent}\n\n`;
      if (card.figureInfo) {
        md += `- **图形重绘模式**：\`${card.figureInfo.redrawMode}\`\n- **重绘规则**：${card.figureInfo.redrawRule || '保留原始截图'}\n\n`;
      }
      md += `---\n\n`;
    }

    if (state.synthesis && Array.isArray(state.synthesis.problemTrees)) {
      md += `## 三、 题目-过程-关键步骤题解树 (Problem Trees)\n\n`;
      for (const [idx, tree] of state.synthesis.problemTrees.entries()) {
        const probCard = cards.find((c) => c.cardId === tree.problemCardId);
        md += `### 题解树 #${idx + 1}：${probCard ? probCard.title : tree.problemCardId}\n`;
        md += `- **题目卡片**：\`${tree.problemCardId}\`\n`;
        md += `- **推导过程**：${(tree.processCardIds || []).map((id) => `\`${id}\``).join(', ') || '无'}\n`;
        md += `- **关键步骤**：${(tree.keyStepCardIds || []).map((id) => `\`${id}\``).join(', ') || '无'}\n`;
        md += `- **配图卡片**：${(tree.figureCardIds || []).map((id) => `\`${id}\``).join(', ') || '无'}\n`;
        md += `- **随堂思考**：${(tree.thoughtCardIds || []).map((id) => `\`${id}\``).join(', ') || '无'}\n\n`;
      }
    }

    fs.writeFileSync(markdownPath, md, 'utf8');

    return {
      jsonPath,
      markdownPath,
      cardCount: cards.length,
      pageCount: pages.length
    };
  }


  function replaceCanvasCards(oldIds,newCards) {
    const removed=new Set(oldIds), replacements=newCards.map(c=>c.cardId);
    for(const canvas of state.canvases) {
      if(!canvas.cardIds.some(id=>removed.has(id))) continue;
      const origin=canvas.layout.find(p=>removed.has(p.cardId));
      canvas.cardIds=[...new Set(canvas.cardIds.flatMap(id=>removed.has(id)?replacements:[id]))];
      canvas.layout=canvas.layout.filter(p=>!removed.has(p.cardId));
      if(origin)canvas.layout.push(...newCards.map((c,i)=>({...origin,cardId:c.cardId,x:origin.x+i*340})));
      canvas.relations=canvas.relations.map(r=>({...r,fromCardId:removed.has(r.fromCardId)?replacements[0]:r.fromCardId,toCardId:removed.has(r.toCardId)?replacements[0]:r.toCardId})).filter(r=>r.fromCardId&&r.toCardId&&r.fromCardId!==r.toCardId);
    }
  }

  function newBatch({title} = {}) {
    const batch=beginBatch(title || '新的笔记');
    saveState(state);
    return batch;
  }

  function saveCanvas(payload = {}, persist = true, validateOnly = false) {
    contracts.validateRevisionConflict(state.revision,payload.expectedRevision);
    const existing=state.canvases.find(c=>c.canvasId===payload.canvasId);
    if(payload.canvasId && !existing) throw new Error('找不到画布');
    const base=existing || {canvasId:'canvas-'+crypto.randomUUID(),title:'新主题',scope:'knowledge',batchId:null,cardIds:[],layout:[],relations:[]};
    const next={...base};
    for(const key of ['title','scope','batchId','cardIds','layout','relations']) if(payload[key]!==undefined) next[key]=structuredClone(payload[key]);
    if(!['batch','knowledge'].includes(next.scope)) throw new Error('画布scope无效');
    if(next.scope==='batch' && !state.batches.some(b=>b.batchId===next.batchId)) throw new Error('画布批次不存在');
    if(next.scope==='knowledge') next.batchId=null;
    if(batchScope && (next.scope!=='batch'||next.batchId!==batchScope))throw new Error('任务只能维护本批次画布');
    if(!Array.isArray(next.cardIds) || !Array.isArray(next.layout) || !Array.isArray(next.relations)) throw new Error('画布成员/布局/关系必须是数组');
    const cards=new Map(state.cards.map(c=>[c.cardId,c]));
    next.cardIds=[...new Set(next.cardIds)];
    for(const id of next.cardIds) {
      if(!cards.has(id)) throw new Error('画布引用不存在的卡片');
      if(next.scope==='batch' && cards.get(id).batchId!==next.batchId) throw new Error('批画布不能添加其他批次卡片');
    }
    const ids=new Set(next.cardIds);
    next.layout=next.layout.filter(l=>ids.has(l.cardId));
    for(const l of next.layout) if(!Number.isFinite(l.x)||!Number.isFinite(l.y)) throw new Error('画布坐标必须是有限数字');
    next.relations=next.relations.filter(r=>ids.has(r.fromCardId)&&ids.has(r.toCardId));
    if(validateOnly) return next;
    if(existing) Object.assign(existing,next); else state.canvases.push(next);
    if(persist) saveState(state,undefined,{lightweight:true});
    return next;
  }

  function deleteCanvas({canvasId,expectedRevision} = {}) {
    contracts.validateRevisionConflict(state.revision,expectedRevision);
    const target=state.canvases.find(c=>c.canvasId===canvasId);
    if(!target)throw new Error('找不到画布');
    if(batchScope&&(target.scope!=='batch'||target.batchId!==batchScope))throw new Error('只能删除本任务批次画布');
    state.canvases=state.canvases.filter(c=>c.canvasId!==canvasId);
    saveState(state,undefined,{lightweight:true});
    return {canvasId};
  }

  function archiveBatch({batchId=batchScope || state.activeBatchId,_save=true} = {}) {
    if(batchScope&&batchId!==batchScope)throw new Error('只能归档本任务批次');
    const batch=state.batches.find(b=>b.batchId===batchId);
    if(!batch) throw new Error('找不到批次');
    const pages=state.pages.filter(p=>p.batchId===batchId), cards=state.cards.filter(c=>c.batchId===batchId);
    if(!pages.length && !cards.length) return null;
    const signature=crypto.createHash('sha256').update(JSON.stringify({batch,pages,cards,canvases:state.canvases.filter(c=>c.batchId===batchId)},(key,value)=>['svgPreview','cropSvg'].includes(key)?undefined:value)).digest('hex');
    const prior=state.archives.find(a=>a.batchId===batchId && a.sourceSignature===signature);
    if(prior) return prior;
    const archiveId='archive-'+crypto.randomUUID();
    const folder=path.join(normalizedRoot,'archives',archiveId);
    fs.mkdirSync(path.join(folder,'pages'),{recursive:true});
    const assets=[], pageAssets={};
    for(const page of pages) {
      const assetName=page.pageAssetUrl?.split('/').pop();
      if(!assetName) {
        const name=crypto.createHash('sha256').update(page.pageId).digest('hex').slice(0,24)+'.svg';
        fs.writeFileSync(path.join(folder,'pages',name),embedPageAssets(pageSvg(page)),'utf8');
        assets.push(name);pageAssets[page.pageId]=name;continue;
      }
      if(path.basename(assetName)!==assetName) continue;
      const src=path.join(pagesDir,assetName);
      if(!fs.existsSync(src) || path.dirname(fs.realpathSync(src))!==fs.realpathSync(pagesDir)) continue;
      fs.copyFileSync(src,path.join(folder,'pages',assetName)); assets.push(assetName);pageAssets[page.pageId]=assetName;
    }
    const visualAssets=[];
    const refs=new Set();
    for(const page of pages) {if(page.svgPreviewPath)refs.add(page.svgPreviewPath);for(const region of page.regions || [])if(region.cropPath)refs.add(region.cropPath);}
    for(const card of cards)for(const key of ['cropPath','redrawPath','vectorPreviewPath','redrawDataPath'])if(card.figureInfo?.[key])refs.add(card.figureInfo[key]);
    for(const ref of refs) {
      const asset=localVisualPath(ref);if(!asset || !fs.existsSync(asset.full))continue;
      const dest=path.join(folder,'assets',asset.relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(asset.full,dest);visualAssets.push(asset.relative);
    }
    const ids=new Set(cards.map(c=>c.cardId));
    const data={version:1,batch,pages,cards,canvases:state.canvases.filter(c=>c.scope==='batch'&&c.batchId===batchId),relations:state.knowledgeRelations.filter(r=>ids.has(r.fromCardId)||ids.has(r.toCardId)),assets,pageAssets,visualAssets};
    writeJsonAtomic(path.join(folder,'archive.json'),data);
    fs.writeFileSync(path.join(folder,'notes.md'),'# '+batch.title+'\n\n'+cards.map(c=>'## '+c.title+'\n\n'+c.editableContent).join('\n\n'),'utf8');
    const result={archiveId,batchId,title:batch.title,createdAt:Date.now(),sourceRevision:state.revision,sourceSignature:signature,jsonPath:path.join(folder,'archive.json'),markdownPath:path.join(folder,'notes.md'),folder};
    state.archives.push(result);
    if(_save) saveState(state);
    return result;
  }

  function listArchives() { refreshFromDisk(); return structuredClone(state.archives); }

  function restoreArchive({archiveId} = {}) {
    const entry=state.archives.find(a=>a.archiveId===archiveId);
    if(!entry) throw new Error('找不到归档');
    if(!/^archive-[a-f0-9-]+$/.test(entry.archiveId)) throw new Error('归档标识无效');
    const folder=path.join(normalizedRoot,'archives',entry.archiveId);
    const data=JSON.parse(fs.readFileSync(path.join(folder,'archive.json'),'utf8'));
    if(data.version!==1 || !Array.isArray(data.pages) || !Array.isArray(data.cards) || !Array.isArray(data.assets)) throw new Error('归档格式无效');
    const batch=beginBatch((data.batch.title || '笔记')+' · 恢复');
    const map=new Map();
    for(const p of data.pages) {map.set(p.pageId,'page-'+crypto.randomUUID());for(const r of p.regions || [])map.set(r.regionId,'region-'+crypto.randomUUID());}
    for(const c of data.cards) map.set(c.cardId,'card-'+crypto.randomUUID());
    for(const c of data.canvases || [])map.set(c.canvasId,'canvas-'+crypto.randomUUID());
    map.set(data.batch.batchId,batch.batchId);
    function remap(value,key='') {
      if(typeof value==='string') {
        if(key==='relationId' && !map.has(value))map.set(value,'relation-'+crypto.randomUUID());
        return /(?:Id|Ids)$/.test(key) ? (map.get(value) || value) : value;
      }
      if(Array.isArray(value)) return value.map(v=>remap(v,key));
      if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v,k)]));
      return value;
    }
    const restored=remap(data);
    fs.mkdirSync(pagesDir,{recursive:true});
    for(const relative of data.visualAssets || []) {
      const asset=localVisualPath(relative);if(!asset)throw new Error('归档图像路径越界');
      const src=path.join(folder,'assets',asset.relative);fs.mkdirSync(path.dirname(asset.full),{recursive:true});
      if(!fs.existsSync(asset.full))fs.copyFileSync(src,asset.full);
    }
    // Page SVGs can refer to the original raster filename; keep that immutable
    // archived asset as well as each new page's remapped source file.
    for(const name of data.assets)if(path.basename(name)===name&&!fs.existsSync(path.join(pagesDir,name)))fs.copyFileSync(path.join(folder,'pages',name),path.join(pagesDir,name));
    for(const p of restored.pages) {
      const originalPageId=[...map].find(([,next])=>next===p.pageId)?.[0];
      const oldName=data.pageAssets?.[originalPageId] || p.pageAssetUrl?.split('/').pop();
      if(oldName && data.assets.includes(oldName) && path.basename(oldName)===oldName) {
        const newName=p.pageId+path.extname(oldName), src=path.join(folder,'pages',oldName), dest=path.join(pagesDir,newName);
        fs.copyFileSync(src,dest);
        p.pageAssetUrl='app://local/pages/'+newName;
        p.imagePath=dest;
        p.svgPreview=(p.svgPreview || '').split('app://local/pages/'+oldName).join(p.pageAssetUrl);
      }
    }
    state.pages.push(...restored.pages);state.cards.push(...restored.cards);
    state.canvases=state.canvases.filter(c=>c.batchId!==batch.batchId);
    state.canvases.push(...(restored.canvases || []));
    batch.synthesis=restored.batch.synthesis || null;state.synthesis=batch.synthesis;
    state.knowledgeRelations.push(...(restored.relations || []).map(r=>({...r,relationId:crypto.randomUUID()})));
    for(const page of restored.pages)for(const region of page.regions || [])cropRegion({pageId:page.pageId,regionId:region.regionId,_save:false});
    saveState(state);
    return {batchId:batch.batchId,restoredPages:restored.pages.length,restoredCards:restored.cards.length};
  }

  function organizeKnowledge(payload = {}) {
    contracts.validateRevisionConflict(state.revision,payload.expectedRevision);
    const cardMap=new Map(state.cards.map(c=>[c.cardId,c]));
    const assignments=payload.taxonomyAssignments || [];
    for(const item of assignments) {
      if(!cardMap.has(item.cardId)) throw new Error('分类引用不存在卡片');
      for(const key of ['subject','course','chapter','contentType']) if(item[key]!==undefined && typeof item[key]!=='string') throw new Error('分类字段必须是文本');
      if(item.tags!==undefined && (!Array.isArray(item.tags) || item.tags.some(t=>typeof t!=='string'))) throw new Error('tags必须是文本数组');
    }
    // Canvas proposals are additive/explicit patches; omitted canvases never disappear.
    const proposals=payload.canvases || [];
    if(proposals.some(c=>(c.scope && c.scope!=='knowledge') || (c.canvasId && state.canvases.find(x=>x.canvasId===c.canvasId)?.scope!=='knowledge'))) throw new Error('知识库整理只能修改知识库画布');
    for(const c of proposals)saveCanvas({...c,scope:'knowledge'},false,true);
    if(payload.relations!==undefined) {
      const ids=new Set(cardMap.keys());
      for(const r of payload.relations) if(!ids.has(r.fromCardId)||!ids.has(r.toCardId)) throw new Error('关系卡片不存在');
      // Upsert only. Human relations cannot be deleted by an omitted proposal.
      const existing=new Map(state.knowledgeRelations.map(r=>[r.fromCardId+'::'+r.toCardId+'::'+r.type,r]));
      for(const r of payload.relations)existing.set(r.fromCardId+'::'+r.toCardId+'::'+r.type,{...r,relationId:r.relationId || crypto.randomUUID()});
      state.knowledgeRelations=[...existing.values()];
    }
    for(const item of assignments)for(const key of ['subject','course','chapter','contentType','tags'])if(item[key]!==undefined)cardMap.get(item.cardId)[key]=structuredClone(item[key]);
    for(const c of proposals)saveCanvas({...c,scope:'knowledge'},false);
    const dir=path.join(normalizedRoot,'knowledge');fs.mkdirSync(dir,{recursive:true});
    const groups=new Map();
    for(const card of state.cards) {
      const key=[card.subject || '未分类',card.course || '未分类',card.chapter || '未分类'].join(' / ');
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(card);
    }
    const lines=['# 知识库目录',''];
    for(const [group,cards] of groups) {
      lines.push('## '+group,'');
      for(const card of cards) {
        const file=crypto.createHash('sha256').update(card.cardId).digest('hex').slice(0,24)+'.md';
        fs.writeFileSync(path.join(dir,file),'# '+card.title+'\n\n'+card.editableContent,'utf8');
        lines.push('- ['+card.title.replace(/[\[\]]/g,'')+']('+file+')');
      }
      lines.push('');
    }
    fs.writeFileSync(path.join(dir,'index.md'),lines.join('\n'),'utf8');
    state.knowledgeSynthesisAt=Date.now();
    state.knowledgeMarkdownPath=path.join(dir,'index.md');
    logOperation(payload.operationId,{action:'organizeKnowledge',taskId:payload.taskId});
    saveState(state);
    return {indexPath:path.join(dir,'index.md'),canvasCount:state.canvases.filter(c=>c.scope==='knowledge').length};
  }

  function embedPageAssets(source) {
    return source.replace(/app:\/\/local\/pages\/([^"'<>\s]+)/g, (url,name) => {
      const asset=path.resolve(pagesDir,decodeURIComponent(name));
      if(path.dirname(asset)!==pagesDir || !fs.existsSync(asset)) return url;
      if(path.dirname(fs.realpathSync(asset))!==fs.realpathSync(pagesDir)) return url;
      const ext=path.extname(asset).toLowerCase();
      const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'}[ext];
      return mime ? `data:${mime};base64,${fs.readFileSync(asset).toString('base64')}` : url;
    });
  }
  function deleteBatch({batchId, expectedRevision} = {}) {
    contracts.validateRevisionConflict(state.revision, expectedRevision);
    if (!batchId) throw new Error('需指定 batchId');
    if (batchScope && batchScope !== batchId) {
      const error = new Error('只能删除本任务批次');
      error.code = 'SCOPE_MISMATCH';
      throw error;
    }
    const batch = (state.batches || []).find((b) => b.batchId === batchId);
    if (!batch) {
      throw new Error('找不到批次: ' + batchId);
    }
    const removedPageIds = new Set(
      (state.pages || []).filter((p) => p.batchId === batchId).map((p) => p.pageId)
    );
    const removedCardIds = new Set(
      (state.cards || []).filter((c) => c.batchId === batchId || removedPageIds.has(c.pageId)).map((c) => c.cardId)
    );

    state.pages = (state.pages || []).filter((p) => !removedPageIds.has(p.pageId));
    state.cards = (state.cards || []).filter((c) => !removedCardIds.has(c.cardId));

    state.canvases = (state.canvases || []).filter((c) => c.batchId !== batchId);
    if (removedCardIds.size > 0) {
      replaceCanvasCards([...removedCardIds], []);
    }

    state.knowledgeRelations = (state.knowledgeRelations || []).filter(
      (r) => !removedCardIds.has(r.fromCardId) && !removedCardIds.has(r.toCardId)
    );

    state.batches = state.batches.filter((b) => b.batchId !== batchId);
    state.operationLog = (state.operationLog || []).filter((op) => op.batchId !== batchId);

    if (state.batches.length === 0) {
      beginBatch('新的笔记');
    } else if (state.activeBatchId === batchId) {
      state.activeBatchId = state.batches[0].batchId;
      state.synthesis = state.batches[0].synthesis || null;
    }

    saveState(state);
    return {
      deletedBatchId: batchId,
      activeBatchId: state.activeBatchId,
      removedPagesCount: removedPageIds.size,
      removedCardsCount: removedCardIds.size
    };
  }

  function deletePage({pageId, clearOnly = false, expectedRevision} = {}) {
    contracts.validateRevisionConflict(state.revision, expectedRevision);
    if (!pageId) throw new Error('需指定 pageId');
    assertPageScope(pageId);
    const page = (state.pages || []).find((p) => p.pageId === pageId);
    if (!page) {
      throw new Error('找不到页面: ' + pageId);
    }
    const removedCardIds = (state.cards || [])
      .filter((c) => c.pageId === pageId)
      .map((c) => c.cardId);

    if (removedCardIds.length > 0) {
      const removedSet = new Set(removedCardIds);
      state.cards = state.cards.filter((c) => !removedSet.has(c.cardId));
      replaceCanvasCards(removedCardIds, []);
      state.knowledgeRelations = (state.knowledgeRelations || []).filter(
        (r) => !removedSet.has(r.fromCardId) && !removedSet.has(r.toCardId)
      );

      const batch = state.batches.find((b) => b.batchId === page.batchId);
      const batchSynthesis = batch?.synthesis || (state.activeBatchId === page.batchId ? state.synthesis : null);
      if (batchSynthesis) {
        if (Array.isArray(batchSynthesis.canvasLayout)) {
          batchSynthesis.canvasLayout = batchSynthesis.canvasLayout.filter((l) => !removedSet.has(l.cardId));
        }
        if (Array.isArray(batchSynthesis.taxonomyAssignments)) {
          batchSynthesis.taxonomyAssignments = batchSynthesis.taxonomyAssignments.filter((t) => !removedSet.has(t.cardId));
        }
        if (Array.isArray(batchSynthesis.relations)) {
          batchSynthesis.relations = batchSynthesis.relations.filter((r) => !removedSet.has(r.fromCardId) && !removedSet.has(r.toCardId));
        }
        if (Array.isArray(batchSynthesis.problemTrees)) {
          batchSynthesis.problemTrees = batchSynthesis.problemTrees.filter((tree) => {
            for (const [key, val] of Object.entries(tree)) {
              if (Array.isArray(val) && val.some((id) => removedSet.has(id))) return false;
              if (typeof val === 'string' && removedSet.has(val)) return false;
            }
            return true;
          });
        }
      }
    }

    if (clearOnly) {
      page.regions = [];
      page.partitionedAt = null;
      page.pageSummary = '';
      page.corrections = null;
    } else {
      state.pages = state.pages.filter((p) => p.pageId !== pageId);
    }

    invalidateSynthesis(page.batchId);
    saveState(state);
    return {
      deletedPageId: pageId,
      clearOnly: Boolean(clearOnly),
      removedCardsCount: removedCardIds.length
    };
  }

  function deleteRegion({pageId,regionId,expectedRevision} = {}) {
    assertPageScope(pageId);
    contracts.validateRevisionConflict(state.revision,expectedRevision);
    const page=state.pages.find(p=>p.pageId===pageId);
    if(!page || !(page.regions || []).some(r=>r.regionId===regionId)) throw new Error('找不到分区');
    page.regions=page.regions.filter(r=>r.regionId!==regionId);
    for(const card of state.cards || []) if(card.pageId===pageId && card.regionId===regionId) {card.regionId=null;card.detachedRegionId=regionId;}
    invalidateSynthesis(page.batchId); saveState(state); return {pageId,regionId};
  }
  function updateRegion({pageId,regionId,patch={},expectedRevision} = {}) {
    contracts.validateRevisionConflict(state.revision,expectedRevision);
    const page=state.pages.find(p=>p.pageId===pageId), region=page?.regions.find(r=>r.regionId===regionId);
    if(!region) throw new Error('找不到分区');
    assertPageScope(pageId);
    const next={...region,...patch,regionId};
    if(patch.polygon!==undefined) next.points=patch.polygon;
    if(patch.points!==undefined) next.polygon=patch.points;
    if(patch.redPenHint!==undefined) next.redPenHint=patch.redPenHint;
    if(patch.aiHint!==undefined) next.aiHint=patch.aiHint;
    if(!contracts.validateBBox(next.bbox) || (next.points && !contracts.validatePolygon(next.points,next.bbox))) throw new Error('分区范围无效');
    Object.assign(region,next); return cropRegion({pageId,regionId});
  }
  function updatePage({pageId,rotation,expectedRevision} = {}) {
    contracts.validateRevisionConflict(state.revision,expectedRevision);
    assertPageScope(pageId);
    if(!Number.isInteger(rotation)||rotation%90) throw new Error('rotation 必须是90度整数倍');
    const page=state.pages.find(p=>p.pageId===pageId); if(!page) throw new Error('找不到页面');
    const angle=((rotation%360)+360)%360;
    let turns=((angle-(page.rotation||0)+360)%360)/90;
    while(turns-- > 0) {
      const w=page.width,h=page.height;
      const inner=pageSvg(page).replace(/<svg\b[^>]*>/i,'').replace(/<\/svg>\s*$/i,'');
      page.svgPreview=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${h} ${w}"><g transform="translate(${h},0) rotate(90)">${inner}</g></svg>`;
      page.width=h; page.height=w;
      for(const r of page.regions||[]) {const b=r.bbox; r.bbox={x:1-b.y-b.h,y:b.x,w:b.h,h:b.w}; if(r.points){r.points=r.points.map(p=>({x:1-p.y,y:p.x}));r.polygon=r.points;}}
    }
    page.svgPreview=embedPageAssets(pageSvg(page));
    page.rotation=angle;
    for(const r of page.regions||[]) cropRegion({pageId,regionId:r.regionId,_save:false});
    saveState(state); return page;
  }

  function renameBatch({batchId,title,expectedRevision} = {}) {
    contracts.validateRevisionConflict(state.revision,expectedRevision);
    const batch=state.batches.find(b=>b.batchId===batchId);
    if(!batch || typeof title!=='string' || !title.trim())throw new Error('需指定批次和非空名称');
    batch.title=title.trim();saveState(state);return batch;
  }
  function requestCorrection({pageId,pageIds,regionId,reason='',kind,aiHint='',redPenHint='',expectedRevision} = {}) {
    contracts.validateRevisionConflict(state.revision,expectedRevision);
    const targetPageIds = Array.isArray(pageIds) ? pageIds : pageId ? [pageId] : [];
    if (!targetPageIds.length) throw new Error('需指定 pageId 或 pageIds');
    for (const pid of targetPageIds) assertPageScope(pid);

    const now = Date.now();
    const hint = String(aiHint || redPenHint || '').trim();
    const effectiveKind = kind || (regionId ? 'partition' : 'content');

    if (!regionId) {
      let lastCorrections = null;
      for (const pid of targetPageIds) {
        const page = state.pages.find(p => p.pageId === pid);
        if (!page) throw new Error('找不到页面: ' + pid);
        page.corrections = {
          requestedAt: Math.max(now, (page.corrections?.requestedAt || 0) + 1),
          resolvedAt: null,
          partitionResolvedAt: effectiveKind === 'content' ? now : null,
          kind: effectiveKind,
          reason,
          aiHint: hint,
          redPenHint: hint
        };
        for (const region of page.regions || []) {
          region.corrections = { ...page.corrections };
        }
        invalidateSynthesis(page.batchId);
        lastCorrections = page.corrections;
      }
      saveState(state);
      return lastCorrections;
    }

    const singlePageId = targetPageIds[0];
    const page = state.pages.find(p => p.pageId === singlePageId);
    const target = regionId ? page?.regions.find(r => r.regionId === regionId) : page;
    if (!target || !['partition','content'].includes(effectiveKind)) throw new Error('纠错目标或类型无效');
    target.corrections = {
      requestedAt: Math.max(now, (target.corrections?.requestedAt || 0) + 1),
      resolvedAt: null,
      partitionResolvedAt: effectiveKind === 'content' ? now : null,
      kind: effectiveKind,
      reason,
      aiHint: hint,
      redPenHint: hint
    };
    if (regionId && page && !page.corrections) {
      page.corrections = { requestedAt: now, resolvedAt: null, partitionResolvedAt: effectiveKind === 'content' ? now : null, kind: effectiveKind, reason };
    }
    invalidateSynthesis(page.batchId);
    saveState(state);
    return target.corrections;
  }
  function resolveCorrection({pageId,regionId,expectedRevision} = {}) {
    contracts.validateRevisionConflict(state.revision,expectedRevision);assertPageScope(pageId);
    const page=state.pages.find(p=>p.pageId===pageId),target=regionId?page?.regions.find(r=>r.regionId===regionId):page;
    if(!target)throw new Error('纠错目标不存在');
    if(target.corrections)target.corrections.resolvedAt=Date.now();
    if(!regionId)for(const region of page.regions || [])if(region.corrections)region.corrections.resolvedAt=Date.now();
    saveState(state);return target.corrections || null;
  }

  const api = {
    rootDir: normalizedRoot,
    tasksDir,
    cropsDir,
    exportsDir,
    getState,
    peek,
    refreshFromDisk,
    reloadIfChanged:refreshFromDisk,
    runInBatch,
    transaction:transact,
    renameBatch,
    deleteBatch,
    requestCorrection,
    resolveCorrection,
    newBatch,
    saveCanvas,
    deleteCanvas,
    archiveBatch,
    listArchives,
    restoreArchive,
    organizeKnowledge,
    switchBatch,
    saveKnowledgeRelations,
    updatePage,
    deletePage,
    updateRegion,
    deleteRegion,
    saveState,
    resetToDemo,
    importPage,
    savePagePartition,
    saveRegionCard,
    savePageCards,
    saveGlobalSynthesis,
    updateCard,
    addCard,
    deleteCard,
    updateCanvasLayout,
    splitCard,
    mergeCards,
    cropRegion,
    importLocalFiles,
    exportSnapshot,
    consolidateBatchCanvases
  };
  const writeMethods=['renameBatch','deleteBatch','requestCorrection','resolveCorrection','newBatch','saveCanvas','deleteCanvas','archiveBatch','restoreArchive','organizeKnowledge','switchBatch','saveKnowledgeRelations','updatePage','deletePage','updateRegion','deleteRegion','saveState','resetToDemo','importPage','savePagePartition','saveRegionCard','savePageCards','saveGlobalSynthesis','updateCard','addCard','deleteCard','updateCanvasLayout','splitCard','mergeCards','cropRegion','importLocalFiles','exportSnapshot','consolidateBatchCanvases'];
  for(const name of writeMethods) {
    const method=api[name];
    api[name]=(...args)=>transact(()=>{
      if(batchScope && ['switchBatch','newBatch','importPage','importLocalFiles','restoreArchive','resetToDemo','organizeKnowledge','saveKnowledgeRelations','saveState','deleteBatch'].includes(name))throw new Error('批次任务不能改变界面工作上下文或执行全库写入');
      if(batchScope && name==='renameBatch' && args[0]?.batchId!==batchScope)throw new Error('只能命名本任务批次');
      const payload=args.find(arg=>arg && typeof arg==='object' && arg.operationId);
      if(payload && findLoggedOperation(payload.operationId))args=args.map(arg=>arg && typeof arg==='object' && !Array.isArray(arg)?{...arg,expectedRevision:undefined}:arg);
      if(name==='saveState' && args[0]!==state)contracts.validateRevisionConflict(state.revision,args[1] ?? args[0]?.revision);
      return method(...args);
    });
  }
  return api;
}

module.exports = {
  createWorkspaceStore,
  DEFAULT_DEMO_STATE
};
