 'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const held = new Map();
const pauseBuffer = new Int32Array(new SharedArrayBuffer(4));
function retryable(message, code = 'WORKSPACE_BUSY') {
  const error = new Error(message); error.code = code; error.retryable = true; return error;
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
function readOwner(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
// Publish a complete owner record with a hard link, so a crash cannot leave an
// empty lock file whose owner is impossible to verify. A live PID is never reaped.
function withWorkspaceLock(root, operation, { timeoutMs = 1800 } = {}) {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(path.resolve(root), '.workspace-write.lock');
  if (held.has(file)) return operation();
  const token = crypto.randomUUID();
  const source = path.join(root, `.lock-owner-${process.pid}-${token}.json`);
  fs.writeFileSync(source, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
  const deadline = Date.now() + timeoutMs;
  let acquired = false;
  try {
    while (!acquired) {
      try { fs.linkSync(source, file); acquired = true; } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const owner = readOwner(file);
        if (owner && !alive(owner.pid)) {
          const guard = file + '.reclaim';
          let guarded = false;
          try {
            fs.linkSync(source, guard); guarded = true;
            const current = readOwner(file);
            if (current?.token === owner.token && !alive(current.pid)) fs.unlinkSync(file);
          } catch (reclaimError) {
            if (!['EEXIST', 'ENOENT'].includes(reclaimError.code)) throw reclaimError;
          } finally { if (guarded) { try { fs.unlinkSync(guard); } catch {} } }
        }
        if (Date.now() >= deadline) throw retryable('工作区正在保存，请稍后重试；不会覆盖其他进程的数据');
        Atomics.wait(pauseBuffer, 0, 0, 12);
      }
    }
    held.set(file, token);
    try { return operation(); } finally {
      held.delete(file);
      if (readOwner(file)?.token === token) fs.unlinkSync(file);
    }
  } finally { try { fs.unlinkSync(source); } catch {} }
}
module.exports = { withWorkspaceLock, retryable, alive };
