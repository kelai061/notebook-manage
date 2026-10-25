'use strict';
/**
 * src/preload/preload.js — 代理转发至 src/main/preload.js
 * 保证无论是通过 src/main/preload.js 还是 src/preload/preload.js 引用均能正常工作。
 */
module.exports = require('../main/preload.js');
