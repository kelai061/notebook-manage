'use strict';
/**
 * main.js — PaperCard Atelier 本地桌面主进程入口
 * 
 * 核心架构：
 * 1. 原生桌面沙箱架构：基于 Electron 44.9，注册特权 app:// 协议，完全不开放 HTTP 端口。
 * 2. 渲染进程安全沙箱：contextIsolation: true, nodeIntegration: false, sandbox: true。
 * 3. 现代化无边框沉浸窗口：titleBarStyle: 'hidden', titleBarOverlay 自定义色彩与原生控制按钮。
 * 4. 自动化场景验收机制：支持 --profile=<dir> 隔离目录、--scenario=<script> 自动化执行、--shot 自动截图。
 */

const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

const { resolveAsset } = require('./assetProtocol');
const { createWorkspaceStore } = require('./store');
const ipc = require('./ipc');
const {createImageCache} = require('./imageCache');
const {watchWorkspace} = require('./workspaceWatcher');

// 项目根目录定义
const ROOT = path.resolve(__dirname, '..', '..');

// 注册特权协议 app://
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

app.setAppUserModelId('local.PaperCardAtelier');
let mainWindow = null;
let store = null;
let stopWorkspaceWatcher = null;

// ============================================================
// 1. 命令行参数解析与环境配置
// ============================================================
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
const scenarioArg = process.argv.find((a) => a.startsWith('--scenario='));
const shotMode = process.argv.includes('--shot');
const isDev = process.argv.includes('--dev');
const isAutomated = !!scenarioArg || shotMode;

let profileDir = null;
if (profileArg) {
  profileDir = path.resolve(profileArg.slice('--profile='.length));
  fs.mkdirSync(profileDir, { recursive: true });
  app.setPath('userData', profileDir);
} else if (app.isPackaged) {
  const portableBase = process.env.PORTABLE_EXECUTABLE_DIR ||
    (fs.existsSync(path.join(process.resourcesPath, 'PORTABLE.txt')) ? path.dirname(process.execPath) : '');
  const targetDataDir = portableBase
    ? path.join(portableBase, 'PaperCardAtelier-data')
    : path.join(app.getPath('userData'), 'PaperCardAtelier-data');
  try {
    fs.mkdirSync(targetDataDir, { recursive: true });
    app.setPath('userData', targetDataDir);
  } catch {}
}

// 单实例进程锁
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  console.log('[PaperCard Main] 检测到已有运行实例，当前进程退出');
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

if (isAutomated) {
  // 自动化测试环境关闭硬件加速与 GPU 合成，防止无头环境下打崩
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('no-sandbox');
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 屏幕截图辅助函数 (供自动化场景脚本与 --shot 模式调用)
 * @param {string} name 截图文件名（不含 .png）
 */
async function shot(name) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;

  // 等待渲染管线稳定
  await mainWindow.webContents.executeJavaScript(`
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })
  `);
  await delay(120);

  const image = await mainWindow.capturePage();
  const pngBuffer = image.toPNG();

  const shotsDir = path.join(ROOT, 'docs', 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const shotPath = path.join(shotsDir, `${name}.png`);
  fs.writeFileSync(shotPath, pngBuffer);

  if (profileDir) {
    const profileShotsDir = path.join(profileDir, 'shots');
    fs.mkdirSync(profileShotsDir, { recursive: true });
    fs.writeFileSync(path.join(profileShotsDir, `${name}.png`), pngBuffer);
  }

  console.log(`[PaperCard Shot] 截图已生成: ${shotPath}`);
  return shotPath;
}

// ============================================================
// 2. 窗口创建与应用初始化
// ============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#f4f1ea',
    icon: path.join(ROOT, 'src', 'renderer', 'assets', 'papercard-icon.ico'),
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f4f1ea',
      symbolColor: '#182232',
      height: 52
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: false,
      additionalArguments: isAutomated ? ['--papercard-automated'] : []
    }
  });

  Menu.setApplicationMenu(null);

  if (isAutomated) {
    mainWindow.webContents.setBackgroundThrottling(false);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 安全限制：外部超链接一律交给系统默认浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 转发渲染进程日志便于调试
  if (isDev || isAutomated) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
      console.log(`[renderer:${level}] ${message} (${source}:${line})`);
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('[PaperCard Load Error]', code, desc, url);
    });
  }

  // 加载本地特权应用页面
  mainWindow.loadURL('app://local/index.html');

  // ============================================================
  // 3. 自动化场景验收脚本驱动 (--scenario)
  // ============================================================
  if (scenarioArg) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await delay(1200);
      let exitCode = 0;
      const logFile = path.join(app.getPath('userData'), 'scenario.log');
      const log = (msg) => {
        try {
          fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
        } catch {}
      };

      log('Scenario start: ' + scenarioArg);
      try {
        const scenarioFilePath = path.resolve(scenarioArg.slice('--scenario='.length));
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const scenarioModule = require(scenarioFilePath);
        const runner = typeof scenarioModule === 'function' ? scenarioModule : scenarioModule.run;

        const result = await runner({
          win: mainWindow,
          app,
          store,
          delay,
          shot,
          log
        });

        log('Scenario done: ' + JSON.stringify(result));
        if (result && result.ok === false) exitCode = 1;
      } catch (err) {
        log('Scenario failed: ' + (err.stack || err));
        console.error('[PaperCard Scenario Failed]', err);
        exitCode = 1;
      }

      app.exit(exitCode);
    });
  } else if (shotMode) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await delay(1500);
      try {
        await shot('desktop-overview');
      } catch (err) {
        console.error('[PaperCard Shot Error]', err);
      }
      app.exit(0);
    });
  }
}

// ============================================================
// 4. Electron 核心就绪与生命周期
// ============================================================
app.whenReady().then(() => {
  // 1. 初始化工作区存储
  const workspaceRoot = profileDir
    ? path.join(profileDir, 'workspace')
    : (process.env.PAPERCARD_HOME ? path.join(process.env.PAPERCARD_HOME, 'workspace') : path.join(ROOT, 'workspace'));

  fs.mkdirSync(workspaceRoot, { recursive: true });
  store = createWorkspaceStore(workspaceRoot, { seedDemo: true });

  // 2. 注册 app:// 自定义协议处理器
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const targetFile = resolveAsset(ROOT, url.pathname, store.rootDir);
    if (!targetFile) {
      return new Response('404 Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }
    return net.fetch(pathToFileURL(targetFile).toString());
  });

  let pageRevision = null, pageIndex = new Map();
  const imageCache = createImageCache({workspaceRoot: store.rootDir, getPage: pageId => {
    const revision = store.peek().revision;
    if (revision !== pageRevision) {
      pageIndex = new Map(store.getState().pages.map(page => [page.pageId, page]));
      pageRevision = revision;
    }
    return pageIndex.get(pageId);
  }});
  const notifyWorkspace = data => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workspace:changed', data);
  };
  stopWorkspaceWatcher = watchWorkspace({store, notify:notifyWorkspace});

  // Register sandboxed IPC, including bounded on-demand image requests.
  ipc.register({
    imageCache,
    getWorkspaceRoot: () => store.rootDir,
    notifyRenderer: (channel, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
      }
    },
    store
  });

  // 4. 打开主窗口
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => stopWorkspaceWatcher?.());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

module.exports = {
  createWindow,
  shot
};
