 'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {buildDesktop} = require('./build-desktop');
const ROOT = path.resolve(__dirname,'..');
const {releaseExe} = buildDesktop();
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'papercard-r5-preview-'));
const work = path.join(profile,'workspace');fs.mkdirSync(work,{recursive:true});
const tracked=['workspace-state.json','workspace-layouts.json'];
const hash = p=>fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'):null;
const before=Object.fromEntries(tracked.map(n=>[n,hash(path.join(ROOT,'workspace',n))]));
for(const name of [...tracked,'pages','crops']){const source=path.join(ROOT,'workspace',name);if(fs.existsSync(source))fs.cpSync(source,path.join(work,name),{recursive:true});}
const evidence=path.join(ROOT,'docs/r5-handoff');fs.mkdirSync(evidence,{recursive:true});
let failed=false;
try{execFileSync(releaseExe,[`--profile=${profile}`,`--scenario=${path.join(ROOT,'scripts/scenarios/preview-round5.js')}`],{cwd:ROOT,env:{...process.env,PAPERCARD_HOME:ROOT},stdio:'inherit',timeout:60000});}
catch(error){failed=true;console.error(error.message);}
finally{
 for(const name of ['round5-preview.json','scenario.log'])if(fs.existsSync(path.join(profile,name)))fs.copyFileSync(path.join(profile,name),path.join(evidence,name));
 if(fs.existsSync(path.join(profile,'shots')))fs.cpSync(path.join(profile,'shots'),path.join(evidence,'shots'),{recursive:true});
 const after=Object.fromEntries(tracked.map(n=>[n,hash(path.join(ROOT,'workspace',n))]));
 const unchanged=JSON.stringify(before)===JSON.stringify(after);
 fs.writeFileSync(path.join(evidence,'data-protection.json'),JSON.stringify({profile,before,after,unchanged,scope:'two visual spot checks only'},null,2));
 if(!unchanged)failed=true;
}
if(failed)process.exitCode=1;
