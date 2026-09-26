/*
 * scroll-keys.js — 键盘上下键滚动增强（全站通用）
 * 行为：
 *   ↑ 单击    → 向上平滑滚动约一屏（视口高 90%）
 *   ↓ 单击    → 向下平滑滚动约一屏
 *   ↑ 双击    → 平滑滚动到页面顶部
 *   ↓ 双击    → 平滑滚动到页面底部
 * 兼容：
 *   - 输入框 / 文本域 / 下拉 / contenteditable 内不拦截（正常输入与光标移动）
 *   - 按住 Ctrl / Cmd / Alt 时不拦截（保留浏览器原组合键）
 *   - 系统开启“减少动态效果”时改用瞬时滚动
 *   - 布局编辑态（body.no-keyscroll / body[data-no-keyscroll]）下禁用，避免与编辑器冲突
 */
(function () {
  'use strict';
  var STEP_RATIO = 0.9;            // 单次滚动步长 = 视口高度比例
  var DBL_MS = 300;                // 双击判定窗口（毫秒）
  var lastUp = 0, lastDown = 0;

  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function isTyping(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (t.isContentEditable) return true;
    return false;
  }

  function disabled() {
    var b = document.body;
    if (!b) return false;
    if (b.classList.contains('no-keyscroll')) return true;
    if (b.getAttribute('data-no-keyscroll') === '1') return true;
    return false;
  }

  function smoothTo(y) {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (y < 0) y = 0;
    if (y > max) y = max;
    window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function step(dir) {
    smoothTo(window.scrollY + dir * window.innerHeight * STEP_RATIO);
  }

  function onKey(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;   // 保留浏览器组合键
    if (isTyping(e.target)) return;                    // 输入框内正常输入
    if (disabled()) return;                            // 布局编辑态让位
    e.preventDefault();
    var now = Date.now();
    if (e.key === 'ArrowUp') {
      if (now - lastUp <= DBL_MS) {
        lastUp = 0;
        smoothTo(0);
      } else {
        lastUp = now;
        step(-1);
      }
    } else {
      if (now - lastDown <= DBL_MS) {
        lastDown = 0;
        smoothTo(document.documentElement.scrollHeight);
      } else {
        lastDown = now;
        step(1);
      }
    }
  }

  window.addEventListener('keydown', onKey, false);
})();
