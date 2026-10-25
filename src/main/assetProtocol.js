'use strict';
/**
 * assetProtocol.js — app://local/ 特权本地协议资源安全解析器
 * 
 * 对标 SkillAtelier 的安全沙箱设计：
 * 1. 仅允许访问项目内的 src/renderer/ 与 src/shared/ 目录资源，以及安全工作区内的 crops/ 截图片段。
 * 2. 严格防御路径穿越漏洞（拒绝包含 null 字节 '\0'、反斜杠 '\'、'..' 相对路径）。
 * 3. 使用 fs.realpathSync 确保解析后的真实物理路径不发生软链接逃逸。
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * 判断 file 是否严格处于 parent 目录内部
 */
function isInside(parent, file) {
  const rel = path.relative(parent, file);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

/**
 * 安全解析 app://local/... 请求路径到本地物理文件
 * @param {string} projectRoot 项目根目录（包含 src/ 与 workspace/）
 * @param {string} urlPath 请求的 URL 路径（例如 /index.html、/shared/contracts.js、/crops/demo.svg）
 * @param {string} [workspaceRoot] 独立工作区根目录（若提供）
 * @returns {string|null} 合法的绝对文件路径，若非法或不存在则返回 null
 */
function resolveAsset(projectRoot, urlPath, workspaceRoot) {
  let clean;
  try {
    clean = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  } catch {
    return null;
  }

  // 严格安全检查：杜绝空字节与路径操纵符
  if (!clean || clean.includes('\0') || clean.includes('\\')) {
    return null;
  }

  const srcDir = path.join(projectRoot, 'src');
  const wsRoot = workspaceRoot || path.join(projectRoot, 'workspace');

  let baseDir;
  let subPath;

  if (clean.startsWith('cache/images/')) {
    subPath = clean.slice('cache/images/'.length);
    if (!/^[a-f0-9]{64}-(thumbnail|preview)\.jpg$/.test(subPath)) return null;
    baseDir = path.join(wsRoot, 'cache', 'images');
  } else if (clean.startsWith('shared/')) {
    baseDir = path.join(srcDir, 'shared');
    subPath = clean.slice('shared/'.length);
  } else if (clean.startsWith('crops/')) {
    baseDir = path.join(wsRoot, 'crops');
    subPath = clean.slice('crops/'.length);
  } else if (clean.startsWith('pages/')) {
    baseDir = path.join(wsRoot, 'pages');
    subPath = clean.slice('pages/'.length);
  } else if (clean.startsWith('renderer/')) {
    baseDir = path.join(srcDir, 'renderer');
    subPath = clean.slice('renderer/'.length);
  } else {
    // 默认映射到 renderer 目录
    baseDir = path.join(srcDir, 'renderer');
    subPath = clean;
  }

  const target = path.resolve(baseDir, subPath);

  // 验证目标路径是否在基准目录内
  if (!isInside(baseDir, target)) {
    return null;
  }

  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return null;

    // 防止符号链接逃逸
    const realBase = fs.realpathSync(baseDir);
    const realTarget = fs.realpathSync(target);
    if (!isInside(realBase, realTarget)) {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}

module.exports = {
  resolveAsset,
  isInside
};

