/* ============================================================
 *  news-filter.js — 每日要闻页：关键词搜索 + 分类筛选
 *  纯前端、零依赖；由 template.html / 已生成每日页在 </body> 前引入。
 *  只操作 .item / .section-card 的 display 与 .section-body 的 open 类，
 *  不改动原有折叠、朗读、全屏等逻辑；清除后恢复原始展开状态。
 *  支持 URL ?q=关键词（首页搜索框跳转过来时自动应用）。
 * ============================================================ */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.section-card'));
    var items = Array.prototype.slice.call(document.querySelectorAll('.item'));
    if (!cards.length || !items.length) return;   // 不是每日要闻页
    if (document.getElementById('nfInput')) return; // 防重复加载

    var lang = 'zh';
    try { lang = localStorage.getItem('wb_lang') === 'en' ? 'en' : 'zh'; } catch (e) {}
    var T = lang === 'en'
      ? { ph: 'Search today\u2019s news (title / body / source)\u2026', all: 'All', clear: 'Clear',
          count: 'Showing %a / %t items', none: 'No matching news.' }
      : { ph: '\u641c\u7d22\u4eca\u65e5\u8981\u95fb\uff08\u6807\u9898 / \u6b63\u6587 / \u6765\u6e90\uff09\u2026', all: '\u5168\u90e8', clear: '\u6e05\u9664',
          count: '\u663e\u793a %a / %t \u6761', none: '\u6ca1\u6709\u5339\u914d\u7684\u8981\u95fb\u3002' };

    /* ---------- 样式（inline style 由 CSP style-src 'unsafe-inline' 允许） ---------- */
    var st = document.createElement('style');
    st.textContent = [
      '.nf-bar{position:relative;z-index:5;max-width:760px;margin:18px auto 6px;padding:14px 16px;',
      'border-radius:16px;background:rgba(255,255,255,.82);backdrop-filter:blur(14px);',
      '-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.6);',
      'box-shadow:0 6px 24px rgba(0,0,0,.10);color:#1a1a2e;font-family:inherit;}',
      '@media (prefers-color-scheme:dark){.nf-bar{background:rgba(26,29,39,.86);',
      'border-color:rgba(255,255,255,.10);color:#e5e7eb;box-shadow:0 6px 24px rgba(0,0,0,.35);}}',
      '.nf-row{display:flex;align-items:center;gap:10px;}',
      '.nf-ico{width:18px;height:18px;flex:none;opacity:.6;}',
      '.nf-input{flex:1 1 auto;min-width:0;border:none;outline:none;background:transparent;',
      'color:inherit;font:inherit;font-size:15px;padding:6px 2px;}',
      '.nf-input::placeholder{opacity:.6;}',
      '.nf-clear{flex:none;border:1px solid rgba(127,127,127,.35);background:transparent;',
      'color:inherit;border-radius:9px;padding:5px 11px;font:inherit;font-size:13px;cursor:pointer;}',
      '.nf-clear:hover{border-color:#4f6ef7;color:#4f6ef7;}',
      '.nf-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px;}',
      '.nf-chip{border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;',
      'border-radius:999px;padding:4px 12px;font:inherit;font-size:12.5px;cursor:pointer;',
      'transition:background .18s,border-color .18s,color .18s;}',
      '.nf-chip:hover{border-color:#4f6ef7;}',
      '.nf-chip.on{background:#4f6ef7;border-color:#4f6ef7;color:#fff;}',
      '.nf-count{margin-top:9px;font-size:12.5px;opacity:.65;}',
      '.nf-count.none{opacity:1;color:#d9534f;font-weight:600;}',
      '@media(max-width:520px){.nf-bar{margin:12px 10px 4px;padding:12px;}}'
    ].join('');
    document.head.appendChild(st);

    /* ---------- 缓存文本 / 分类名 ----------
       不记录「原始展开状态」：每日页自身脚本会在 DOMContentLoaded 时初始化分区，
       提前快照会拿到错误状态。改为只标记本脚本临时加的 open，清除时只撤自己的。 */
    cards.forEach(function (card, i) {
      card.setAttribute('data-nf-idx', String(i));
      var t = card.querySelector('.section-title');
      if (t) {
        var zh = t.getAttribute('data-zh'), en = t.getAttribute('data-en');
        var label = (lang === 'en' ? (en || zh) : (zh || en)) || t.textContent || '';
        card.setAttribute('data-nf-label', String(label).replace(/\s+/g, ' ').trim());
      }
    });
    items.forEach(function (it) {
      it.setAttribute('data-nf-text', (it.textContent || '').toLowerCase());
    });

    /* ---------- 工具条 ---------- */
    var bar = document.createElement('div');
    bar.className = 'nf-bar';
    bar.innerHTML =
      '<div class="nf-row">' +
        '<svg class="nf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
        '<input id="nfInput" class="nf-input" type="search" autocomplete="off" spellcheck="false" aria-label="' + T.ph + '">' +
        '<button id="nfClear" class="nf-clear" type="button" style="display:none">' + T.clear + '</button>' +
      '</div>' +
      '<div class="nf-chips" id="nfChips"></div>' +
      '<div class="nf-count" id="nfCount"></div>';

    var anchor = document.getElementById('titlebar');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);

    var input = bar.querySelector('#nfInput');
    var clearBtn = bar.querySelector('#nfClear');
    var chipsBox = bar.querySelector('#nfChips');
    var countEl = bar.querySelector('#nfCount');
    input.placeholder = T.ph;

    /* ---------- 分类 chips ---------- */
    var state = { cat: '' };
    var chipDefs = [{ idx: '', label: T.all }];
    cards.forEach(function (card) {
      var label = card.getAttribute('data-nf-label');
      if (label) chipDefs.push({ idx: card.getAttribute('data-nf-idx'), label: label });
    });
    chipDefs.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'nf-chip' + (d.idx === '' ? ' on' : '');
      b.textContent = d.label;
      b.setAttribute('data-nf-cat', d.idx);
      b.addEventListener('click', function () {
        state.cat = d.idx;
        Array.prototype.forEach.call(chipsBox.querySelectorAll('.nf-chip'), function (x) {
          x.classList.toggle('on', x.getAttribute('data-nf-cat') === state.cat);
        });
        apply();
      });
      chipsBox.appendChild(b);
    });

    /* ---------- 过滤 ---------- */
    function apply() {
      var q = input.value.trim().toLowerCase();
      var filtering = !!q || state.cat !== '';
      var visible = 0;
      cards.forEach(function (card) {
        var catOk = (state.cat === '' || state.cat === card.getAttribute('data-nf-idx'));
        var its = card.querySelectorAll('.item');
        var n = 0;
        Array.prototype.forEach.call(its, function (it) {
          var ok = catOk && (!q || (it.getAttribute('data-nf-text') || '').indexOf(q) >= 0);
          it.style.display = ok ? '' : 'none';
          if (ok) n++;
        });
        card.style.display = (n > 0 || !filtering) ? '' : 'none';
        visible += n;
        var body = card.querySelector('.section-body');
        if (body) {
          if (filtering && n > 0) {
            // 仅在本脚本「新加」open 时打标，避免影响页面原本的展开状态
            if (!body.classList.contains('open')) {
              body.classList.add('open');
              body.setAttribute('data-nf-forced', '1');
            }
          } else if (body.getAttribute('data-nf-forced') === '1') {
            body.classList.remove('open');
            body.removeAttribute('data-nf-forced');
          }
        }
      });
      clearBtn.style.display = filtering ? '' : 'none';
      countEl.classList.toggle('none', filtering && visible === 0);
      countEl.textContent = (filtering && visible === 0)
        ? T.none
        : T.count.replace('%a', String(visible)).replace('%t', String(items.length));
    }

    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(apply, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; state.cat = ''; resetChips(); apply(); }
    });
    clearBtn.addEventListener('click', function () {
      input.value = '';
      state.cat = '';
      resetChips();
      apply();
      try {
        if (window.history && history.replaceState) {
          var u = new URL(location.href); u.searchParams.delete('q');
          history.replaceState(null, '', u.toString());
        }
      } catch (e) {}
      input.focus();
    });
    function resetChips() {
      Array.prototype.forEach.call(chipsBox.querySelectorAll('.nf-chip'), function (x) {
        x.classList.toggle('on', x.getAttribute('data-nf-cat') === '');
      });
    }

    /* ---------- 来源透明：点出处即可按该来源筛选 ---------- */
    var srcSt = document.createElement('style');
    srcSt.textContent = '.item-source[data-nf-src]{cursor:pointer;display:inline-block;' +
      'border-bottom:1px dashed rgba(127,127,127,.55)}' +
      '.item-source[data-nf-src]:hover{color:#4f6ef7;border-bottom-color:#4f6ef7}';
    document.head.appendChild(srcSt);
    items.forEach(function (it) {
      var s = it.querySelector('.item-source');
      if (!s) return;
      s.setAttribute('data-nf-src', '1');
      s.title = lang === 'en' ? 'Click to filter by this source' : '点击按此来源筛选';
      s.addEventListener('click', function (e) {
        e.stopPropagation();
        var raw = (s.textContent || '').replace(/^\s*(出处|Source)\s*[:：]\s*/i, '').trim();
        var first = raw.split(/[、,，\/|；;]/)[0].trim();
        if (!first) return;
        state.cat = '';
        resetChips();
        input.value = first;
        apply();
        var b = document.querySelector('.nf-bar');
        if (b && b.scrollIntoView) b.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    /* ---------- 初始化：支持首页带 ?q= 跳入 ---------- */
    var q0 = '';
    try { q0 = new URLSearchParams(location.search).get('q') || ''; } catch (e) {}
    if (q0) input.value = q0;
    apply();
  });
})();
