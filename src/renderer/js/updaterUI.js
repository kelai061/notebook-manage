'use strict';
/**
 * updaterUI.js — 客户端更新前端渲染与状态机控制器
 *
 * 核心交互：
 * 1. 顶栏按钮与更新徽标联动 (#checkUpdateBtn, #updateBadge)
 * 2. 沉浸式模态弹窗 (#updaterModal)
 * 3. 六大状态自洽流转：
 *    - checking (检查中)
 *    - latest (已是最新: "当前已是最新版本 (v1.0.0)")
 *    - available (发现新版本、Release Notes 渲染)
 *    - downloading (真实下载进度条、百分比、速率)
 *    - ready (下载完成，提供「立即安装并重启」按钮)
 *    - error (网络异常或解析失败提示与重试)
 */

class UpdaterUIController {
  constructor(options = {}) {
    this.options = options;
    this.currentInfo = null;
    this.downloadedFilePath = null;
    this.currentState = 'idle';
    this.unsubscribeProgress = null;

    if (options.deferInit !== true && typeof document !== 'undefined') {
      this.initElements();
      this.bindEvents();
    }
  }

  get api() {
    return window.electronAPI || window.PaperCardAPI || null;
  }

  $(id) {
    if (typeof document === 'undefined') return null;
    return document.getElementById(id);
  }

  initElements() {
    this.checkUpdateBtn = this.$('checkUpdateBtn');
    this.updateBadge = this.$('updateBadge');
    this.updaterModal = this.$('updaterModal');
    this.closeUpdaterBtn = this.$('closeUpdaterBtn');
    this.updaterCancelBtn = this.$('updaterCancelBtn');
    this.updaterActionBtn = this.$('updaterActionBtn');
    this.updaterInstallBtn = this.$('updaterInstallBtn');

    this.stateChecking = this.$('updaterStateChecking');
    this.stateLatest = this.$('updaterStateLatest');
    this.stateAvailable = this.$('updaterStateAvailable');
    this.stateDownloading = this.$('updaterStateDownloading');
    this.stateReady = this.$('updaterStateReady');
    this.stateError = this.$('updaterStateError');

    this.currentVerTag = this.$('updaterCurrentVerTag');
    this.latestHeadline = this.$('updaterLatestHeadline');
    this.latestDesc = this.$('updaterLatestDesc');
    this.newVersion = this.$('updaterNewVersion');
    this.releaseNotes = this.$('updaterReleaseNotes');
    this.downloadPercent = this.$('updaterDownloadPercent');
    this.progressBar = this.$('updaterProgressBar');
    this.downloadMeta = this.$('updaterDownloadMeta');
    this.errorMessage = this.$('updaterErrorMessage');
  }

  bindEvents() {
    if (this.checkUpdateBtn) {
      this.checkUpdateBtn.addEventListener('click', () => {
        this.openAndCheck();
      });
    }

    if (this.closeUpdaterBtn) {
      this.closeUpdaterBtn.addEventListener('click', () => {
        this.closeModal();
      });
    }

    if (this.updaterCancelBtn) {
      this.updaterCancelBtn.addEventListener('click', () => {
        this.closeModal();
      });
    }

    if (this.updaterActionBtn) {
      this.updaterActionBtn.addEventListener('click', () => {
        if (this.currentState === 'available') {
          this.startDownload();
        } else if (this.currentState === 'error') {
          this.openAndCheck();
        }
      });
    }

    if (this.updaterInstallBtn) {
      this.updaterInstallBtn.addEventListener('click', () => {
        this.triggerInstall();
      });
    }

    // 监听原生进度广播
    if (this.api && typeof this.api.onUpdateProgress === 'function') {
      this.unsubscribeProgress = this.api.onUpdateProgress((progress) => {
        this.handleProgressUpdate(progress);
      });
    }
  }

  switchState(state, data = {}) {
    this.currentState = state;

    const allStates = [
      this.stateChecking,
      this.stateLatest,
      this.stateAvailable,
      this.stateDownloading,
      this.stateReady,
      this.stateError
    ];

    allStates.forEach((el) => {
      if (el) el.hidden = true;
    });

    if (this.updaterActionBtn) this.updaterActionBtn.hidden = true;
    if (this.updaterInstallBtn) this.updaterInstallBtn.hidden = true;
    if (this.updaterCancelBtn) {
      this.updaterCancelBtn.hidden = false;
      this.updaterCancelBtn.textContent = '关闭';
    }

    switch (state) {
      case 'checking':
        if (this.stateChecking) this.stateChecking.hidden = false;
        break;

      case 'latest':
        if (this.stateLatest) this.stateLatest.hidden = false;
        if (this.latestHeadline) {
          const ver = data.currentVersion || '1.0.0';
          this.latestHeadline.textContent = `当前已是最新版本 (v${ver})`;
        }
        if (this.latestDesc) {
          this.latestDesc.textContent = data.message || '已是最新版本，无需更新。';
        }
        break;

      case 'available':
        if (this.stateAvailable) this.stateAvailable.hidden = false;
        if (this.newVersion) {
          this.newVersion.textContent = `v${data.latestVersion || ''}`;
        }
        if (this.releaseNotes) {
          this.releaseNotes.textContent = data.releaseNotes || '无更新日志说明';
        }
        if (this.updaterActionBtn) {
          this.updaterActionBtn.hidden = false;
          this.updaterActionBtn.textContent = '立即下载更新';
        }
        if (this.updaterCancelBtn) {
          this.updaterCancelBtn.textContent = '暂不更新';
        }
        break;

      case 'downloading':
        if (this.stateDownloading) this.stateDownloading.hidden = false;
        if (this.progressBar) this.progressBar.style.width = '0%';
        if (this.downloadPercent) this.downloadPercent.textContent = '0%';
        if (this.downloadMeta) this.downloadMeta.textContent = '准备建立连接...';
        if (this.updaterCancelBtn) this.updaterCancelBtn.hidden = true; // 下载期间禁止随意关闭
        break;

      case 'ready':
        if (this.stateReady) this.stateReady.hidden = false;
        if (this.updaterInstallBtn) {
          this.updaterInstallBtn.hidden = false;
          this.updaterInstallBtn.textContent = '立即安装并重启';
        }
        if (this.updaterCancelBtn) {
          this.updaterCancelBtn.hidden = false;
          this.updaterCancelBtn.textContent = '稍后安装';
        }
        break;

      case 'error':
        if (this.stateError) this.stateError.hidden = false;
        if (this.errorMessage) {
          this.errorMessage.textContent = data.error || data.message || '检查更新失败，请检查网络连接后重试';
        }
        if (this.updaterActionBtn) {
          this.updaterActionBtn.hidden = false;
          this.updaterActionBtn.textContent = '重新检查';
        }
        break;

      default:
        break;
    }
  }

  openModal() {
    if (this.updaterModal && !this.updaterModal.open) {
      try {
        this.updaterModal.showModal();
      } catch {
        this.updaterModal.setAttribute('open', '');
      }
    }
  }

  closeModal() {
    if (this.updaterModal && this.updaterModal.open) {
      try {
        this.updaterModal.close();
      } catch {
        this.updaterModal.removeAttribute('open');
      }
    }
  }

  async openAndCheck(options = {}) {
    this.openModal();
    this.switchState('checking');

    try {
      if (!this.api) {
        throw new Error('未检测到更新通信接口 (API 未初始化)');
      }

      const res = await this.api.checkUpdate(options);

      if (res && res.ok === false) {
        throw new Error(res.error || '检查更新未成功');
      }

      this.currentInfo = res;

      if (this.currentVerTag && res.currentVersion) {
        this.currentVerTag.textContent = `v${res.currentVersion}`;
      }

      if (res.hasUpdate) {
        if (this.updateBadge) this.updateBadge.hidden = false;
        this.switchState('available', res);
      } else {
        if (this.updateBadge) this.updateBadge.hidden = true;
        this.switchState('latest', res);
      }
    } catch (err) {
      console.error('[UpdaterUI] 检查更新失败:', err);
      this.switchState('error', { error: err.message });
    }
  }

  handleProgressUpdate(progress) {
    if (this.currentState !== 'downloading') return;
    if (!progress) return;

    const percent = Math.min(100, Math.max(0, Math.round(progress.percent || 0)));

    if (this.progressBar) {
      this.progressBar.style.width = `${percent}%`;
    }
    if (this.downloadPercent) {
      this.downloadPercent.textContent = `${percent}%`;
    }

    if (this.downloadMeta) {
      const transMB = ((progress.transferred || 0) / (1024 * 1024)).toFixed(1);
      const totalMB = ((progress.total || 0) / (1024 * 1024)).toFixed(1);
      const speedMB = ((progress.speed || 0) / (1024 * 1024)).toFixed(1);

      if (progress.total > 0) {
        this.downloadMeta.textContent = `${transMB} MB / ${totalMB} MB · ${speedMB} MB/s`;
      } else {
        this.downloadMeta.textContent = `已下载 ${transMB} MB · ${speedMB} MB/s`;
      }
    }
  }

  async startDownload() {
    if (!this.currentInfo || !this.currentInfo.downloadUrl) {
      this.switchState('error', { error: '未找到可供下载的安装包资源' });
      return;
    }

    this.switchState('downloading');

    try {
      const res = await this.api.downloadUpdate(this.currentInfo.downloadUrl);

      if (res && res.ok === false) {
        throw new Error(res.error || '下载更新包失败');
      }

      this.downloadedFilePath = res.filePath;
      this.switchState('ready', res);
    } catch (err) {
      console.error('[UpdaterUI] 下载更新包异常:', err);
      this.switchState('error', { error: `下载更新失败: ${err.message}` });
    }
  }

  async triggerInstall() {
    if (!this.downloadedFilePath) {
      this.switchState('error', { error: '缺少已下载的安装包文件' });
      return;
    }

    try {
      const res = await this.api.installUpdate(this.downloadedFilePath);
      if (res && res.ok === false) {
        throw new Error(res.error || '拉起安装程序失败');
      }
    } catch (err) {
      console.error('[UpdaterUI] 运行更新安装失败:', err);
      this.switchState('error', { error: `安装失败: ${err.message}` });
    }
  }
}

// 自动初始化与导出
let updaterInstance = null;

function initUpdaterUI(options) {
  if (!updaterInstance && typeof document !== 'undefined') {
    updaterInstance = new UpdaterUIController(options);
  }
  return updaterInstance;
}

if (typeof window !== 'undefined') {
  window.UpdaterUI = UpdaterUIController;
  window.initUpdaterUI = initUpdaterUI;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UpdaterUIController,
    initUpdaterUI
  };
}
