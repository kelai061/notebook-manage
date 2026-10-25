 'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {buildDesktop} = require('./build-desktop');
const ROOT = path.resolve(__dirname, '..');
const {releaseExe} = buildDesktop();
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercard-r4-verify-'));
const scenarioPath = path.join(ROOT, 'scripts/scenarios/verify-r4.js');
const evidenceDir = path.join(ROOT, 'docs/r4-verification');
fs.mkdirSync(evidenceDir, {recursive:true});
// Test a copy of the actual user's 21-page workspace. All test mutations stay in this profile.
const sourceState = path.join(ROOT,'workspace/workspace-state.json');
if (fs.existsSync(sourceState)) {
  const target = path.join(profileDir,'workspace');
  fs.mkdirSync(target,{recursive:true});
  fs.copyFileSync(sourceState,path.join(target,'workspace-state.json'));
  for (const name of ['pages','crops']) {
    const src=path.join(ROOT,'workspace',name);
    if(fs.existsSync(src))fs.cpSync(src,path.join(target,name),{recursive:true});
  }
}
const originalHash = fs.existsSync(sourceState) ? require('node:crypto').createHash('sha256').update(fs.readFileSync(sourceState)).digest('hex') : null;
console.log('[verify-desktop] Isolated profile:', profileDir);
let failure;
try {
  execFileSync(releaseExe,[`--profile=${profileDir}`,`--scenario=${scenarioPath}`],{
    cwd:ROOT,env:{...process.env,PAPERCARD_HOME:ROOT},stdio:'inherit',timeout:120000
  });
} catch (error) { failure=error; }
finally {
  for(const name of ['desktop-verification-report.json','scenario.log']) {
    const src=path.join(profileDir,name);if(fs.existsSync(src))fs.copyFileSync(src,path.join(evidenceDir,name));
  }
  const shots=path.join(profileDir,'shots');
  if(fs.existsSync(shots))fs.cpSync(shots,path.join(evidenceDir,'shots'),{recursive:true});
  const currentHash=fs.existsSync(sourceState)?require('node:crypto').createHash('sha256').update(fs.readFileSync(sourceState)).digest('hex'):null;
  fs.writeFileSync(path.join(evidenceDir,'data-protection.json'),JSON.stringify({sourceState,originalHash,currentHash,unchanged:originalHash===currentHash,profileDir},null,2));
  if(currentHash!==originalHash)failure=new Error('User workspace changed during verification');
}
if(failure){console.error('[verify-desktop] FAILED; profile retained:',profileDir);process.exitCode=1;}
else console.log('[verify-desktop] PASS; evidence:',evidenceDir);
