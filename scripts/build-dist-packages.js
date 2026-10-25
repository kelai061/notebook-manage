'use strict';
/**
 * build-dist-packages.js — PaperCard Atelier 1.0.0 发布包构建流水线
 *
 * 交付目标：
 *   1. dist/PaperCardAtelier-1.0.0.exe         (便携独立运行程序，内嵌运行时 payload，支持零依赖双击或外部调用)
 *   2. dist/PaperCardAtelier-1.0.0-Setup.exe   (Windows 现代化安装向导程序，支持 GUI 向导与 /S 静默模式)
 *   3. dist/PaperCardAtelier-1.0.0-win-x64.zip (绿色免安装 ZIP 压缩包，打包完整纯净 release 结构)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { buildDesktop } = require('./build-desktop');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release', 'PaperCardAtelier');
const DIST_DIR = path.join(ROOT, 'dist');
const ICON_PATH = path.join(ROOT, 'src', 'renderer', 'assets', 'papercard-icon.ico');
const CSC_PATH = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

const ZIP_NAME = 'PaperCardAtelier-1.0.0-win-x64.zip';
const PORTABLE_EXE_NAME = 'PaperCardAtelier-1.0.0.exe';
const SETUP_EXE_NAME = 'PaperCardAtelier-1.0.0-Setup.exe';

function computeSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

function ensureCleanRelease() {
  // 1. 同步桌面工程源码至 release/PaperCardAtelier/resources/app/
  console.log('[build-dist] 1. 执行桌面基座构建同步...');
  buildDesktop();

  // 2. 移除 release 中的运行时临时缓存与数据（避免将开发环境的本地缓存打入安装包）
  const dataDir = path.join(RELEASE_DIR, 'PaperCardAtelier-data');
  if (fs.existsSync(dataDir)) {
    console.log('[build-dist] 清理开发运行缓存目录:', dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  // 3. 确保 release 根目录下提供绿色便携启动脚本
  const releaseCmd = `@echo off\r\nchcp 65001 >nul\r\nstart "" "%~dp0PaperCardAtelier.exe" %*\r\n`;
  fs.writeFileSync(path.join(RELEASE_DIR, '启动工作台.cmd'), releaseCmd, 'utf8');

  const releaseShortcutCmd = `@echo off\r\nchcp 65001 >nul\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\PaperCardAtelier.lnk'); $s.TargetPath = '%~dp0PaperCardAtelier.exe'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0resources\\app\\src\\renderer\\assets\\papercard-icon.ico'; $s.Description = 'PaperCard Atelier 纸质笔记重新构建工作台'; $s.Save(); Write-Host '已在桌面创建快捷方式: PaperCardAtelier.lnk'"\r\n`;
  fs.writeFileSync(path.join(RELEASE_DIR, '创建桌面快捷方式.cmd'), releaseShortcutCmd, 'utf8');
}

function buildZipPackage(targetZipPath) {
  console.log('[build-dist] 2. 打包绿色便携 ZIP 压缩包 ->', targetZipPath);
  if (fs.existsSync(targetZipPath)) {
    fs.unlinkSync(targetZipPath);
  }

  // 使用 .NET System.IO.Compression.ZipFile 创建标准高效 ZIP
  const psScript = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
      '${RELEASE_DIR.replace(/'/g, "''")}',
      '${targetZipPath.replace(/'/g, "''")}',
      [System.IO.Compression.CompressionLevel]::Optimal,
      $false
    )
  `;

  execFileSync('powershell', ['-NoProfile', '-Command', psScript], { stdio: 'inherit' });
  const stat = fs.statSync(targetZipPath);
  console.log(`[build-dist] ZIP 压缩包已生成，体积: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  return targetZipPath;
}

function buildPortableExe(zipPath, targetExePath) {
  console.log('[build-dist] 3. 编译便携独立运行程序 ->', targetExePath);
  if (fs.existsSync(targetExePath)) {
    fs.unlinkSync(targetExePath);
  }

  const sourceCs = path.join(ROOT, 'scripts', 'dist', 'PortableLauncher.cs');
  if (!fs.existsSync(sourceCs)) {
    throw new Error('未找到 PortableLauncher.cs 源码: ' + sourceCs);
  }

  const args = [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    `/out:${targetExePath}`,
    `/win32icon:${ICON_PATH}`,
    '/r:System.IO.Compression.dll,System.IO.Compression.FileSystem.dll',
    `/resource:${zipPath},payload.zip`,
    sourceCs
  ];

  execFileSync(CSC_PATH, args, { stdio: 'inherit' });
  const stat = fs.statSync(targetExePath);
  console.log(`[build-dist] 便携可执行程序已生成，体积: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  return targetExePath;
}

function buildSetupExe(zipPath, targetSetupPath) {
  console.log('[build-dist] 4. 编译 Windows 安装向导向导程序 ->', targetSetupPath);
  if (fs.existsSync(targetSetupPath)) {
    fs.unlinkSync(targetSetupPath);
  }

  const sourceCs = path.join(ROOT, 'scripts', 'dist', 'Setup.cs');
  if (!fs.existsSync(sourceCs)) {
    throw new Error('未找到 Setup.cs 源码: ' + sourceCs);
  }

  const args = [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    `/out:${targetSetupPath}`,
    `/win32icon:${ICON_PATH}`,
    '/r:System.Windows.Forms.dll,System.Drawing.dll,System.IO.Compression.dll,System.IO.Compression.FileSystem.dll,Microsoft.CSharp.dll',
    `/resource:${zipPath},payload.zip`,
    sourceCs
  ];

  execFileSync(CSC_PATH, args, { stdio: 'inherit' });
  const stat = fs.statSync(targetSetupPath);
  console.log(`[build-dist] 安装向导程序已生成，体积: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  return targetSetupPath;
}

function verifyPackages(zipPath, portablePath, setupPath) {
  console.log('[build-dist] 5. 验证安装包可用性与完整性...');

  // 1. 验证存在与非空
  for (const p of [zipPath, portablePath, setupPath]) {
    if (!fs.existsSync(p)) {
      throw new Error(`产物丢失: ${p}`);
    }
    const stat = fs.statSync(p);
    if (stat.size < 1024 * 1024) {
      throw new Error(`产物体积异常过小 (<1MB): ${p} (${stat.size} bytes)`);
    }
  }

  // 2. 运行 portable exe --check
  try {
    const portableCheck = execFileSync(portablePath, ['--check'], { encoding: 'utf8', timeout: 5000 });
    console.log('[build-dist] 便携包自检输出:', portableCheck.trim());
  } catch (err) {
    console.warn('[build-dist] 便携包自检警告:', err.message);
  }

  // 3. 运行 setup exe --check
  try {
    const setupCheck = execFileSync(setupPath, ['--check'], { encoding: 'utf8', timeout: 5000 });
    console.log('[build-dist] 安装包自检输出:', setupCheck.trim());
  } catch (err) {
    console.warn('[build-dist] 安装包自检警告:', err.message);
  }

  // 4. 计算哈希与大小清单
  const results = [
    {
      name: PORTABLE_EXE_NAME,
      path: portablePath,
      size: fs.statSync(portablePath).size,
      sha256: computeSha256(portablePath)
    },
    {
      name: SETUP_EXE_NAME,
      path: setupPath,
      size: fs.statSync(setupPath).size,
      sha256: computeSha256(setupPath)
    },
    {
      name: ZIP_NAME,
      path: zipPath,
      size: fs.statSync(zipPath).size,
      sha256: computeSha256(zipPath)
    }
  ];

  return results;
}

function buildDistPackages() {
  const startTime = Date.now();
  console.log('============================================================');
  console.log(' PaperCard Atelier 1.0.0 发布包构建系统');
  console.log(' 目标输出目录:', DIST_DIR);
  console.log('============================================================');

  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 1. 准备纯净的 release 桌面基座
  ensureCleanRelease();

  // 2. 生成 ZIP 包
  const zipPath = path.join(DIST_DIR, ZIP_NAME);
  buildZipPackage(zipPath);

  // 3. 生成便携独立 EXE
  const portablePath = path.join(DIST_DIR, PORTABLE_EXE_NAME);
  buildPortableExe(zipPath, portablePath);

  // 4. 生成 Windows 安装程序 Setup.exe
  const setupPath = path.join(DIST_DIR, SETUP_EXE_NAME);
  buildSetupExe(zipPath, setupPath);

  // 5. 校验与生成清单
  const packageList = verifyPackages(zipPath, portablePath, setupPath);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('============================================================');
  console.log(` 构建完成！耗时: ${durationSec} 秒`);
  console.log('------------------------------------------------------------');
  for (const pkg of packageList) {
    console.log(`文件: ${pkg.name}`);
    console.log(`  路径:   ${pkg.path}`);
    console.log(`  大小:   ${(pkg.size / 1024 / 1024).toFixed(2)} MB (${pkg.size} bytes)`);
    console.log(`  SHA256: ${pkg.sha256}`);
  }
  console.log('============================================================');

  // 写入发布清单文件 dist/release-manifest.json
  const manifest = {
    version: '1.0.0',
    buildTime: new Date().toISOString(),
    packages: packageList
  };
  fs.writeFileSync(path.join(DIST_DIR, 'release-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return {
    distDir: DIST_DIR,
    packages: packageList
  };
}

if (require.main === module) {
  buildDistPackages();
}

module.exports = {
  buildDistPackages,
  computeSha256,
  ZIP_NAME,
  PORTABLE_EXE_NAME,
  SETUP_EXE_NAME
};
