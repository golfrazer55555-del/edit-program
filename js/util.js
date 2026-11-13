/* 싹둑 영상 편집기 — 공용 유틸리티, 상수, UI 도우미 */
(function () {
  'use strict';
  const VE = (window.VE = window.VE || {});
  const U = {};

  // ---------- 숫자·시간 ----------
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.uid = (p) => (p || 'x') + '_' + Math.random().toString(36).slice(2, 8) + (Date.now() % 1679616).toString(36);
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  U.clone = (o) => JSON.parse(JSON.stringify(o));
  U.even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const pad2 = (n) => String(n).padStart(2, '0');

  /** HH:MM:SS:FF 타임코드 */
  U.fmtTC = (sec, fps) => {
    fps = fps || 30;
    const total = Math.floor(Math.max(0, sec || 0) * fps + 1e-6);
    const f = total % fps;
    const s = Math.floor(total / fps);
    return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}:${pad2(f)}`;
  };
  /** 1:05 또는 1:02:03 */
  U.fmtClock = (sec) => {
    const s = Math.floor(Math.max(0, sec || 0) + 1e-6);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return h ? `${h}:${pad2(m % 60)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
  };
  /** 3.2초 */
  U.fmtSec = (sec) => (Math.round((sec || 0) * 10) / 10).toFixed(1) + '초';
  U.fmtBytes = (n) => {
    if (!(n >= 0)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  };
  U.debounce = (fn, ms) => {
    let t = 0;
    const d = function (...a) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, a), ms);
    };
    d.flush = () => {
      clearTimeout(t);
      fn();
    };
    return d;
  };
  U.easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
  U.easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  U.easeOutBack = (x) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };

  // ---------- 색 ----------
  U.hexToRgb = (hex) => {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    if (h.length !== 6 || isNaN(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  U.rgba = (hex, a) => {
    const [r, g, b] = U.hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  };
  U.roundRect = (ctx, x, y, w, h, r) => {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  /** 키 입력이 글자 입력 중인지(단축키를 무시해야 하는지) */
  U.isTyping = (e) => {
    const t = e.target;
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const ty = (t.type || 'text').toLowerCase();
      if (['checkbox', 'radio', 'button', 'submit', 'color', 'file'].includes(ty)) return false;
      if (ty === 'range') return /^(Arrow|Home|End|Page)/.test(e.key);
      return true;
    }
    return false;
  };

  // ---------- 이벤트 ----------
  class Emitter {
    constructor() {
      this._h = {};
    }
    on(ev, fn) {
      (this._h[ev] || (this._h[ev] = [])).push(fn);
      return () => this.off(ev, fn);
    }
    off(ev, fn) {
      const a = this._h[ev];
      if (!a) return;
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    }
    once(ev, fn) {
      const off = this.on(ev, (...args) => {
        off();
        fn(...args);
      });
      return off;
    }
    emit(ev, ...args) {
      const a = this._h[ev];
      if (!a) return;
      for (const fn of a.slice()) {
        try {
          fn(...args);
        } catch (err) {
          console.error(err);
        }
      }
    }
  }
  U.Emitter = Emitter;

  // ---------- DOM ----------
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => append(el, x));
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  /** h('div', {class:'a', onclick: fn}, [children]) */
  U.h = function (tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    append(el, children);
    return el;
  };

  // ---------- 아이콘 (24×24, 선 기반) ----------
  const F = 'fill="currentColor" stroke="none"';
  const ICONS = {
    play: `<path ${F} d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z"/>`,
    pause: `<rect ${F} x="6" y="5" width="4.2" height="14" rx="1.2"/><rect ${F} x="13.8" y="5" width="4.2" height="14" rx="1.2"/>`,
    skipStart: `<path d="M6 5v14"/><path ${F} d="M18.5 5.8v12.4a.7.7 0 0 1-1.1.6L9 12.6a.7.7 0 0 1 0-1.2l8.4-6.2a.7.7 0 0 1 1.1.6z"/>`,
    skipEnd: `<path d="M18 5v14"/><path ${F} d="M5.5 5.8v12.4a.7.7 0 0 0 1.1.6l8.4-6.2a.7.7 0 0 0 0-1.2L6.6 5.2a.7.7 0 0 0-1.1.6z"/>`,
    framePrev: `<path d="M14.5 6l-6 6 6 6"/>`,
    frameNext: `<path d="M9.5 6l6 6-6 6"/>`,
    undo: `<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`,
    redo: `<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>`,
    scissors: `<circle cx="6" cy="6.5" r="2.8"/><circle cx="6" cy="17.5" r="2.8"/><path d="M8.2 8.2L20 19M8.2 15.8L20 5"/>`,
    trash: `<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4.5h6V7"/>`,
    copy: `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h.5"/>`,
    magnet: `<path d="M5 4h4v7a3 3 0 0 0 6 0V4h4v7a7 7 0 0 1-14 0z"/><path d="M5 8h4M15 8h4"/>`,
    plus: `<path d="M12 5v14M5 12h14"/>`,
    minus: `<path d="M5 12h14"/>`,
    fit: `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`,
    volume: `<path ${F} d="M4 9.2v5.6c0 .4.3.7.7.7H8l4.6 3.8c.5.4 1.2 0 1.2-.6V5.3c0-.6-.7-1-1.2-.6L8 8.5H4.7c-.4 0-.7.3-.7.7z"/><path d="M17 9.2a4 4 0 0 1 0 5.6"/><path d="M19.4 6.6a7.6 7.6 0 0 1 0 10.8"/>`,
    mute: `<path ${F} d="M4 9.2v5.6c0 .4.3.7.7.7H8l4.6 3.8c.5.4 1.2 0 1.2-.6V5.3c0-.6-.7-1-1.2-.6L8 8.5H4.7c-.4 0-.7.3-.7.7z"/><path d="M17 9.5l4.5 5M21.5 9.5L17 14.5"/>`,
    safe: `<rect x="3" y="5" width="18" height="14" rx="1.5"/><rect x="6.5" y="8" width="11" height="8" rx=".5" stroke-dasharray="2 2"/>`,
    help: `<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6"/><path d="M12 17.2v.1"/>`,
    film: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>`,
    image: `<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="M21 15.5l-5-5L6 20"/>`,
    music: `<path d="M9 18V5.5l11-2v12.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>`,
    text: `<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>`,
    close: `<path d="M6 6l12 12M18 6L6 18"/>`,
    download: `<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>`,
    upload: `<path d="M12 16V5"/><path d="M7.5 9.5L12 5l4.5 4.5"/><path d="M5 19.5h14"/>`,
    fileNew: `<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/><path d="M12 11.5v6M9 14.5h6"/>`,
    subtitle: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h3.5M13 15h4M7 11.5h10"/>`,
    square: `<rect x="4" y="4" width="16" height="16" rx="3"/>`,
    check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
    warn: `<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.3v.1"/>`,
    reset: `<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V9h4.5"/>`,
    add: `<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>`,
  };
  U.ICONS = ICONS;
  U.icon = (name, cls) => {
    const t = document.createElement('template');
    t.innerHTML = `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
    return t.content.firstChild;
  };
  /** data-icon 속성이 있는 요소 앞쪽에 아이콘을 넣는다 */
  U.injectIcons = (root) => {
    U.$$('[data-icon]', root).forEach((el) => {
      if (el.querySelector(':scope > svg.ic')) return;
      el.insertBefore(U.icon(el.dataset.icon), el.firstChild);
    });
  };
  U.setIcon = (el, name) => {
    const old = el.querySelector(':scope > svg.ic');
    const n = U.icon(name);
    if (old) old.replaceWith(n);
    else el.insertBefore(n, el.firstChild);
    el.dataset.icon = name;
  };

  // ---------- 알림(토스트) ----------
  U.toast = (msg, opts) => {
    opts = opts || {};
    const root = document.getElementById('toasts');
    if (!root) return;
    while (root.children.length >= 4) root.firstChild.remove();
    const el = U.h('div', { class: 'toast' + (opts.type ? ' ' + opts.type : '') }, [
      opts.type === 'error' || opts.type === 'warn' ? U.icon('warn') : null,
      U.h('span', { class: 'toast-msg' }, msg),
    ]);
    let timer = 0;
    const close = () => {
      clearTimeout(timer);
      el.classList.remove('in');
      setTimeout(() => el.remove(), 260);
    };
    if (opts.action) {
      el.appendChild(
        U.h('button', {
          class: 'toast-act',
          type: 'button',
          onclick: () => {
            close();
            opts.action.fn();
          },
        }, opts.action.label)
      );
    }
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    timer = setTimeout(close, opts.timeout || (opts.type === 'error' ? 6000 : 3400));
    return close;
  };

  // ---------- 모달 ----------
  const openModals = [];
  U.modalOpen = () => openModals.length > 0;
  U.modal = (o) => {
    const root = document.getElementById('modalRoot');
    const prevFocus = document.activeElement;
    const backdrop = U.h('div', { class: 'modal-backdrop' });
    const dlg = U.h('div', { class: 'modal' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title });
    const titleEl = U.h('h2', null, o.title);
    const closeBtn = U.h('button', { class: 'icon-btn small', type: 'button', 'aria-label': '닫기', onclick: () => api.close() }, [U.icon('close')]);
    const head = U.h('div', { class: 'modal-head' }, [titleEl, o.dismissable === false ? null : closeBtn]);
    const body = U.h('div', { class: 'modal-body' }, o.body);
    const foot = U.h('div', { class: 'modal-foot' });
    dlg.append(head, body, foot);
    backdrop.appendChild(dlg);
    let closed = false;
    const api = {
      el: dlg,
      body,
      dismissable: o.dismissable !== false,
      setTitle(t) {
        titleEl.textContent = t;
      },
      setDismissable(v) {
        api.dismissable = v;
        closeBtn.hidden = !v;
      },
      setActions(actions) {
        foot.textContent = '';
        (actions || []).forEach((a) => {
          if (!a) return;
          const b = U.h('button', {
            class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '') + (a.ghost ? ' ghost' : ''),
            type: 'button',
            disabled: a.disabled ? true : null,
            onclick: () => a.onClick && a.onClick(api),
          }, a.label);
          if (a.icon) b.insertBefore(U.icon(a.icon), b.firstChild);
          if (a.id) b.id = a.id;
          foot.appendChild(b);
        });
        foot.hidden = !foot.children.length;
      },
      close(result) {
        if (closed) return;
        closed = true;
        backdrop.remove();
        const i = openModals.indexOf(api);
        if (i >= 0) openModals.splice(i, 1);
        if (o.onClose) o.onClose(result);
        if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
      },
    };
    api.setActions(o.actions);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop && api.dismissable) api.close();
    });
    root.appendChild(backdrop);
    openModals.push(api);
    requestAnimationFrame(() => {
      const f = dlg.querySelector('[autofocus]') || foot.querySelector('.btn.primary') || closeBtn;
      if (f && f.focus) f.focus({ preventScroll: true });
    });
    return api;
  };
  U.topModal = () => openModals[openModals.length - 1] || null;
  U.confirm = (message, opts) =>
    new Promise((resolve) => {
      opts = opts || {};
      let answered = false;
      const m = U.modal({
        title: opts.title || '확인',
        body: U.h('p', { class: 'modal-text' }, message),
        actions: [
          { label: opts.cancel || '취소', ghost: true, onClick: () => { answered = true; m.close(); resolve(false); } },
          { label: opts.ok || '확인', primary: !opts.danger, danger: !!opts.danger, onClick: () => { answered = true; m.close(); resolve(true); } },
        ],
        onClose: () => { if (!answered) resolve(false); },
      });
    });

  /** 파일 저장: claude.ai 아티팩트에서는 downloads 기능, 그 외에는 일반 다운로드 */
  U.downloadsCap = null;
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      U.downloadsCap = window.claude.use('downloads').catch(() => null);
    }
  } catch (e) {
    U.downloadsCap = null;
  }
  U.saveFile = async (blob, filename) => {
    if (U.downloadsCap) {
      const dl = await U.downloadsCap;
      if (dl) {
        try {
          await dl.save({ filename, data: blob });
          return 'saved';
        } catch (err) {
          const code = (err && err.code) || 'unavailable';
          if (code === 'declined') return 'declined';
          if (code === 'rate_limited') return 'busy';
          if (code === 'too_large') return 'too_large';
          return 'unavailable';
        }
      }
      return 'unavailable';
    }
    const url = URL.createObjectURL(blob);
    const a = U.h('a', { href: url, download: filename, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 60000);
    return 'saved';
  };

  VE.U = U;

  // ---------- 상수 ----------
  const C = {};
  C.ASPECTS = [
    { id: '16:9', w: 1920, h: 1080, hint: '가로 · 유튜브' },
    { id: '9:16', w: 1080, h: 1920, hint: '세로 · 쇼츠, 릴스' },
    { id: '1:1', w: 1080, h: 1080, hint: '정사각형' },
    { id: '4:5', w: 1080, h: 1350, hint: '인스타그램 피드' },
    { id: '4:3', w: 1440, h: 1080, hint: '클래식' },
  ];
  C.FONTS = [
    { id: 'Noto Sans KR', label: '본고딕 (Noto Sans KR)' },
    { id: 'IBM Plex Sans KR', label: '플렉스 산스 (IBM Plex)' },
    { id: 'Black Han Sans', label: '검은고딕 (Black Han Sans)' },
    { id: 'Do Hyeon', label: '도현 (Do Hyeon)' },
    { id: 'Jua', label: '주아 (Jua)' },
    { id: 'Nanum Myeongjo', label: '나눔명조' },
    { id: 'Nanum Pen Script', label: '나눔손글씨 펜' },
    { id: 'Gaegu', label: '개구 (Gaegu)' },
  ];
  C.TEXT_PRESETS = {
    title: { text: '제목을 입력하세요', font: 'Black Han Sans', size: 128, color: '#ffffff', bold: false, strokeWidth: 0, bgOpacity: 0, shadow: true, x: 0.5, y: 0.46, anim: 'pop', duration: 3 },
    subtitle: { text: '자막을 입력하세요', font: 'Noto Sans KR', size: 52, color: '#ffffff', bold: true, strokeWidth: 0, bgOpacity: 0.6, bgColor: '#000000', shadow: false, x: 0.5, y: 0.87, anim: 'fade', duration: 3 },
    highlight: { text: '강조할 문구', font: 'Do Hyeon', size: 86, color: '#1d1503', bold: false, strokeWidth: 0, bgOpacity: 1, bgColor: '#f5c542', shadow: false, x: 0.5, y: 0.2, anim: 'slide', duration: 2.5 },
  };
  C.FILTERS = [
    { id: 'none', label: '원본', css: '' },
    { id: 'mono', label: '흑백', css: 'grayscale(1) contrast(1.05)' },
    { id: 'sepia', label: '세피아', css: 'sepia(0.8)' },
    { id: 'vintage', label: '빈티지', css: 'sepia(0.35) contrast(1.08) saturate(0.85) brightness(1.04)' },
    { id: 'vivid', label: '선명하게', css: 'contrast(1.15) saturate(1.4)' },
    { id: 'warm', label: '따뜻하게', css: 'sepia(0.2) saturate(1.25) hue-rotate(-8deg)' },
    { id: 'cool', label: '차갑게', css: 'saturate(0.92) hue-rotate(14deg) brightness(1.03)' },
    { id: 'drama', label: '드라마틱', css: 'contrast(1.35) saturate(0.7) brightness(0.92)' },
  ];
  C.MOTIONS = [
    { id: 'none', label: '없음' },
    { id: 'zoomIn', label: '천천히 확대' },
    { id: 'zoomOut', label: '천천히 축소' },
    { id: 'panLeft', label: '왼쪽으로 이동' },
    { id: 'panRight', label: '오른쪽으로 이동' },
  ];
  C.ANIMS = [
    { id: 'none', label: '없음' },
    { id: 'fade', label: '페이드' },
    { id: 'slide', label: '슬라이드' },
    { id: 'pop', label: '팝' },
    { id: 'typewriter', label: '타자기' },
  ];
  VE.C = C;

  VE.fontStack = (id) => `"${id}", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  VE.fontSpec = (c, px) => `${c.italic ? 'italic ' : ''}${c.bold ? 700 : 400} ${px}px ${VE.fontStack(c.font)}`;
})();
