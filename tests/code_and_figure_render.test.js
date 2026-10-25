'use strict';
/**
 * code_and_figure_render.test.js — 代码块排版、语法高亮与图像/矢量切片渲染专项测试
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '../src/renderer/js');

async function loadModules() {
  const katex = pathToFileURL(path.join(root, 'vendor/katex/katex.mjs')).href;
  const code = fs.readFileSync(path.join(root, 'noteFormat.js'), 'utf8')
    .replace("'./vendor/katex/katex.mjs'", JSON.stringify(katex));
  const formatUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  const format = await import(formatUrl);
  const media = await import('data:text/javascript;base64,' + Buffer.from(
    fs.readFileSync(path.join(root, 'media.js'), 'utf8')
      .replace("'./noteFormat.js'", JSON.stringify(formatUrl))
  ).toString('base64'));
  return { ...format, ...media };
}

test('Markdown triple backtick code blocks render high-quality containers with copy button', async () => {
  const { formatNoteHtml } = await loadModules();
  const raw = '```cpp\nvoid printQian(Biao* head) {\n  Biao* P = head;\n  while (P != nullptr) {\n    cout << P->data << endl;\n    P = P->next;\n  }\n}\n```';
  const html = formatNoteHtml(raw);

  assert.ok(html.includes('class="code-block-container"'), '应包含 .code-block-container 容器');
  assert.ok(html.includes('data-lang="cpp"'), '应包含 data-lang="cpp"');
  assert.ok(html.includes('class="code-block-header"'), '应包含 .code-block-header');
  assert.ok(html.includes('class="code-lang-tag"'), '应包含 .code-lang-tag');
  assert.ok(html.includes('CPP'), '语言标签应大写展示 CPP');
  assert.ok(html.includes('class="code-copy-btn"'), '应包含「复制代码」按钮');
  assert.ok(html.includes('navigator.clipboard?.writeText'), '复制按钮应绑定剪贴板写入');
  assert.ok(html.includes('class="code-block"'), '应包含 pre.code-block');
  assert.ok(html.includes('class="language-cpp"'), 'code 标签应包含 language-cpp');

  // Syntax highlighting assertions
  assert.ok(html.includes('<span class="tok-keyword">void</span>'), 'void 应高亮为关键字');
  assert.ok(html.includes('<span class="tok-keyword">while</span>'), 'while 应高亮为关键字');
  assert.ok(html.includes('<span class="tok-keyword">nullptr</span>'), 'nullptr 应高亮为关键字');
  assert.ok(html.includes('<span class="tok-keyword">cout</span>'), 'cout 应高亮为关键字');
  assert.ok(html.includes('<span class="tok-keyword">endl</span>'), 'endl 应高亮为关键字');
  assert.ok(html.includes('<span class="tok-type">Biao</span>'), 'Biao 应高亮为类型');
});

test('Syntax highlighting covers Python, JavaScript, SQL and Shell tokens', async () => {
  const { highlightCode } = await loadModules();

  // Python
  const py = highlightCode('def calculate(x, y=10):\n  # compute sum\n  name = "Alice"\n  return x + y', 'python');
  assert.ok(py.includes('class="tok-keyword">def</span>'), 'Python def 关键字');
  assert.ok(py.includes('class="tok-keyword">return</span>'), 'Python return 关键字');
  assert.ok(py.includes('class="tok-comment"># compute sum</span>'), 'Python # 注释');
  assert.ok(py.includes('class="tok-string">&quot;Alice&quot;</span>') || py.includes('class="tok-string">"Alice"</span>'), 'Python 字符串');
  assert.ok(py.includes('class="tok-number">10</span>'), 'Python 数字');

  // JS/TS
  const js = highlightCode('const PI = 3.14;\nlet user: String = "Bob"; // name', 'js');
  assert.ok(js.includes('class="tok-keyword">const</span>'), 'JS const 关键字');
  assert.ok(js.includes('class="tok-keyword">let</span>'), 'JS let 关键字');
  assert.ok(js.includes('class="tok-type">String</span>'), 'TS String 类型');
  assert.ok(js.includes('class="tok-comment">// name</span>'), 'JS 注释');
  assert.ok(js.includes('class="tok-number">3.14</span>'), 'JS 浮点数');

  // SQL
  const sql = highlightCode('SELECT id, name FROM users WHERE age > 18; -- filter', 'sql');
  assert.ok(sql.includes('class="tok-keyword">SELECT</span>'), 'SQL SELECT 关键字');
  assert.ok(sql.includes('class="tok-keyword">FROM</span>'), 'SQL FROM 关键字');
  assert.ok(sql.includes('class="tok-keyword">WHERE</span>'), 'SQL WHERE 关键字');
  assert.ok(sql.includes('class="tok-comment">-- filter</span>'), 'SQL -- 注释');

  // Shell
  const sh = highlightCode('echo "Running..."\n# install\ncd /tmp', 'bash');
  assert.ok(sh.includes('class="tok-keyword">echo</span>'), 'Shell echo 关键字');
  assert.ok(sh.includes('class="tok-keyword">cd</span>'), 'Shell cd 关键字');
  assert.ok(sh.includes('class="tok-comment"># install</span>'), 'Shell # 注释');
});

test('Inline code renders <code class="inline-code"> and escapes HTML', async () => {
  const { formatNoteHtml } = await loadModules();
  const raw = '调用 `vector<int>` 容器与 `cout << "Hello"` 输出。';
  const html = formatNoteHtml(raw);

  assert.ok(html.includes('<code class="inline-code">vector&lt;int&gt;</code>'), '行内代码应解析为 .inline-code 并转义尖括号');
  assert.ok(html.includes('<code class="inline-code">cout &lt;&lt; &quot;Hello&quot;</code>') || html.includes('<code class="inline-code">cout &lt;&lt; &#39;Hello&#39;</code>') || html.includes('<code class="inline-code">cout &lt;&lt; &quot;Hello&quot;</code>'), '代码中的特殊字符应转义');
  assert.doesNotMatch(html, /<code>vector<int><\/code>/);
});

test('Auto-detects and formats untagged consecutive C++ code from OCR note', async () => {
  const { formatNoteHtml } = await loadModules();
  const raw = '左栏代码：\nvoid printQian (Biao* head )\n{ Biao * P = head ;\nwhile (P!=nullptr )\n} cout << P->data << P->dataC <<endl,\nP = P->next ;\n}\n}\n\n后续正文。';
  const html = formatNoteHtml(raw);

  assert.ok(html.includes('class="code-block-container"'), '未加反引号的连贯代码段应自动识别为代码块');
  assert.ok(html.includes('data-lang="cpp"'), '应自动推断为 C++ 语言');
  assert.ok(html.includes('class="tok-keyword">void</span>'), '关键字 void 应正确高亮');
  assert.ok(html.includes('class="tok-type">Biao</span>'), '类型 Biao 应正确高亮');
  assert.ok(html.includes('<p>左栏代码：</p>'), '说明文字保留为普通段落');
  assert.ok(html.includes('<p>后续正文。</p>'), '后续文本不受影响');
});

test('Figure preview supports customSvg/svgData redraw and seamless toggle with page raster crop', async () => {
  const { figureSources, figurePreviewHtml } = await loadModules();

  const cardWithCustomSvg = {
    cardId: 'card-vector-1',
    pageId: 'page-01',
    regionId: 'reg-01-01',
    kind: 'figure',
    figureInfo: {
      hasFigure: true,
      customSvg: '<svg viewBox="0 0 400 200"><rect x="10" y="10" width="100" height="80" fill="#f00"/></svg>',
      cropPath: 'crops/reg-01-01.svg'
    }
  };

  const state = {
    pages: [{
      pageId: 'page-01',
      width: 3000,
      height: 4000,
      imagePath: 'workspace/pages/page-01.jpg',
      pageAssetUrl: 'app://local/pages/page-01.jpg',
      regions: [{
        regionId: 'reg-01-01',
        bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 }
      }]
    }]
  };

  const sources = figureSources(cardWithCustomSvg, state);
  assert.ok(sources.redraw, 'customSvg 应被识别为 redraw 资源');
  assert.ok(sources.redraw.startsWith('data:image/svg+xml'), 'redraw 应生成有效的 SVG data URL');

  const html = figurePreviewHtml(cardWithCustomSvg, state);
  assert.ok(html.includes('class="figure-preview'), '应包含 .figure-preview');
  assert.ok(html.includes('class="figure-redraw-main"'), '应渲染重绘主矢量图');
  assert.ok(html.includes('class="figure-crop-window"'), '应包含原纸栅格窗口');
  assert.ok(html.includes('切换原图 / 重绘'), '应包含切换原图/重绘按钮');
  assert.ok(html.includes('放大'), '应包含放大按钮');
  assert.ok(html.includes('app://local/pages/page-01.jpg'), '裁剪窗口应直接注入原图资源');
});

test('Missing image resources render .figure-placeholder instead of pure blank box', async () => {
  const { figurePreviewHtml } = await loadModules();

  const emptyCard = {
    cardId: 'card-empty',
    pageId: 'page-nonexistent',
    regionId: 'reg-nonexistent',
    kind: 'figure',
    figureInfo: {
      hasFigure: true
    }
  };

  const html = figurePreviewHtml(emptyCard, { pages: [] });
  assert.ok(html.includes('figure-placeholder'), '缺少图片资源时应回退到 .figure-placeholder');
  assert.ok(html.includes('原纸分区切片'), '应包含清晰的原纸分区切片提示');
  assert.doesNotMatch(html, /<img\s+src=""/);
});
