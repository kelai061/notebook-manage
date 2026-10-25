'use strict';
// Isolated runner for a round-6 scenario: copies the real workspace into a temp profile.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const scenario = process.argv[2] || 'diag-r6.js';
const releaseExe = path.join(ROOT, 'PaperCardAtelier.exe');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-r6-'));
const sourceState = path.join(ROOT, 'workspace', 'workspace-state.json');
const target = path.join(profileDir, 'workspace');
fs.mkdirSync(target, {recursive: true});
if (fs.existsSync(sourceState)) fs.copyFileSync(sourceState, path.join(target, 'workspace-state.json'));
for (const name of ['pages', 'crops']) {
  const src = path.join(ROOT, 'workspace', name);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(target, name), {recursive: true});
}
const originalHash = fs.existsSync(sourceState) ? require('node:crypto').createHash('sha256').update(fs.readFileSync(sourceState)).digest('hex') : null;
console.log('[r6] profile:', profileDir);
let failure = null;
const env = {...process.env, PAPERCARD_HOME: ROOT};
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
try {
  execFileSync(releaseExe, [`--profile=${profileDir}`, `--scenario=${path.join(ROOT, 'scripts', 'scenarios', scenario)}`], {
    cwd: ROOT, env, stdio: 'inherit', timeout: 180000
  });
} catch (error) { failure = error; }
const shots = path.join(profileDir, 'shots');
if (fs.existsSync(shots)) fs.cpSync(shots, path.join(ROOT, 'docs', 'shots'), {recursive: true});
const currentHash = fs.existsSync(sourceState) ? require('node:crypto').createHash('sha256').update(fs.readFileSync(sourceState)).digest('hex') : null;
console.log('[r6] workspace untouched:', originalHash === currentHash);
if (currentHash !== originalHash) { console.error('[r6] REAL WORKSPACE CHANGED'); process.exitCode = 1; }
if (failure) { console.error('[r6] scenario failed; profile kept:', profileDir); process.exitCode = 1; }
