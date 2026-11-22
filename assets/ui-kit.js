/* ui-kit.js 20261121b — 跨站通用 UI 增强（同步自 _shared/ui-kit/ui-kit.js）
   由页面 <script data-uikit="..."> 配置启用的能力；默认全开。
   能力：top 返回顶部 / share 分享 / notif 跨站未读红点 / lazy 图片懒加载
        keys Ctrl+/ 快捷键帮助 / skeleton 加载中骨架 / sw Service Worker 注册
   约束：图标一律内联 SVG（不用 emoji）；所有元素带 uikit- 前缀避免与站点样式冲突。 */
(function () {
  'use strict';
  var cs = document.currentScript || (function () {
    var a = document.getElementsByTagName('script'); return a[a.length - 1];
  })();
  var cfg = (cs && cs.getAttribute('data-uikit')) || 'top,share,notif,lazy,keys,skeleton,sw';
  var on = function (k) { return (',' + cfg + ',').indexOf(',' + k + ',') >= 0; };
  var HOME = 'https://mc-creator-jerry-webpage.pages.dev';
  var NS = 'uikit-';

  /* ---------- 样式（自包含，不改各站 CSS） ---------- */
  function css() {
    if (document.getElementById(NS + 'style')) return;
    var s = document.createElement('style');
    s.id = NS + 'style';
    s.textContent =
      '.' + NS + 'dock{position:fixed;right:16px;bottom:16px;z-index:9998;display:flex;flex-direction:column;gap:8px;align-items:flex-end}' +
      '.' + NS + 'btn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(127,127,127,.35);background:rgba(255,255,255,.92);color:#222;border-radius:22px;padding:8px 12px;font:500 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 3px 14px rgba(0,0,0,.14);backdrop-filter:blur(6px)}' +
      '@media (prefers-color-scheme:dark){.' + NS + 'btn{background:rgba(32,34,40,.92);color:#eee;border-color:rgba(200,200,200,.25)}}' +
      '.' + NS + 'btn svg{width:16px;height:16px;flex:none}' +
      '.' + NS + 'btn[hidden]{display:none}' +
      '.' + NS + 'dot{display:inline-block;min-width:18px;height:18px;line-height:18px;text-align:center;border-radius:9px;background:#e0393e;color:#fff;font-size:11px;font-weight:700;padding:0 5px}' +
      '.' + NS + 'foot{display:inline-block;margin-left:10px;font-size:.88em;opacity:.9}' +
      '.' + NS + 'foot a{color:inherit;text-decoration:underline;text-underline-offset:2px}' +
      '.' + NS + 'modal{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px}' +
      '.' + NS + 'modal[hidden]{display:none}' +
      '.' + NS + 'box{background:#fff;color:#222;border-radius:14px;padding:22px 24px;max-width:420px;width:100%;box-shadow:0 18px 60px rgba(0,0,0,.3);font:14px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}' +
      '@media (prefers-color-scheme:dark){.' + NS + 'box{background:#22242a;color:#eee}}' +
      '.' + NS + 'box h3{margin:0 0 12px;font-size:17px}' +
      '.' + NS + 'box kbd{display:inline-block;min-width:52px;text-align:center;background:rgba(127,127,127,.16);border-radius:5px;padding:1px 6px;font-family:inherit;font-size:12px}' +
      '.' + NS + 'box div{margin:5px 0}' +
      '.' + NS + 'sk{display:block;height:14px;margin:8px 0;border-radius:6px;background:linear-gradient(90deg,rgba(127,127,127,.13) 25%,rgba(127,127,127,.26) 37%,rgba(127,127,127,.13) 63%);background-size:400% 100%;animation:' + NS + 'sh 1.3s ease infinite}' +
      '@keyframes ' + NS + 'sh{0%{background-position:100% 50%}100%{background-position:0 50%}}' +
      '.' + NS + 'sk:nth-child(2){width:82%}.' + NS + 'sk:nth-child(3){width:64%}' +
      '@media (max-width:600px){.' + NS + 'dock{right:10px;bottom:10px}}' +
      /* 顶栏通知铃铛（融入各站 topbar，纯铃铛图标 + 红角标，无文字） */
      '.' + NS + 'notif{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;border-radius:8px;position:relative;vertical-align:middle}' +
      '.' + NS + 'notif:hover{background:rgba(127,127,127,.14)}' +
      '.' + NS + 'notif svg{width:19px;height:19px;flex:none}' +
      '.' + NS + 'notif .' + NS + 'dot{position:absolute;top:-2px;right:-2px;min-width:16px;height:16px;line-height:16px;border-radius:9px;background:#e0393e;color:#fff;font-size:10px;font-weight:700;text-align:center;padding:0 3px;box-shadow:0 0 0 2px rgba(255,255,255,.85)}' +
      '@media (prefers-color-scheme:dark){.' + NS + 'notif .' + NS + 'dot{box-shadow:0 0 0 2px rgba(32,34,40,.9)}}' +
      '.' + NS + 'notif[hidden]{display:none}';
    document.head.appendChild(s);
  }

  var ICON = {
    top: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'
  };

  function btn(icon, text) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = NS + 'btn';
    b.innerHTML = ICON[icon] + '<span>' + text + '</span>';
    return b;
  }

  /* ---------- 顶栏通知铃铛 ----------
     学小蓝页：铃铛放在顶栏、仅图标+红点无文字。各站顶栏 class 不一，
     按优先级探测锚点容器；铃铛插在登录槽之前作为兄弟节点（不被登录渲染覆盖）。
     找不到锚点则回退到浮动 dock（保底，不让通知入口消失）。 */
  var ANCHORS = [
    '.tea-auth-slot',   // 茶馆：登录槽，铃铛插它前面
    '#bsAuthBox',       // 书栈
    '#authArea',        // 日历
    '#hdrRight',        // 片屿、音乐、启动台：登录槽
    '#loginBtn',        // 通用兜底（小蓝页等）
    '.bar-right > a:last-child' // 最后兜底
  ];
  function mountTopNotif(node) {
    for (var i = 0; i < ANCHORS.length; i++) {
      var ref = document.querySelector(ANCHORS[i]);
      if (ref && ref.parentNode && ref.parentNode !== document.body) {
        ref.parentNode.insertBefore(node, ref);
        return true;
      }
    }
    return false;
  }
  function topbarNotif() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = NS + 'notif';
    b.innerHTML = ICON.bell;
    b.title = '查看本站通知';
    b.setAttribute('aria-label', '查看通知');
    b.addEventListener('click', function () { location.href = '/notice/'; });
    return b;
  }

  /* ---------- 浮动按钮组 ---------- */
  function dock() {
    var need = on('top') || on('share');
    if (!need) return null;
    var d = document.createElement('div');
    d.className = NS + 'dock';

    if (on('share') && !document.querySelector('#shareBtn,#shareFab,#pbCopyLink,[data-share]')) {
      var sh = btn('share', '分享');
      sh.title = '分享本页'; sh.setAttribute('aria-label', '分享本页');
      sh.addEventListener('click', function () {
        var data = { title: document.title, text: document.title, url: location.href };
        if (navigator.share) navigator.share(data).catch(function () {});
        else if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { sh.querySelector('span').textContent = '已复制'; setTimeout(function () { sh.querySelector('span').textContent = '分享'; }, 1200); }).catch(function () {});
        else prompt('复制本页链接：', location.href);
      });
      d.appendChild(sh);
    }
    if (on('top') && !document.getElementById('toTopBtn')) {
      var tp = btn('top', '顶部');
      tp.title = '回到顶部'; tp.setAttribute('aria-label', '回到顶部');
      tp.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
      var sync = function () { tp.hidden = (window.pageYOffset || document.documentElement.scrollTop || 0) < 400; };
      window.addEventListener('scroll', sync, { passive: true }); sync();
      d.appendChild(tp);
    }
    if (!d.children.length) return null;
    document.body.appendChild(d);
    return null;
  }

  /* ---------- 跨站未读红点 ---------- */
  function pickLogin(d) {
    if (!d || typeof d !== 'object') return '';
    var c = [d, d.user, d.data, d.profile, d.me, d.account, (d.user || {}).profile];
    for (var i = 0; i < c.length; i++) {
      var x = c[i];
      if (!x || typeof x !== 'object') continue;
      var v = x.login || x.username || x.name;
      if (v && typeof v === 'string' && !/^https?:/.test(v)) return v;
    }
    return '';
  }
  function globalsLogin() {
    try {
      if (window.PY && PY.user) return pickLogin({ user: PY.user }) || (PY.user.login || '');
      if (window.JM && JM.user) return pickLogin({ user: JM.user });
      if (window.JL && JL.user) return pickLogin({ user: JL.user });
      if (window.TeaAuth && TeaAuth.state && TeaAuth.state.user) return pickLogin({ user: TeaAuth.state.user });
      if (window.BS && BS.user) return pickLogin({ user: BS.user });
    } catch (e) {}
    return '';
  }
  function loadUnread(node, text) {
    if (!node) return;
    // 本站通知未读数（本站 /api/notif 代理只返回本站通知；小蓝页 /notice/ 才混合全部）。
    fetch('/api/notif', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var n = d && d.unread ? Number(d.unread) : 0;
        if (n <= 0) return;
        node.hidden = false;
        node.innerHTML = ICON.bell + (text ? '<span>消息</span>' : '') + '<span class="' + NS + 'dot">' + (n > 99 ? '99+' : n) + '</span>';
      }).catch(function () {});
  }

  /* ---------- 图片懒加载 ---------- */
  function lazy() {
    var imgs = document.querySelectorAll('img:not([loading]):not([data-nolazy])');
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].getAttribute('fetchpriority') === 'high') continue;
      imgs[i].setAttribute('loading', 'lazy');
      imgs[i].setAttribute('decoding', 'async');
    }
  }

  /* ---------- 「加载中…」文字 → 骨架屏 ---------- */
  function skeleton() {
    var re = /^(加载中|载入中|正在加载|Loading)(\.{2,3}|…)?$/i;
    var all = document.querySelectorAll('div,section,p');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length || el.className.indexOf(NS) >= 0) continue;
      var t = (el.textContent || '').trim();
      if (!re.test(t)) continue;
      el.textContent = '';
      for (var j = 0; j < 3; j++) {
        var b = document.createElement('span'); b.className = NS + 'sk'; el.appendChild(b);
      }
    }
  }

  /* ---------- Ctrl+/ 快捷键帮助 ---------- */
  function keys() {
    var m = document.createElement('div');
    m.className = NS + 'modal'; m.hidden = true;
    m.innerHTML = '<div class="' + NS + 'box" role="dialog" aria-modal="true" aria-label="快捷键帮助">' +
      '<h3>键盘快捷键</h3>' +
      '<div><kbd>Ctrl</kbd> + <kbd>/</kbd> 打开 / 关闭本帮助</div>' +
      '<div><kbd>Home</kbd> 回到页首　<kbd>End</kbd> 跳到页尾</div>' +
      '<div><kbd>Alt</kbd> + <kbd>←</kbd> / <kbd>→</kbd> 左右滚动（部分页面）</div>' +
      '<div><kbd>Esc</kbd> 关闭弹窗</div>' +
      '<div style="margin-top:14px;opacity:.7">按任意处关闭</div></div>';
    m.addEventListener('click', function () { m.hidden = true; });
    document.body.appendChild(m);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { m.hidden = true; return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.key === '?')) {
        e.preventDefault(); m.hidden = !m.hidden;
      }
    });
  }

  /* ---------- Service Worker 注册 ---------- */
  function sw() {
    if (!('serviceWorker' in navigator) || !cs || !cs.src) return;
    try {
      var swUrl = new URL('../sw.js', cs.src).href;
      var scope = new URL('../', cs.src).pathname;
      navigator.serviceWorker.register(swUrl, { scope: scope, updateViaCache: 'none' }).catch(function () {});
    } catch (e) {}
  }

  function boot() {
    css();
    var notifNode = null;
    if (on('notif')) {
      var nb = topbarNotif();
      if (mountTopNotif(nb)) {
        notifNode = nb; // 顶栏铃铛常显，红点由未读决定
      } else {
        // 找不到顶栏锚点 → 回退浮动（保底，不丢通知入口）
        var d = document.createElement('div');
        d.className = NS + 'dock';
        var fb = btn('bell', '消息');
        fb.hidden = true;
        fb.title = '查看本站通知';
        fb.setAttribute('aria-label', '查看通知');
        fb.addEventListener('click', function () { location.href = '/notice/'; });
        d.appendChild(fb);
        document.body.appendChild(d);
        notifNode = fb;
      }
      loadUnread(notifNode, notifNode !== nb); // 顶栏=纯铃铛+红点；浮动=带文字
    }
    dock();
    if (on('lazy')) lazy();
    if (on('skeleton')) skeleton();
    if (on('keys')) keys();
    if (on('sw')) sw();
    window.UIKit = { skeleton: skeleton, lazy: lazy };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
