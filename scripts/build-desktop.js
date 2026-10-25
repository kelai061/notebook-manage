'use strict';
/**
 * build-desktop.js — PaperCard Atelier 本地桌面版构建与打包流水线
 *
 * 构建产物：
 *   1. `release/PaperCardAtelier/`：完整的 Electron 44.9 本地桌面运行包（使用 NTFS 硬链接复用本地 Electron 运行时二进制文件，零冗余体积开销）
 *   2. `release/PaperCardAtelier/resources/app/`：注入 `package.json`、`bootstrap.js` 及完整 `src/` 源码
 *   3. `PaperCardAtelier.exe`（项目根目录）：使用 Windows 原生 C# 编译器 (`csc.exe /target:winexe`) 编译的无黑框原生桌面启动器，支持转发 `--profile`、`--scenario`、`--shot` 与 `ELECTRON_RUN_AS_NODE=1`
 *   4. `启动工作台.cmd`、`PaperCardAtelier.vbs`、`创建桌面快捷方式.cmd`：配套启动与桌面快捷方式工具
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ELECTRON_SOURCES = [
  process.env.ELECTRON_DIST,
  process.env.ELECTRON_SOURCE_DIR,
  path.resolve(ROOT, '..', 'skills-manege', 'SkillAtelier'),
  path.resolve(ROOT, '..', '..', 'skills-manege', 'SkillAtelier')
].filter(Boolean);

let ELECTRON_SOURCE_DIR = DEFAULT_ELECTRON_SOURCES.find((d) => fs.existsSync(path.join(d, 'SkillAtelier.exe'))) || DEFAULT_ELECTRON_SOURCES[0];
const RELEASE_DIR = path.join(ROOT, 'release', 'PaperCardAtelier');
const APP_DIR = path.join(RELEASE_DIR, 'resources', 'app');

const RUNTIME_FILES = [
  'chrome_100_percent.pak',
  'chrome_200_percent.pak',
  'd3dcompiler_47.dll',
  'dxcompiler.dll',
  'dxil.dll',
  'ffmpeg.dll',
  'icudtl.dat',
  'LICENSE.electron.txt',
  'LICENSES.chromium.html',
  'resources.pak',
  'snapshot_blob.bin',
  'v8_context_snapshot.bin',
  'version',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll'
];

function linkOrCopyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    try { fs.unlinkSync(dest); } catch { /* ignore if locked */ return; }
  }
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
}

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function linkDirFiles(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      linkDirFiles(s, d);
    } else if (entry.isFile()) {
      linkOrCopyFile(s, d);
    }
  }
}

function buildDesktop() {
  console.log('[build-desktop] 1. 准备本地桌面分发目录:', RELEASE_DIR);
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.mkdirSync(APP_DIR, { recursive: true });

  const hasSourceRuntime = ELECTRON_SOURCE_DIR && fs.existsSync(path.join(ELECTRON_SOURCE_DIR, 'SkillAtelier.exe'));
  const hasExistingRuntime = fs.existsSync(path.join(RELEASE_DIR, 'PaperCardAtelier.exe'));

  if (!hasSourceRuntime && !hasExistingRuntime) {
    throw new Error(`未找到本地 Electron 宿主运行时: ${ELECTRON_SOURCE_DIR || '未配置'}`);
  }

  if (hasSourceRuntime) {
    console.log('[build-desktop] 2. 链接 Electron 44.9 核心二进制与 GPU/Chromium 资源...');
    linkOrCopyFile(
      path.join(ELECTRON_SOURCE_DIR, 'SkillAtelier.exe'),
      path.join(RELEASE_DIR, 'PaperCardAtelier.exe')
    );

    for (const file of RUNTIME_FILES) {
      const srcFile = path.join(ELECTRON_SOURCE_DIR, file);
      if (fs.existsSync(srcFile)) {
        linkOrCopyFile(srcFile, path.join(RELEASE_DIR, file));
      }
    }

    linkDirFiles(
      path.join(ELECTRON_SOURCE_DIR, 'locales'),
      path.join(RELEASE_DIR, 'locales')
    );

    const defaultAsar = path.join(ELECTRON_SOURCE_DIR, 'resources', 'default_app.asar');
    if (fs.existsSync(defaultAsar)) {
      linkOrCopyFile(defaultAsar, path.join(RELEASE_DIR, 'resources', 'default_app.asar'));
    }
  } else {
    console.log('[build-desktop] 2. 复用现有 release 二进制运行时基座...');
  }

  // 写入便携模式标记
  fs.writeFileSync(path.join(RELEASE_DIR, 'resources', 'PORTABLE.txt'), 'PaperCard Atelier Portable Mode\n', 'utf8');

  console.log('[build-desktop] 3. 写入 resources/app 应用引导与源码镜像...');
  const appPkg = {
    name: 'papercard-atelier',
    productName: 'PaperCard Atelier · 纸质笔记重新构建工作台',
    version: require(path.join(ROOT, 'package.json')).version,
    description: '本地原生桌面版纸质手写笔记识别、拆分、题解归属与自由画布重构工作台',
    main: 'bootstrap.js',
    private: true
  };
  fs.writeFileSync(path.join(APP_DIR, 'package.json'), JSON.stringify(appPkg, null, 2), 'utf8');

  const bootstrapCode = `'use strict';
const path = require('node:path');
const fs = require('node:fs');

// 若在工程工作区内运行，直接加载最新工作区源码并绑定工作区根目录；若独立分发运行则加载内置 src/
const devWorkspaceRoot = path.resolve(__dirname, '..', '..', '..', '..');
const devMain = path.join(devWorkspaceRoot, 'src', 'main', 'main.js');

if (fs.existsSync(devMain)) {
  if (!process.env.PAPERCARD_HOME) {
    process.env.PAPERCARD_HOME = devWorkspaceRoot;
  }
  require(devMain);
} else {
  if (!process.env.PAPERCARD_HOME) {
    process.env.PAPERCARD_HOME = path.resolve(__dirname, '..', '..');
  }
  require(path.join(__dirname, 'src', 'main', 'main.js'));
}
`;
  fs.writeFileSync(path.join(APP_DIR, 'bootstrap.js'), bootstrapCode, 'utf8');

  // 同步当前 src/ 到 resources/app/src 以保证独立目录也可直接运行
  copyDirRecursive(path.join(ROOT, 'src'), path.join(APP_DIR, 'src'));
  copyDirRecursive(path.join(ROOT, 'skills'), path.join(APP_DIR, 'skills'));

  console.log('[build-desktop] 4. 编译根目录原生 Win32 启动程序 PaperCardAtelier.exe...');
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const cscPath = process.env.CSC_PATH || path.join(sysRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const launcherCs = path.join(ROOT, 'scripts', 'Launcher.cs');
  const rootExe = path.join(ROOT, 'PaperCardAtelier.exe');

  if (fs.existsSync(cscPath) && fs.existsSync(launcherCs)) {
    execFileSync(cscPath, [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      `/out:${rootExe}`,
      `/win32icon:${path.join(ROOT, 'src', 'renderer', 'assets', 'papercard-icon.ico')}`,
      launcherCs
    ], { stdio: 'inherit' });
    console.log('[build-desktop] 已生成根目录原生启动器:', rootExe);
  }

  console.log('[build-desktop] 5. 生成快捷启动脚本 (启动工作台.cmd / PaperCardAtelier.vbs / 创建桌面快捷方式.cmd)...');
  const cmdContent = `@echo off
chcp 65001 >nul
set "PAPERCARD_HOME=%~dp0"
start "" "%~dp0release\\PaperCardAtelier\\PaperCardAtelier.exe" %*
`;
  fs.writeFileSync(path.join(ROOT, '启动工作台.cmd'), cmdContent, 'utf8');

  const vbsContent = `Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = baseDir & "\\release\\PaperCardAtelier\\PaperCardAtelier.exe"
shell.CurrentDirectory = baseDir
shell.Run """" & exePath & """", 1, False
`;
  fs.writeFileSync(path.join(ROOT, 'PaperCardAtelier.vbs'), vbsContent, 'utf8');

  const shortcutCmd = `@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\PaperCardAtelier.lnk'); $s.TargetPath = '%~dp0release\\PaperCardAtelier\\PaperCardAtelier.exe'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0src\\renderer\\assets\\papercard-icon.ico'; $s.Description = 'PaperCard Atelier 纸质笔记重新构建工作台'; $s.Save(); Write-Host '已在桌面创建快捷方式: PaperCardAtelier.lnk'"
`;
  fs.writeFileSync(path.join(ROOT, '创建桌面快捷方式.cmd'), shortcutCmd, 'utf8');

  console.log('[build-desktop] 构建完成！');
  return {
    rootExe,
    releaseExe: path.join(RELEASE_DIR, 'PaperCardAtelier.exe'),
    appDir: APP_DIR
  };
}

if (require.main === module) {
  buildDesktop();
}

module.exports = { buildDesktop };
