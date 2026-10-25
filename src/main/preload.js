'use strict';
/**
 * preload.js — 沙箱渲染进程的唯一安全能力出口
 *
 * 核心安全策略：
 * 1. 渲染进程完全处于沙箱环境（contextIsolation: true, nodeIntegration: false, sandbox: true）。
 * 2. 严禁暴露 require、fs、child_process 等底层危险能力。
 * 3. 仅通过 contextBridge.exposeInMainWorld 暴露 'papercard' 命名空间与严格白名单通道。
 * 4. 内联定义 19 个授权 IPC 通道，杜绝沙箱环境下相对路径 require 模块加载问题。
 */

const { contextBridge, ipcRenderer } = require('electron');

const AUTHORIZED_CHANNELS = new Set([
  'image:get',
  'batch:rename',
  'batch:delete',
  'page:delete',
  'page:saveCards',
  'page:modifyPrompt',
  'correction:request',
  'correction:resolve',
  'batch:switch',
  'page:update',
  'region:update',
  'region:delete',
  'knowledge:saveRelations',
  'workspace:peek',
  'batch:new',
  'batch:archive',
  'archive:list',
  'archive:restore',
  'canvas:save',
  'canvas:delete',
  'workspace:get',
  'workspace:resetDemo',
  'workspace:exportSnapshot',
  'page:importDialog',
  'page:import',
  'page:savePartition',
  'page:cropRegion',
  'card:save',
  'card:update',
  'card:add',
  'card:delete',
  'card:split',
  'card:merge',
  'synthesis:save',
  'canvas:updateLayout',
  'agent:generatePrompt',
  'agent:taskStatus',
  'clipboard:write',
  'shell:openPath',
  'updater:check',
  'updater:download',
  'updater:install',
  'updater:progress'
]);

contextBridge.exposeInMainWorld('papercard', {
  /**
   * 触发白名单授权的 IPC 调用
   * @param {string} channel 通道名称
   * @param {object} [payload={}] 参数载荷
   * @returns {Promise<any>}
   */
  call(channel, payload = {}) {
    if (!AUTHORIZED_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`[PaperCard Security] 未授权的 IPC 通道访问: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },

  /**
   * 监听工作区状态变更事件
   * @param {Function} callback 状态更新回调函数
   * @returns {Function} 取消监听函数
   */
  onWorkspaceChanged(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, data) => {
      try {
        callback(data);
      } catch (err) {
        console.error('[PaperCard Renderer Event Error]', err);
      }
    };
    ipcRenderer.on('workspace:changed', listener);
    return () => ipcRenderer.removeListener('workspace:changed', listener);
  },

  /** 当前操作系统平台 */
  platform: process.platform,

  /** 桌面端环境标记 */
  isDesktop: true,

  /** 是否处于自动化场景/测试验证模式 */
  automated: process.argv.includes('--papercard-automated')
});

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 检查在线更新 (GitHub Releases)
   * @param {object} [options]
   * @returns {Promise<{ ok: boolean, hasUpdate: boolean, currentVersion: string, latestVersion: string, releaseNotes: string, downloadUrl: string | null, assets: Array<object> }>}
   */
  checkUpdate(options = {}) {
    return ipcRenderer.invoke('updater:check', options);
  },

  /**
   * 下载更新包到本地系统临时目录
   * @param {string|object} url 下载地址或配置对象
   * @param {object} [options]
   * @returns {Promise<{ ok: boolean, filePath: string, fileName: string, fileSize: number }>}
   */
  downloadUpdate(url, options = {}) {
    const payload = typeof url === 'object' && url !== null ? url : { url, ...options };
    return ipcRenderer.invoke('updater:download', payload);
  },

  /**
   * 触发更新安装
   * @param {string|object} filePath 安装包本地文件路径
   * @param {object} [options]
   * @returns {Promise<{ ok: boolean, launched: boolean, message: string }>}
   */
  installUpdate(filePath, options = {}) {
    const payload = typeof filePath === 'object' && filePath !== null ? filePath : { filePath, ...options };
    return ipcRenderer.invoke('updater:install', payload);
  },

  /**
   * 监听更新包下载进度
   * @param {Function} callback 进度回调 ({ percent, transferred, total, speed, fileName })
   * @returns {Function} 取消监听函数
   */
  onUpdateProgress(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, data) => {
      try {
        callback(data);
      } catch (err) {
        console.error('[Updater Renderer Progress Error]', err);
      }
    };
    ipcRenderer.on('updater:progress', listener);
    return () => ipcRenderer.removeListener('updater:progress', listener);
  }
});

