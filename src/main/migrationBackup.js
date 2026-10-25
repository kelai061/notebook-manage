'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Called inside the workspace transaction lock, before any schema-7 asset writes.
function backupBeforeMigration(root) {
  const dir = path.join(root, 'backups', 'pre-schema7-' + Date.now() + '-' + crypto.randomUUID());
  fs.mkdirSync(dir, {recursive:true});
  const manifest = {createdAt:new Date().toISOString(), files:[]};
  for (const name of ['workspace-state.json','workspace-layouts.json','pages','crops']) {
    const src = path.join(root,name);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src,path.join(dir,name),{recursive:true, errorOnExist:true, force:false});
    manifest.files.push(name);
  }
  fs.writeFileSync(path.join(dir,'backup-complete.json'),JSON.stringify(manifest,null,2));
  return dir;
}
module.exports = {backupBeforeMigration};
