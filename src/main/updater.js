'use strict';
/**
 * updater.js — PaperCard Atelier 本地客户端更新模块
 *
 * 核心功能：
 * 1. 检查 GitHub Releases API (https://api.github.com/repos/kelai061/notebook-manage/releases/latest)
 * 2. 语义化版本号 (semver) 比较与版本提取
 * 3. 获取更新信息：{ hasUpdate, currentVersion, latestVersion, releaseNotes, downloadUrl, assets }
 * 4. 下载更新包（下载到系统临时目录，广播下载进度 updater:progress，支持 302 自动重定向）
 * 5. 触发更新安装（调用 child_process 运行 Setup 安装程序并优雅退出应用）
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');
const { spawn } = require('node:child_process');

let electronApp = null;
try {
  // eslint-disable-next-line global-require
  const electron = require('electron');
  electronApp = electron.app;
} catch {
  // 单元测试或无头 Node 环境下忽略
}

const DEFAULT_REPO = 'kelai061/notebook-manage';
const DEFAULT_API_URL = `https://api.github.com/repos/${DEFAULT_REPO}/releases/latest`;

/**
 * 获取当前应用的版本号（优先从当前 package.json 读取）
 * @param {string} [customPath]
 * @returns {string}
 */
function getCurrentAppVersion(customPath) {
  try {
    const pkgPath = customPath || path.resolve(__dirname, '..', '..', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.version) return String(pkg.version).trim();
    }
  } catch (err) {
    console.warn('[Updater] 读取 package.json 版本失败:', err.message);
  }
  return '1.0.0';
}

/**
 * 解析语义化版本号
 * 支持 v1.0.0, 1.2.3, 2.0.0-beta.1, 1.0 等格式
 * @param {string} ver
 * @returns {{ major: number, minor: number, patch: number, prerelease: string, raw: string }}
 */
function parseSemver(ver) {
  const raw = String(ver || '').trim();
  const clean = raw.replace(/^[vV]/, '');
  const [mainPart, ...preParts] = clean.split('-');
  const prerelease = preParts.join('-');

  const parts = mainPart.split('.').map((p) => {
    const num = parseInt(p, 10);
    return Number.isFinite(num) ? num : 0;
  });

  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
    prerelease,
    raw
  };
}

/**
 * 比较两个语义化版本号
 * @param {string} v1
 * @param {string} v2
 * @returns {number} 1 表示 v1 > v2，-1 表示 v1 < v2，0 表示相等
 */
function compareSemver(v1, v2) {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);

  if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
  if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
  if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;

  // 若主版本相同，有预发布版本标签的比没有预发布版本的小 (如 1.0.0-beta < 1.0.0)
  if (p1.prerelease && !p2.prerelease) return -1;
  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && p2.prerelease) {
    return p1.prerelease.localeCompare(p2.prerelease);
  }

  return 0;
}

/**
 * 判断 latest 版本是否比 current 版本新
 * @param {string} latest
 * @param {string} current
 * @returns {boolean}
 */
function isNewerVersion(latest, current) {
  return compareSemver(latest, current) > 0;
}

/**
 * 从 GitHub Releases Assets 中选取最佳下载包
 * 优先级：.exe (Setup安装包) > .zip (绿色解压包) > 第一个可用 asset > zipball_url
 * @param {object} releaseData
 * @returns {{ downloadUrl: string | null, assetName: string | null, assetSize: number }}
 */
function pickBestAsset(releaseData) {
  const assets = Array.isArray(releaseData?.assets) ? releaseData.assets : [];

  // 1. 优先查找 Windows 可执行安装包 (.exe)
  const exeAsset = assets.find((a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe'));
  if (exeAsset) {
    return {
      downloadUrl: exeAsset.browser_download_url || exeAsset.url,
      assetName: exeAsset.name,
      assetSize: exeAsset.size || 0
    };
  }

  // 2. 其次查找 zip 包
  const zipAsset = assets.find((a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.zip'));
  if (zipAsset) {
    return {
      downloadUrl: zipAsset.browser_download_url || zipAsset.url,
      assetName: zipAsset.name,
      assetSize: zipAsset.size || 0
    };
  }

  // 3. 回退为第一个 asset
  if (assets.length > 0 && assets[0]) {
    return {
      downloadUrl: assets[0].browser_download_url || assets[0].url,
      assetName: assets[0].name,
      assetSize: assets[0].size || 0
    };
  }

  // 4. 回退为 GitHub 自动生成的 zipball 或 html_url
  return {
    downloadUrl: releaseData?.zipball_url || releaseData?.html_url || null,
    assetName: releaseData?.tag_name ? `${releaseData.tag_name}.zip` : null,
    assetSize: 0
  };
}

/**
 * 封装发起 HTTPS GET 请求（支持自定义 headers、超时与 JSON 解析）
 * @param {string} requestUrl
 * @param {object} [options]
 * @returns {Promise<{ statusCode: number, headers: object, data: string, json: any }>}
 */
function httpGet(requestUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(requestUrl);
    const client = parsedUrl.protocol === 'http:' ? http : https;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'PaperCard-Atelier-Updater/1.0.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/vnd.github.v3+json',
        ...(options.headers || {})
      },
      timeout: options.timeout || 12000
    };

    const req = client.request(reqOptions, (res) => {
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch {
          // 非 JSON 数据
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: rawData,
          json
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`请求超时 (${reqOptions.timeout}ms): ${requestUrl}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * 检查 GitHub Releases 最新版本并比较
 * @param {object} [options]
 * @param {string} [options.releaseUrl] 自定义检查接口地址
 * @param {string} [options.currentVersion] 强制指定当前版本（默认读取 package.json）
 * @param {object} [options.mockRelease] 模拟发布数据（用于单测）
 * @param {Function} [options.fetchFn] 自定义请求函数
 * @returns {Promise<{ hasUpdate: boolean, currentVersion: string, latestVersion: string, releaseNotes: string, downloadUrl: string | null, assets: Array<object>, name: string, publishedAt: string | null }>}
 */
async function checkForUpdates(options = {}) {
  const currentVersion = options.currentVersion || getCurrentAppVersion(options.packageJsonPath);
  let releaseData = null;

  if (options.mockRelease) {
    releaseData = options.mockRelease;
  } else if (typeof options.fetchFn === 'function') {
    releaseData = await options.fetchFn();
  } else {
    const url = options.releaseUrl || DEFAULT_API_URL;
    try {
      const res = await httpGet(url, { timeout: options.timeout || 10000 });

      // GitHub Releases 若尚未创建任何 Release 会返回 404
      if (res.statusCode === 404) {
        return {
          hasUpdate: false,
          currentVersion,
          latestVersion: currentVersion,
          releaseNotes: '暂无可用的更新发布（GitHub 暂未发布 Release）',
          downloadUrl: null,
          assets: [],
          name: '最新版',
          publishedAt: null
        };
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`GitHub API 响应异常: HTTP ${res.statusCode} ${res.data?.slice(0, 100)}`);
      }

      releaseData = res.json;
    } catch (err) {
      console.warn('[Updater] 检查更新失败:', err.message);
      throw new Error(`检查更新失败: ${err.message}`);
    }
  }

  if (!releaseData || typeof releaseData !== 'object') {
    throw new Error('未能获取有效的 Release 数据');
  }

  const latestTag = releaseData.tag_name || releaseData.name || '';
  const parsedTag = parseSemver(latestTag);
  const latestVersion = parsedTag.raw.replace(/^[vV]/, '') || currentVersion;
  const releaseNotes = releaseData.body || '无更新日志说明';
  const { downloadUrl } = pickBestAsset(releaseData);
  const assets = Array.isArray(releaseData.assets) ? releaseData.assets : [];

  const hasUpdate = isNewerVersion(latestVersion, currentVersion);

  return {
    hasUpdate,
    currentVersion,
    latestVersion,
    releaseNotes,
    downloadUrl,
    assets,
    name: releaseData.name || latestTag || `v${latestVersion}`,
    publishedAt: releaseData.published_at || null
  };
}

/**
 * 下载更新包并广播下载进度
 * 支持跟踪进度、计算瞬时下载速率，并自动追踪 HTTP 301/302 重定向 (GitHub Releases CDN 必备)
 * @param {string} downloadUrl
 * @param {object} [options]
 * @param {string} [options.targetDir] 保存目录 (默认系统临时目录)
 * @param {string} [options.fileName] 保存文件名
 * @param {Function} [options.onProgress] 进度回调函数 ({ percent, transferred, total, speed, fileName })
 * @param {Function} [options.notifyRenderer] 广播给渲染进程
 * @param {number} [options.maxRedirects] 最大重定向次数
 * @returns {Promise<{ filePath: string, fileName: string, fileSize: number }>}
 */
function downloadUpdate(downloadUrl, options = {}) {
  return new Promise((resolve, reject) => {
    if (!downloadUrl || typeof downloadUrl !== 'string') {
      return reject(new Error('未提供有效的下载地址 downloadUrl'));
    }

    const targetDir = options.targetDir || path.join(os.tmpdir(), 'papercard-updater');
    fs.mkdirSync(targetDir, { recursive: true });

    let fileName = options.fileName;
    if (!fileName) {
      try {
        const u = new URL(downloadUrl);
        fileName = path.basename(u.pathname) || `update-${Date.now()}.exe`;
      } catch {
        fileName = `update-${Date.now()}.exe`;
      }
    }
    // 防止文件名非法字符
    fileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
    const targetFilePath = path.join(targetDir, fileName);

    const maxRedirects = options.maxRedirects || 5;

    function executeDownload(currentUrl, redirectCount) {
      if (redirectCount > maxRedirects) {
        return reject(new Error(`下载重定向次数过多 (> ${maxRedirects})`));
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(currentUrl);
      } catch (err) {
        return reject(new Error(`无效的下载地址: ${currentUrl}`));
      }

      const client = parsedUrl.protocol === 'http:' ? http : https;
      const req = client.get(
        currentUrl,
        {
          headers: {
            'User-Agent': 'PaperCard-Atelier-Updater/1.0.0 (Windows NT 10.0; Win64; x64)',
            Accept: '*/*'
          },
          timeout: options.timeout || 30000
        },
        (res) => {
          // 处理 301, 302, 307, 308 重定向
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, currentUrl).toString();
            res.resume(); // 消费响应流以释放 socket
            return executeDownload(redirectUrl, redirectCount + 1);
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return reject(new Error(`下载更新包响应失败: HTTP ${res.statusCode}`));
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let transferredBytes = 0;
          let lastTransferred = 0;
          let lastTime = Date.now();
          let currentSpeed = 0;

          const fileStream = fs.createWriteStream(targetFilePath);

          res.on('data', (chunk) => {
            transferredBytes += chunk.length;
            const now = Date.now();
            const elapsed = now - lastTime;

            if (elapsed >= 300 || transferredBytes === totalBytes) {
              currentSpeed = elapsed > 0 ? ((transferredBytes - lastTransferred) / elapsed) * 1000 : 0;
              lastTime = now;
              lastTransferred = transferredBytes;

              const percent = totalBytes > 0 ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100)) : 0;
              const progressData = {
                percent,
                transferred: transferredBytes,
                total: totalBytes,
                speed: currentSpeed,
                fileName
              };

              if (typeof options.onProgress === 'function') {
                try {
                  options.onProgress(progressData);
                } catch {}
              }
              if (typeof options.notifyRenderer === 'function') {
                try {
                  options.notifyRenderer('updater:progress', progressData);
                } catch {}
              }
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close(() => {
              const finalProgress = {
                percent: 100,
                transferred: transferredBytes,
                total: totalBytes || transferredBytes,
                speed: 0,
                fileName,
                completed: true
              };
              if (typeof options.onProgress === 'function') {
                try {
                  options.onProgress(finalProgress);
                } catch {}
              }
              if (typeof options.notifyRenderer === 'function') {
                try {
                  options.notifyRenderer('updater:progress', finalProgress);
                } catch {}
              }

              resolve({
                filePath: targetFilePath,
                fileName,
                fileSize: transferredBytes
              });
            });
          });

          fileStream.on('error', (err) => {
            fs.unlink(targetFilePath, () => {});
            reject(err);
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('下载更新超时'));
      });

      req.on('error', (err) => {
        fs.unlink(targetFilePath, () => {});
        reject(err);
      });
    }

    executeDownload(downloadUrl, 0);
  });
}

/**
 * 安装更新包
 * 支持 Windows Setup 安装程序启动与退出重启
 * @param {string} filePath
 * @param {object} [options]
 * @param {boolean} [options.dryRun] 演练模式（用于测试，不真正运行与退出）
 * @param {Array<string>} [options.args] 传递给安装程序的命令行参数
 * @param {boolean} [options.quitApp] 是否在拉起安装程序后自动退出应用（默认 true）
 * @returns {Promise<{ ok: boolean, message: string, launched: boolean, filePath: string }>}
 */
async function installUpdate(filePath, options = {}) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('未提供有效的安装包路径 filePath');
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`安装包文件不存在: ${resolvedPath}`);
  }

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      launched: true,
      filePath: resolvedPath,
      message: '演练模式：安装程序就绪，模拟安装成功'
    };
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const installerArgs = Array.isArray(options.args) ? options.args : [];

  try {
    if (ext === '.exe') {
      // Windows Setup 可执行安装包：以独立子进程运行
      const child = spawn(resolvedPath, installerArgs, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.unref();

      // 退出当前应用，释放资源以便安装程序覆盖更新
      if (options.quitApp !== false && electronApp && typeof electronApp.quit === 'function') {
        setTimeout(() => {
          try {
            electronApp.quit();
          } catch {}
        }, 300);
      }

      return {
        ok: true,
        launched: true,
        filePath: resolvedPath,
        message: '安装程序已成功启动，正在准备更新并退出应用'
      };
    }

    // 其它类型（如 .zip 包）
    return {
      ok: true,
      launched: true,
      filePath: resolvedPath,
      message: `安装包已就绪 (${ext})`
    };
  } catch (err) {
    console.error('[Updater] 启动安装程序失败:', err);
    throw new Error(`启动更新安装程序失败: ${err.message}`);
  }
}

module.exports = {
  DEFAULT_REPO,
  DEFAULT_API_URL,
  getCurrentAppVersion,
  parseSemver,
  compareSemver,
  isNewerVersion,
  pickBestAsset,
  checkForUpdates,
  downloadUpdate,
  installUpdate
};
