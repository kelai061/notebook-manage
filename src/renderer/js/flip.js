'use strict';
/**
 * flip.js — FLIP (First, Last, Invert, Play) 平滑视图过渡动效
 * 
 * 用于在「原纸排版对照」↔「题解与学科卡片」↔「自由画布重排」三大视图之间无缝过渡目标卡片。
 */

/**
 * 获取元素在视口中的绝对坐标与尺寸
 * @param {HTMLElement} el 
 * @returns {{ left: number, top: number, width: number, height: number } | null}
 */
export function getElementRect(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height
  };
}

/**
 * 对目标元素应用 FLIP 反转与播放过渡
 * @param {{ left: number, top: number, width: number, height: number }} firstRect 起始位置
 * @param {HTMLElement} targetEl 目标元素
 * @param {Object} [options]
 * @param {number} [options.duration=320] 毫秒
 * @param {string} [options.easing='cubic-bezier(0.16, 1, 0.3, 1)']
 * @returns {Promise<void>}
 */
export function playFlip(firstRect, targetEl, options = {}) {
  return new Promise((resolve) => {
    if (!firstRect || !targetEl || typeof targetEl.getBoundingClientRect !== 'function') {
      resolve();
      return;
    }

    const duration = options.duration || 320;
    const easing = options.easing || 'cubic-bezier(0.16, 1, 0.3, 1)';

    const lastRect = targetEl.getBoundingClientRect();
    if (!lastRect.width || !lastRect.height) {
      resolve();
      return;
    }

    const deltaX = firstRect.left - lastRect.left;
    const deltaY = firstRect.top - lastRect.top;
    const scaleX = firstRect.width / Math.max(1, lastRect.width);
    const scaleY = firstRect.height / Math.max(1, lastRect.height);

    // Invert: 强制将元素倒放回起始状态
    targetEl.style.transformOrigin = 'top left';
    targetEl.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`;
    targetEl.style.transition = 'none';

    // 强制回流
    void targetEl.offsetHeight;

    // Play: 播放平滑过渡回到当前位置
    targetEl.style.transition = `transform ${duration}ms ${easing}, box-shadow ${duration}ms ease`;
    targetEl.style.transform = 'translate3d(0, 0, 0) scale(1, 1)';
    targetEl.classList.add('flip-animating');

    setTimeout(() => {
      targetEl.style.transformOrigin = '';
      targetEl.style.transform = '';
      targetEl.style.transition = '';
      targetEl.classList.remove('flip-animating');
      resolve();
    }, duration + 30);
  });
}

export default {
  getElementRect,
  playFlip
};
