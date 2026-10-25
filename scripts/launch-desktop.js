'use strict';
/**
 * launch-desktop.js — 启动 PaperCard Atelier 本地原生桌面客户端
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildDesktop } = require('./build-desktop');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_EXE = path.join(ROOT, 'release', 'PaperCardAtelier', 'PaperCardAtelier.exe');

if (!fs.existsSync(RELEASE_EXE)) {
  buildDesktop();
}

const args = process.argv.slice(2);
const child = spawn(RELEASE_EXE, args, {
  cwd: ROOT,
  env: { ...process.env, PAPERCARD_HOME: ROOT },
  stdio: 'inherit',
  detached: false
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
