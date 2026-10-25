'use strict';
const fs = require('node:fs');
// Watch the directory: rename-based atomic saves replace the file's inode.
function watchWorkspace({store, notify, debounceMs = 100, onError = console.error}) {
  let timer, closed = false, lastRevision = store.peek().revision;
  const reload = () => {
    if (closed) return;
    try {
      const result = store.refreshFromDisk();
      if (result.changed && result.revision !== lastRevision) {
        lastRevision = result.revision;
        notify({action: 'external-save', revision: result.revision});
      }
    } catch (error) {
      if (error.code === 'WORKSPACE_BUSY' || error.code === 'ENOENT') schedule();
      else onError(error);
    }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(reload, debounceMs); };
  const watcher = fs.watch(store.rootDir, (_event, name) => {
    if (!name || ['workspace-state.json', 'workspace-layouts.json'].includes(String(name))) schedule();
  });
  watcher.on('error', onError);
  return () => { closed = true; clearTimeout(timer); watcher.close(); };
}
module.exports = {watchWorkspace};
