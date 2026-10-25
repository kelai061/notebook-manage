import katex from './vendor/katex/katex.mjs';

export function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function math(source, display=false) {
  try {
    return `<span class="${display?'math-block':'math-inline'}">${katex.renderToString(source, {displayMode:display,throwOnError:true,trust:false,strict:'ignore',maxExpand:1000,maxSize:30})}</span>`;
  } catch {
    return `<code class="math-fallback">${escapeHtml(source)}</code>`;
  }
}

const KEYWORDS = new Set([
  'class', 'struct', 'void', 'int', 'float', 'double', 'char', 'bool',
  'while', 'for', 'if', 'else', 'return', 'def', 'import', 'from',
  'public', 'private', 'protected', 'nullptr', 'NULL', 'true', 'false',
  'const', 'let', 'var', 'function', 'async', 'await', 'new', 'delete',
  'cout', 'cin', 'endl', 'typedef', 'switch', 'case', 'break', 'continue',
  'default', 'do', 'sizeof', 'template', 'typename', 'namespace', 'using',
  'try', 'catch', 'throw', 'virtual', 'override', 'auto', 'static',
  'extern', 'inline', 'explicit', 'friend', 'operator', 'this',
  'elif', 'pass', 'lambda', 'yield', 'with', 'as', 'raise', 'except',
  'finally', 'None', 'in', 'is', 'not', 'and', 'or', 'self',
  'typeof', 'instanceof', 'export', 'interface', 'type', 'implements',
  'extends', 'super', 'fn', 'mut', 'impl', 'trait', 'pub', 'mod',
  'match', 'enum', 'func', 'package', 'defer', 'select', 'fallthrough', 'range',
  'echo', 'cd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'grep', 'chmod', 'chown',
  'sudo', 'exit', 'then', 'fi', 'done', 'esac'
]);

const TYPES = new Set([
  'string', 'vector', 'map', 'set', 'pair', 'size_t', 'int8_t', 'int16_t',
  'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'String', 'Number', 'Boolean', 'Array', 'Object', 'Promise', 'Biao',
  'Node', 'TreeNode', 'ListNode', 'State', 'Status', 'i8', 'i16', 'i32',
  'i64', 'u8', 'u16', 'u32', 'u64', 'f32', 'f64', 'usize', 'isize', 'str'
]);

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'insert', 'into', 'update', 'delete', 'create',
  'table', 'drop', 'alter', 'join', 'left', 'right', 'inner', 'outer',
  'on', 'group', 'by', 'order', 'having', 'limit', 'and', 'or', 'not',
  'in', 'as', 'distinct', 'union', 'all', 'values', 'set', 'primary', 'key'
]);

export function highlightCode(code, lang='') {
  if (typeof code !== 'string') return '';
  const normalized = (lang || '').toLowerCase().trim();
  const isHashComment = ['python', 'py', 'shell', 'bash', 'sh', 'zsh', 'yaml', 'yml'].includes(normalized);
  const isSql = normalized === 'sql';

  const tokenRegex = isHashComment
    ? /(#[^\r\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|`(?:\\.|[^`\\])*`)|(\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\b[a-zA-Z_][a-zA-Z0-9_]*\b)/g
    : isSql
    ? /(--[^\r\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\r\n])*'|"(?:\\.|[^"\\\r\n])*")|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_][a-zA-Z0-9_]*\b)/g
    : /(#[ \t]*(?:include|define|ifdef|ifndef|endif|pragma)\b[^\r\n]*|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|#[^\r\n]*)|("(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|`(?:\\.|[^`\\])*`)|(\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\b[a-zA-Z_][a-zA-Z0-9_]*\b)/g;

  let lastIndex = 0;
  let out = '';
  let match;

  while ((match = tokenRegex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      out += escapeHtml(code.slice(lastIndex, match.index));
    }
    lastIndex = tokenRegex.lastIndex;

    const [raw, comment, str, num, word] = match;

    if (comment) {
      out += `<span class="tok-comment">${escapeHtml(comment)}</span>`;
    } else if (str) {
      out += `<span class="tok-string">${escapeHtml(str)}</span>`;
    } else if (num) {
      out += `<span class="tok-number">${escapeHtml(num)}</span>`;
    } else if (word) {
      const lower = word.toLowerCase();
      if (KEYWORDS.has(word) || KEYWORDS.has(lower) || (isSql && SQL_KEYWORDS.has(lower))) {
        out += `<span class="tok-keyword">${escapeHtml(word)}</span>`;
      } else if (TYPES.has(word) || TYPES.has(lower) || /^[A-Z][a-zA-Z0-9_]+$/.test(word) || word.endsWith('_t')) {
        out += `<span class="tok-type">${escapeHtml(word)}</span>`;
      } else {
        out += escapeHtml(word);
      }
    } else {
      out += escapeHtml(raw);
    }
  }

  if (lastIndex < code.length) {
    out += escapeHtml(code.slice(lastIndex));
  }

  return out;
}

export function renderCodeBlockHtml(code, lang='') {
  const cleanLang = (lang || '').trim();
  const displayTag = cleanLang ? cleanLang.toUpperCase() : 'CODE';
  const highlighted = highlightCode(code, cleanLang);
  return `<div class="code-block-container" data-lang="${escapeHtml(cleanLang)}"><div class="code-block-header"><span class="code-lang-tag">${escapeHtml(displayTag)}</span><button type="button" class="code-copy-btn" title="复制代码" onclick="navigator.clipboard?.writeText(this.closest('.code-block-container').querySelector('code').textContent)">复制</button></div><pre class="code-block" data-tag="<pre>"><code class="language-${escapeHtml(cleanLang)}">${highlighted}</code></pre></div>`;
}

function isCodeLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const stripped = trimmed.replace(/\/\/[^\r\n]*|#[^\r\n]*|\/\*[\s\S]*?\*\/|（[^）]*）|\([^)]*[\u4e00-\u9fa5][^)]*\)/g, '').trim();
  if (/[\u4e00-\u9fa5]/.test(stripped)) return false;
  if (/^(?:void|int|float|double|char|bool|class|struct|auto|long|short)\b.*[a-zA-Z0-9_]+\s*\(/.test(trimmed)) return true;
  if (/^(?:while|for|if|switch)\s*\(.*[;{)]?/.test(trimmed)) return true;
  if (/cout\s*<<|cin\s*>>|return\b|printf\s*\(|scanf\s*\(/.test(trimmed)) return true;
  if (/^[{}][ \t]*(?:[a-zA-Z0-9_]|$)/.test(trimmed)) return true;
  if (/^[a-zA-Z0-9_.*& \t]+=[^;=]+;/.test(trimmed)) return true;
  if (/(?:->|→)\s*[a-zA-Z0-9_]+/.test(trimmed) && /[;{}]/.test(trimmed)) return true;
  if (/^(?:#include\s+[<"]|def\s+[a-zA-Z0-9_]+\s*\(|import\s+[a-zA-Z0-9_]+|from\s+[a-zA-Z0-9_]+\s+import)/.test(trimmed)) return true;
  return false;
}

function detectCodeSnippet(lines, startIndex) {
  const prevLine = startIndex > 0 ? lines[startIndex - 1].trim() : '';
  const isAfterCodeLabel = /(?:代码|code|程序|算法)[：:]\s*$/i.test(prevLine);

  let count = 0;
  let j = startIndex;
  while (j < lines.length) {
    const cur = lines[j].trim();
    if (!cur) break; // End of block on empty line
    if (isCodeLine(lines[j]) || (isAfterCodeLabel && count > 0 && !/[\u4e00-\u9fa5]/.test(cur))) {
      count++;
      j++;
    } else {
      break;
    }
  }
  return count >= 2 ? j : -1;
}

function renderNoteHtml(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const tokens = [];
  const hold = html => `\uE000${tokens.push(html) - 1}\uE001`;

  // Standard triple backtick markdown code blocks
  let text = raw.replace(/```([a-zA-Z0-9_-]*)[^\n\r]*\r?\n([\s\S]*?)```/g, (_, lang, code) => {
    return hold(renderCodeBlockHtml(code, lang));
  });

  // Inline code
  text = text.replace(/`([^`\n\r]+)`/g, (_, code) => hold(`<code class="inline-code">${escapeHtml(code)}</code>`));

  // Math equations
  text = text.replace(/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g, (_, a, b) => hold(math(a ?? b, true)));
  text = text.replace(/(^|[^\\])\$([^$\n]+)\$|\\\(([\s\S]*?)\\\)/g, (_, prefix, a, b) => (prefix || '') + hold(math(a ?? b)));
  text = text.replace(/\\begin\{(aligned|align\*?|cases|matrix|pmatrix|bmatrix)\}[\s\S]*?\\end\{\1\}/g, s => hold(math(s, true)));

  // Preserve unmarked TeX as a complete expression, rather than deleting commands.
  text = text.split('\n').map(line => /\\[A-Za-z]+/.test(line) && !line.includes('\uE000') ? hold(math(line, true)) : line).join('\n');

  const inline = s => escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const lines = text.split(/\r?\n/);
  let html = '', list = null;
  const endList = () => { if (list) { html += `</${list}>`; list = null; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { endList(); continue; }

    // Table
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      endList();
      const cells = s => s.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
      html += '<div class="math-table-wrap"><table><thead><tr>' + cells(line).map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
      i++;
      while (i + 1 < lines.length && lines[i + 1].includes('|')) html += '<tr>' + cells(lines[++i]).map(c => `<td>${c}</td>`).join('') + '</tr>';
      html += '</tbody></table></div>';
      continue;
    }

    // Unmarked consecutive code snippet detection
    if (!line.includes('\uE000')) {
      const codeEnd = detectCodeSnippet(lines, i);
      if (codeEnd > i) {
        endList();
        const snippetLines = lines.slice(i, codeEnd);
        const snippetText = snippetLines.join('\n');
        const inferredLang = /(?:cout|cin|endl|nullptr|Biao|->|#include)/.test(snippetText) ? 'cpp' : /(?:def|import|self)/.test(snippetText) ? 'python' : 'text';
        html += renderCodeBlockHtml(snippetText, inferredLang);
        i = codeEnd - 1;
        continue;
      }
    }

    // List items
    const item = line.match(/^\s*(?:([-+*])|\d+\.)\s+(.+)$/);
    if (item) {
      const tag = item[1] ? 'ul' : 'ol';
      if (list !== tag) { endList(); list = tag; html += `<${tag}>`; }
      html += `<li>${inline(item[2])}</li>`;
      continue;
    }

    endList();
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    html += heading ? `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>` : `<p>${inline(line)}</p>`;
  }
  endList();
  return html.replace(/\uE000(\d+)\uE001/g, (_, n) => tokens[Number(n)] || '');
}

// Bounded by both entry count and HTML bytes so repeated view switches are cheap.
const noteCache = new Map();
let noteCacheBytes = 0;

export function formatNoteHtml(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  if (noteCache.has(raw)) {
    const cached = noteCache.get(raw);
    noteCache.delete(raw);
    noteCache.set(raw, cached);
    return cached;
  }
  const html = renderNoteHtml(raw);
  if (html.length < 500000) {
    noteCache.set(raw, html);
    noteCacheBytes += raw.length + html.length;
    while (noteCache.size > 256 || noteCacheBytes > 8000000) {
      const key = noteCache.keys().next().value;
      noteCacheBytes -= key.length + noteCache.get(key).length;
      noteCache.delete(key);
    }
  }
  return html;
}

export function formatNotePreviewHtml(raw, {maxChars=1400, maxLines=12}={}) {
  if (typeof raw !== 'string' || !raw) return '';
  const budget = Math.max(40, Math.min(10000, maxChars));
  let end = Math.min(raw.length, budget), lineEnd = -1;
  const bounded = raw.slice(0, end);
  for (let n = 0; n < Math.max(1, maxLines); n++) {
    lineEnd = bounded.indexOf('\n', lineEnd + 1);
    if (lineEnd < 0 || lineEnd > end) break;
    if (n === maxLines - 1) end = lineEnd;
  }
  if (end === raw.length) return formatNoteHtml(raw);
  const prefix = raw.slice(0, end);
  const stack = [];
  let opening = -1;
  const pattern = /\\begin\{([^}]+)\}|\\end\{([^}]+)\}|\$\$|\$|\\\[|\\\]|\\\(|\\\)|```/g;
  let match;
  while ((match = pattern.exec(prefix))) {
    const token = match[0];
    if (token === '$' && match.index && prefix[match.index - 1] === '\\') continue;
    const closing = match[2] || ({'\\]':'\\[','\\)':'\\('}[token]);
    const key = match[1] ? 'env:' + match[1] : match[2] ? 'env:' + match[2] : token;
    if (closing) {
      if (stack.at(-1) === (match[2] ? 'env:' + match[2] : closing)) stack.pop();
    } else if (stack.at(-1) === key) stack.pop();
    else {
      if (!stack.length) opening = match.index;
      stack.push(key);
    }
  }
  const cut = stack.length ? opening : end;
  const content = cut > 0 ? formatNoteHtml(raw.slice(0, cut)) : '<p>' + escapeHtml(prefix) + '</p>';
  return content + '<span class="note-preview-more" aria-label="正文已缩略">…</span>';
}
