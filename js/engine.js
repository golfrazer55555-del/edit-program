/* 싹둑 영상 편집기 — 재생 엔진: 미리보기 합성, 오디오 믹싱, 내보내기용 렌더 */
(function () {
  'use strict';
  const VE = window.VE;
  const U = VE.U;
  const M = VE.M;
  const C = VE.C;
  const store = VE.store;

  const CAN_FILTER = (() => {
    try {
      const x = document.createElement('canvas').getContext('2d');
      x.filter = 'blur(2px)';
      return x.filter === 'blur(2px)';
    } catch (e) {
      return false;
    }
  })();

  const engine = new U.Emitter();
  Object.assign(engine, {
    time: 0,
    playing: false,
    exporting: null,
    stalled: false,
    players: new Map(),
    canvas: null,
    pv: null,
    host: null,
    dirty: true,
    showSafe: false,
    guides: null,
    monitorVolume: 1,
    monitorMuted: false,
    actx: null,
    master: null,
    monitor: null,
    textBoxes: [],
    mainBox: null,
    canFilter: CAN_FILTER,
    _lastNow: 0,
    _lastFrame: -1,
    _lastGc: 0,
    _curMainId: null,
    _stallSince: 0,
    _bg: null,
  });

  // ---------- 미디어 요소 풀 ----------
  // Safari 등은 사용자 동작 없이 소리 있는 재생을 막는다. 요소를 미리 만들어 두고
  // 재생 버튼을 누를 때 한꺼번에 '잠금 해제'한 뒤 돌려쓴다.
  const pool = { video: [], audio: [] };
  function makeEl(kind) {
    const el = document.createElement(kind);
    el.preload = 'auto';
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    (engine.host || document.body).appendChild(el);
    engine.connectEl(el);
    return el;
  }
  function acquire(kind) {
    return pool[kind].pop() || makeEl(kind);
  }
  function release(el, kind) {
    try {
      el.pause();
    } catch (e) {}
    el.removeAttribute('src');
    try {
      el.load();
    } catch (e) {}
    try {
      el.playbackRate = 1;
    } catch (e) {}
    if (pool[kind].length < 8) pool[kind].push(el);
    else {
      try {
        if (el._veSrc) el._veSrc.disconnect();
        if (el._veGain) el._veGain.disconnect();
      } catch (e) {}
      el.remove();
    }
  }

  class Player {
    constructor(clip, rt, kind) {
      this.clipId = clip.id;
      this.mediaId = rt.id;
      this.url = rt.url;
      this.kind = kind;
      this.isMain = kind === 'video';
      this.failed = false;
      this.wantPlay = false;
      this.playPending = false;
      this.seekTarget = null;
      this.lastUsed = performance.now();
      this.lastCt = -1;
      this.lastCtAt = this.lastUsed;
      this._gain = -1;
      const el = acquire(kind);
      this.el = el;
      this._on = {
        seeked: () => this._onSeeked(),
        loadeddata: () => engine.invalidate(),
        canplay: () => engine.invalidate(),
        error: () => {
          if (this.el && this.el.getAttribute('src')) {
            this.failed = true;
            engine.invalidate();
          }
        },
      };
      for (const k in this._on) el.addEventListener(k, this._on[k]);
      engine.connectEl(el);
      if (el._veGain) {
        try {
          el._veGain.gain.cancelScheduledValues(0);
          el._veGain.gain.value = 0;
        } catch (e) {}
        el.volume = 1;
      } else {
        el.volume = 0;
      }
      el.muted = false;
      el.src = rt.url;
    }
    seek(t) {
      const el = this.el;
      if (!el) return;
      t = Math.max(0, t);
      if (el.seeking) {
        this.seekTarget = t;
        return;
      }
      this.seekTarget = null;
      if (Math.abs(el.currentTime - t) < 0.001) return;
      try {
        el.currentTime = t;
      } catch (e) {}
    }
    _onSeeked() {
      const el = this.el;
      if (!el) return;
      if (this.seekTarget != null) {
        const t = this.seekTarget;
        this.seekTarget = null;
        if (Math.abs(el.currentTime - t) > 0.001) {
          try {
            el.currentTime = t;
          } catch (e) {}
          return;
        }
      }
      engine.invalidate();
    }
    play() {
      this.wantPlay = true;
      const el = this.el;
      if (!el || !el.paused || this.playPending) return;
      this.playPending = true;
      let pr;
      try {
        pr = el.play();
      } catch (e) {
        pr = Promise.reject(e);
      }
      if (pr && pr.then) {
        pr.then(
          () => {
            this.playPending = false;
            if (!this.wantPlay && this.el) this.el.pause();
          },
          (err) => {
            this.playPending = false;
            if (!err || err.name === 'AbortError') return;
            engine._playError(this, err);
          }
        );
      } else {
        this.playPending = false;
      }
    }
    pause() {
      this.wantPlay = false;
      const el = this.el;
      if (el && !el.paused) el.pause();
    }
    setGain(v) {
      const el = this.el;
      if (!el) return;
      v = Math.max(0, v);
      if (Math.abs(v - this._gain) < 0.0005) return;
      this._gain = v;
      const g = el._veGain;
      if (g && engine.actx) {
        try {
          g.gain.setTargetAtTime(v, engine.actx.currentTime, 0.012);
        } catch (e) {
          g.gain.value = v;
        }
      } else {
        el.volume = U.clamp(v, 0, 1);
      }
    }
    destroy() {
      const el = this.el;
      if (!el) return;
      this.wantPlay = false;
      for (const k in this._on) el.removeEventListener(k, this._on[k]);
      if (el._veGain) {
        try {
          el._veGain.gain.cancelScheduledValues(0);
          el._veGain.gain.value = 0;
        } catch (e) {}
      }
      release(el, this.kind);
      this.el = null;
    }
  }

  // ---------- 오디오 ----------
  engine.audio = function () {
    if (this.actx) return this.actx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      this.actx = new AC();
      this.master = this.actx.createGain();
      this.monitor = this.actx.createGain();
      this.master.connect(this.monitor);
      this.monitor.connect(this.actx.destination);
      this._applyMonitor();
      for (const kind of ['video', 'audio']) for (const el of pool[kind]) this.connectEl(el);
      for (const pl of this.players.values()) if (pl.el) this.connectEl(pl.el);
    } catch (e) {
      console.warn('AudioContext를 만들 수 없습니다', e);
      this.actx = null;
    }
    return this.actx;
  };
  engine.connectEl = function (el) {
    if (!this.actx || el._veGain !== undefined) return;
    try {
      const src = this.actx.createMediaElementSource(el);
      const g = this.actx.createGain();
      g.gain.value = 0;
      src.connect(g);
      g.connect(this.master);
      el._veSrc = src;
      el._veGain = g;
      el.volume = 1;
    } catch (e) {
      el._veGain = null;
    }
  };
  engine._applyMonitor = function () {
    if (!this.monitor) return;
    const v = this.exporting && !this.exporting.listen ? 0 : this.monitorMuted ? 0 : this.monitorVolume;
    this.monitor.gain.value = v;
  };
  engine.setMonitor = function (vol, muted) {
    if (vol != null) this.monitorVolume = vol;
    if (muted != null) this.monitorMuted = muted;
    this._applyMonitor();
  };
  /** 반드시 클릭 같은 사용자 동작 안에서 부른다 */
  engine.unlock = function () {
    const ctx = this.audio();
    if (ctx && ctx.state !== 'running') {
      try {
        const r = ctx.resume();
        if (r && r.catch) r.catch(() => {});
      } catch (e) {}
    }
    const touch = (el) => {
      if (el._veUnlocked || !el.paused) return;
      el._veUnlocked = true;
      try {
        const r = el.play();
        if (r && r.catch) r.catch(() => {});
        el.pause();
      } catch (e) {}
    };
    for (const kind of ['video', 'audio']) {
      while (pool[kind].length < 3) pool[kind].push(makeEl(kind));
      pool[kind].forEach(touch);
    }
    for (const pl of this.players.values()) if (pl.el && !pl.wantPlay) touch(pl.el);
  };

  // ---------- 그리기 도우미 ----------
  function fadeAt(c, t) {
    const d = M.clipDur(c);
    const local = t - c.start;
    let a = 1;
    if (c.fadeIn > 0) a = Math.min(a, local / c.fadeIn);
    if (c.fadeOut > 0) a = Math.min(a, (d - local) / c.fadeOut);
    return U.clamp(a, 0, 1);
  }
  engine.fadeAt = fadeAt;

  function filterCSS(c, W) {
    const f = c.filter;
    if (!f) return 'none';
    const parts = [];
    const pre = C.FILTERS.find((x) => x.id === f.preset);
    if (pre && pre.css) parts.push(pre.css);
    if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
    if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
    if (f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`);
    if (f.blur > 0) parts.push(`blur(${((f.blur * W) / 1920).toFixed(2)}px)`);
    return parts.length ? parts.join(' ') : 'none';
  }

  function drawVisual(ctx, W, H, c, src, t) {
    const sw = src.videoWidth || src.naturalWidth || src.width;
    const sh = src.videoHeight || src.naturalHeight || src.height;
    if (!sw || !sh) return null;
    const dur = M.clipDur(c);
    const local = t - c.start;
    const alpha = fadeAt(c, t);
    const rot = (((c.rotate || 0) % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    const bw = swap ? sh : sw;
    const bh = swap ? sw : sh;
    let s = c.fit === 'cover' ? Math.max(W / bw, H / bh) : Math.min(W / bw, H / bh);
    s *= c.scale || 1;
    const pr = dur > 0 ? U.easeInOut(U.clamp(local / dur, 0, 1)) : 0;
    let mx = 0;
    switch (c.motion) {
      case 'zoomIn': s *= 1 + 0.16 * pr; break;
      case 'zoomOut': s *= 1.16 - 0.16 * pr; break;
      case 'panLeft': s *= 1.14; mx = (0.5 - pr) * 0.1 * W; break;
      case 'panRight': s *= 1.14; mx = (pr - 0.5) * 0.1 * W; break;
      default: break;
    }
    const cx = W / 2 + ((c.x || 0) * W) / 2 + mx;
    const cy = H / 2 + ((c.y || 0) * H) / 2;
    if (alpha > 0) {
      ctx.save();
      ctx.globalAlpha = alpha;
      if (CAN_FILTER) ctx.filter = filterCSS(c, W);
      ctx.translate(cx, cy);
      if (rot) ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(src, (-sw * s) / 2, (-sh * s) / 2, sw * s, sh * s);
      ctx.restore();
    }
    return { x: cx - (bw * s) / 2, y: cy - (bh * s) / 2, w: bw * s, h: bh * s };
  }

  function drawColor(ctx, W, H, c, t) {
    ctx.save();
    ctx.globalAlpha = fadeAt(c, t);
    ctx.fillStyle = c.color || '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawMissing(ctx, W, H, c) {
    const meta = M.media(store.project, c.mediaId);
    ctx.save();
    ctx.fillStyle = '#1a1d23';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = W / 80;
    for (let x = -H; x < W; x += W / 18) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + H, 0);
      ctx.stroke();
    }
    const k = Math.min(W, H) / 1080;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(44 * k)}px ${VE.fontStack('IBM Plex Sans KR')}`;
    ctx.fillText('미디어를 찾을 수 없습니다', W / 2, H / 2 - 30 * k);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `400 ${Math.round(30 * k)}px ${VE.fontStack('IBM Plex Sans KR')}`;
    ctx.fillText((meta ? meta.name + ' · ' : '') + '같은 파일을 다시 가져오면 연결됩니다', W / 2, H / 2 + 30 * k);
    ctx.restore();
  }

  const fontsRequested = new Set();
  VE.fonts = {
    ensure(c) {
      if (!document.fonts || !document.fonts.load) return Promise.resolve();
      const spec = VE.fontSpec(c, 48);
      const key = spec + '|' + c.text;
      if (fontsRequested.has(key)) return Promise.resolve();
      fontsRequested.add(key);
      return document.fonts.load(spec, c.text || '가A').then(
        () => engine.invalidate(),
        () => {}
      );
    },
    async ensureAll(p) {
      await Promise.all(p.texts.map((c) => VE.fonts.ensure(c)));
      try {
        await Promise.race([document.fonts.ready, U.sleep(3000)]);
      } catch (e) {}
    },
  };

  /** 글자 상자의 위치·크기 계산 (그리기와 클릭 판정이 같은 값을 쓴다) */
  function textLayout(ctx, W, H, c, t, ignoreAnim) {
    const full = c.text || '';
    if (!full.trim()) return null;
    const local = t - c.start;
    const dur = c.duration;
    const k = Math.min(W, H) / 1080;
    const ad = Math.min(0.45, dur / 3);
    const pin = ad > 0 ? U.clamp(local / ad, 0, 1) : 1;
    const pout = ad > 0 ? U.clamp((dur - local) / ad, 0, 1) : 1;
    let alpha = 1;
    let dy = 0;
    let sc = 1;
    let shown = full;
    if (!ignoreAnim) {
      switch (c.anim) {
        case 'fade':
          alpha = Math.min(pin, pout);
          break;
        case 'slide':
          alpha = Math.min(pin, pout);
          dy = (1 - U.easeOutCubic(pin)) * 70 * k;
          break;
        case 'pop':
          sc = pin < 1 ? 0.55 + 0.45 * U.easeOutBack(pin) : 1;
          alpha = Math.min(U.clamp(pin * 2.5, 0, 1), pout);
          break;
        case 'typewriter': {
          const chars = Array.from(full);
          const typeDur = Math.min(dur * 0.7, Math.max(0.3, chars.length * 0.07));
          shown = chars.slice(0, Math.floor(chars.length * U.clamp(local / typeDur, 0, 1) + 1e-6)).join('');
          alpha = pout;
          break;
        }
        default:
          break;
      }
    }
    const px = Math.max(1, c.size * k);
    ctx.save();
    ctx.font = VE.fontSpec(c, px);
    const lines = full.split('\n');
    const widths = lines.map((l) => ctx.measureText(l).width);
    ctx.restore();
    const lh = px * 1.3;
    const bw = Math.max(1, ...widths);
    const bh = lh * lines.length;
    const pad = px * 0.34;
    const L = {
      alpha, sc, px, k, lh, widths, bw, bh,
      shownLines: shown.split('\n'),
      cx: c.x * W,
      cy: c.y * H + dy,
      bx: -bw / 2 - pad,
      by: -bh / 2 - pad * 0.5,
      bW: bw + pad * 2,
      bH: bh + pad,
    };
    L.box = { id: c.id, x: L.cx + L.bx * sc, y: L.cy + L.by * sc, w: L.bW * sc, h: L.bH * sc };
    return L;
  }

  function drawText(ctx, W, H, c, t) {
    VE.fonts.ensure(c);
    const L = textLayout(ctx, W, H, c, t, false);
    if (!L || L.alpha <= 0.002) return null;
    const { px, k, lh, widths, bw, bh, sc } = L;
    ctx.save();
    ctx.font = VE.fontSpec(c, px);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.globalAlpha = L.alpha;
    ctx.translate(L.cx, L.cy);
    if (sc !== 1) ctx.scale(sc, sc);
    if (c.bgOpacity > 0) {
      ctx.fillStyle = U.rgba(c.bgColor, c.bgOpacity);
      U.roundRect(ctx, L.bx, L.by, L.bW, L.bH, px * 0.2);
      ctx.fill();
    }
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    for (let i = 0; i < L.shownLines.length; i++) {
      const s = L.shownLines[i];
      if (!s) continue;
      const lw = widths[i] || 0;
      const lx = c.align === 'left' ? -bw / 2 : c.align === 'right' ? bw / 2 - lw : -lw / 2;
      const ly = -bh / 2 + lh * (i + 0.5);
      if (c.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 12 * k;
        ctx.shadowOffsetY = 3 * k;
      }
      if (c.strokeWidth > 0) {
        ctx.strokeStyle = c.strokeColor;
        ctx.lineWidth = c.strokeWidth * k * 2;
        ctx.strokeText(s, lx, ly);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = c.color;
      ctx.fillText(s, lx, ly);
      ctx.shadowColor = 'transparent';
    }
    ctx.restore();
    return L.box;
  }

  /** 미리보기 클릭 판정: 현재 보이는(또는 곧 나타날) 글자 상자들, 위 레이어가 뒤쪽 */
  const scratch = document.createElement('canvas').getContext('2d');
  engine.hitText = function (x, y, W, H) {
    const p = store.project;
    const t = this.time;
    let hit = null;
    for (const c of p.texts) {
      if (t < c.start || t >= c.start + c.duration) continue;
      const L = textLayout(scratch, W, H, c, t, true);
      if (!L) continue;
      const b = L.box;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) hit = b;
    }
    return hit;
  };

  function drawSafe(ctx, W, H) {
    const u = Math.max(1, W / 960);
    ctx.save();
    ctx.lineWidth = u;
    ctx.setLineDash([6 * u, 5 * u]);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.strokeRect(W * 0.035, H * 0.035, W * 0.93, H * 0.93);
    ctx.strokeStyle = 'rgba(242,179,61,0.75)';
    ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    const s = Math.min(W, H) * 0.025;
    ctx.beginPath();
    ctx.moveTo(W / 2 - s, H / 2);
    ctx.lineTo(W / 2 + s, H / 2);
    ctx.moveTo(W / 2, H / 2 - s);
    ctx.lineTo(W / 2, H / 2 + s);
    ctx.stroke();
    ctx.restore();
  }

  function drawSel(ctx, W, b) {
    const u = Math.max(1.5, W / 700);
    ctx.save();
    ctx.lineWidth = u;
    ctx.strokeStyle = '#f2b33d';
    ctx.setLineDash([5 * u, 3 * u]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#f2b33d';
    const r = u * 2.4;
    for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  function drawGuides(ctx, W, H, g) {
    const u = Math.max(1, W / 900);
    ctx.save();
    ctx.strokeStyle = 'rgba(80,200,255,0.9)';
    ctx.lineWidth = u;
    ctx.beginPath();
    if (g.x) {
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
    }
    if (g.y) {
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 시각 t의 장면을 target 캔버스에 그린다. 아직 영상이 준비되지 않았으면 이전 프레임을 유지 */
  engine.renderFrame = function (target, t, preview) {
    const ctx = target.ctx;
    const W = target.w;
    const H = target.h;
    const p = store.project;
    const total = M.duration(p);
    const tt = total > 0 && t >= total - 1e-6 ? total - 1e-3 : t;
    const cur = M.mainForDisplay(p, tt);
    let src = null;
    let ready = true;
    let missing = false;
    if (cur && cur.kind === 'video') {
      const pl = this.players.get(cur.id);
      const rt = VE.media.get(cur.mediaId);
      if (pl && pl.el && !pl.failed) {
        if (pl.el.readyState >= 2) src = pl.el;
        else ready = false;
      } else if (!rt || rt.status === 'missing' || rt.status === 'error' || (pl && pl.failed)) missing = true;
      else ready = false;
    } else if (cur && cur.kind === 'image') {
      const rt = VE.media.get(cur.mediaId);
      if (rt && rt.img) src = rt.img;
      else if (rt && rt.status === 'loading') ready = false;
      else missing = true;
    }
    if (!ready && target.hasFrame) return false;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (CAN_FILTER) ctx.filter = 'none';
    ctx.fillStyle = p.background || '#000';
    ctx.fillRect(0, 0, W, H);
    let mainBox = null;
    if (cur) {
      if (cur.kind === 'color') drawColor(ctx, W, H, cur, tt);
      else if (src) mainBox = drawVisual(ctx, W, H, cur, src, tt);
      else if (missing) drawMissing(ctx, W, H, cur);
    }
    const boxes = [];
    for (const tc of p.texts) {
      if (tt >= tc.start && tt < tc.start + tc.duration) {
        const b = drawText(ctx, W, H, tc, tt);
        if (b) boxes.push(b);
      }
    }
    if (preview) {
      this.textBoxes = boxes;
      this.mainBox = mainBox && cur ? Object.assign(mainBox, { id: cur.id }) : null;
      if (this.showSafe) drawSafe(ctx, W, H);
      const sel = store.selection;
      if (sel) {
        const b = boxes.find((x) => x.id === sel) || (this.mainBox && this.mainBox.id === sel ? this.mainBox : null);
        if (b) drawSel(ctx, W, b);
      }
      if (this.guides) drawGuides(ctx, W, H, this.guides);
    }
    ctx.restore();
    target.hasFrame = true;
    return true;
  };

  // ---------- 재생 제어 ----------
  function canContinue(a, b) {
    return !!(a && b && a.kind === 'video' && b.kind === 'video' && a.mediaId === b.mediaId && Math.abs(b.in - a.out) < 0.04 && a.speed === b.speed);
  }

  engine._player = function (clip, kind) {
    let pl = this.players.get(clip.id);
    const rt = VE.media.get(clip.mediaId);
    if (pl && (!rt || pl.mediaId !== clip.mediaId || pl.url !== rt.url || pl.kind !== kind)) {
      pl.destroy();
      this.players.delete(clip.id);
      pl = null;
    }
    if (pl) return pl.failed ? null : pl;
    if (!rt || !rt.url || rt.status !== 'ready') return null;
    pl = new Player(clip, rt, kind);
    this.players.set(clip.id, pl);
    return pl;
  };

  engine._handoff = function (prevId, cur) {
    const f = M.find(store.project, prevId);
    if (!f || !canContinue(f.clip, cur)) return;
    const pl = this.players.get(prevId);
    if (!pl || !pl.el || pl.el.paused) return;
    const existing = this.players.get(cur.id);
    if (existing && existing !== pl) existing.destroy();
    this.players.delete(prevId);
    pl.clipId = cur.id;
    this.players.set(cur.id, pl);
  };

  /** 시각 t에 맞춰 각 미디어 요소를 재생·정지·탐색 */
  engine._sync = function (t) {
    const p = store.project;
    const now = performance.now();
    const playing = this.playing;
    const idx = M.mainIndexAt(p, t);
    let cur = idx >= 0 ? p.main[idx] : null;
    if (!cur && !playing) cur = M.mainForDisplay(p, t);
    if (playing && cur && this._curMainId && this._curMainId !== cur.id) this._handoff(this._curMainId, cur);
    this._curMainId = cur ? cur.id : null;
    const curId = cur ? cur.id : null;

    if (cur && cur.kind === 'video') {
      const pl = this._player(cur, 'video');
      if (pl) {
        pl.lastUsed = now;
        const el = pl.el;
        const target = U.clamp(cur.in + (t - cur.start) * cur.speed, cur.in, Math.max(cur.in, cur.out - 0.001));
        if (playing) {
          if (el.playbackRate !== cur.speed) el.playbackRate = cur.speed;
          if (el.paused && !pl.playPending) {
            if (target < cur.out - 0.015) {
              if (Math.abs(el.currentTime - target) > 0.04) pl.seek(target);
              pl.play();
            }
          } else if (!el.seeking && !pl.playPending && Math.abs(el.currentTime - target) > 0.35) {
            pl.seek(target);
          }
        } else {
          pl.pause();
          pl.seek(target);
        }
        pl.setGain(cur.muted ? 0 : cur.volume * fadeAt(cur, t));
      }
    }
    for (const [id, pl] of this.players) if (pl.isMain && id !== curId) pl.pause();

    // 다음 영상 클립을 미리 준비해 끊김을 줄인다
    if (playing && idx >= 0 && idx + 1 < p.main.length) {
      const next = p.main[idx + 1];
      if (next.kind === 'video' && M.clipEnd(cur) - t < 2.5 && !canContinue(cur, next)) {
        const pl = this._player(next, 'video');
        if (pl) {
          pl.lastUsed = now;
          if (pl.el.paused && !pl.playPending) pl.seek(next.in);
          pl.setGain(0);
        }
      }
    }

    const hold = !!(this.exporting && this.exporting.paused);
    for (const a of p.audio) {
      const s = a.start;
      const e = M.clipEnd(a);
      const inside = t >= s && t < e;
      const soon = playing && t < s && s - t < 2;
      let pl = this.players.get(a.id);
      if ((!inside && !soon) || !playing) {
        if (pl) pl.pause();
        continue;
      }
      pl = this._player(a, 'audio');
      if (!pl) continue;
      pl.lastUsed = now;
      const el = pl.el;
      if (soon) {
        if (el.paused && !pl.playPending) pl.seek(a.in);
        pl.setGain(0);
        continue;
      }
      if (hold) {
        pl.pause();
        continue;
      }
      const target = a.in + (t - s) * a.speed;
      if (el.paused && !pl.playPending) {
        if (target < a.out - 0.02) {
          if (Math.abs(el.currentTime - target) > 0.04) pl.seek(target);
          el.playbackRate = a.speed;
          pl.play();
        }
      } else if (!el.seeking && !pl.playPending) {
        const drift = el.currentTime - target;
        if (Math.abs(drift) > 0.5) pl.seek(target);
        else if (Math.abs(drift) > 0.045) el.playbackRate = a.speed * (drift > 0 ? 0.96 : 1.04);
        else if (el.playbackRate !== a.speed) el.playbackRate = a.speed;
      }
      pl.setGain(a.muted ? 0 : a.volume * fadeAt(a, t));
    }
  };

  engine._advance = function (now) {
    const p = store.project;
    const total = M.duration(p);
    let dt = (now - this._lastNow) / 1000;
    this._lastNow = now;
    if (!(dt > 0)) dt = 0;
    else if (dt > 0.25) dt = 0.25;
    let t = this.time;
    let advanced = false;
    let stalled = false;
    const cur = M.mainAt(p, t);
    if (cur && cur.kind === 'video') {
      const pl = this.players.get(cur.id);
      if (pl && pl.el && !pl.failed) {
        const el = pl.el;
        const ct = el.currentTime;
        if (ct !== pl.lastCt) {
          pl.lastCt = ct;
          pl.lastCtAt = now;
        }
        if (el.ended || ct >= cur.out - 0.015) {
          // 클립 끝 → 다음 클립으로
          t = Math.max(t, M.clipEnd(cur));
          advanced = true;
          this._stallSince = 0;
        } else if (el.paused || el.seeking || el.readyState < 3 || now - pl.lastCtAt > 150) {
          // 영상이 준비될 때까지 시계를 멈춘다
          stalled = true;
          advanced = true;
          if (!this._stallSince) this._stallSince = now;
          else if (now - this._stallSince > 4000) {
            pl.failed = true;
            this._stallSince = 0;
            U.toast('영상 일부를 재생하지 못해 건너뜁니다', { type: 'warn' });
          }
        } else {
          this._stallSince = 0;
          const tv = cur.start + (ct - cur.in) / cur.speed;
          if (tv >= t - 0.05 && tv <= t + dt + 0.3) {
            if (tv > t) t = tv;
            advanced = true;
          }
        }
      }
    }
    if (!advanced) {
      t += dt;
      this._stallSince = 0;
    }
    this.stalled = stalled;
    if (t >= total - 1e-4) {
      this.time = total;
      this._finish();
      return;
    }
    this.time = t;
    this._sync(t);
  };

  engine._finish = function () {
    this.playing = false;
    this.stalled = false;
    this._pauseAll();
    this._sync(this.time);
    this._bgTicker();
    this.invalidate();
    this.emit('pause');
    this.emit('ended');
  };

  engine._pauseAll = function () {
    for (const pl of this.players.values()) pl.pause();
  };

  engine._playError = function (pl, err) {
    if (err.name === 'NotAllowedError') {
      if (this.playing && !this.exporting) {
        this.pause();
        U.toast('브라우저가 자동 재생을 막았습니다. 재생 버튼을 한 번 더 눌러 주세요.', { type: 'warn' });
      }
    } else if (err.name === 'NotSupportedError') {
      pl.failed = true;
      this.invalidate();
    }
  };

  engine.play = function () {
    if (this.playing) return true;
    const total = M.duration(store.project);
    if (total <= 0) return false;
    if (this.time >= total - 0.02) this.time = 0;
    this.unlock();
    this.playing = true;
    this._lastNow = performance.now();
    this._stallSince = 0;
    for (const pl of this.players.values()) {
      pl.lastCt = -1;
      pl.lastCtAt = this._lastNow;
    }
    this._sync(this.time);
    this._bgTicker();
    this.emit('play');
    return true;
  };
  engine.pause = function () {
    if (!this.playing) return;
    this.playing = false;
    this.stalled = false;
    this._pauseAll();
    this._sync(this.time);
    this._bgTicker();
    this.invalidate();
    this.emit('pause');
  };
  engine.toggle = function () {
    if (this.playing) {
      this.pause();
      return false;
    }
    return this.play();
  };
  engine.seek = function (t) {
    const total = M.duration(store.project);
    this.time = U.clamp(+t || 0, 0, total);
    if (this.playing) {
      this._pauseAll();
      this._lastNow = performance.now();
      this._stallSince = 0;
      for (const pl of this.players.values()) pl.lastCtAt = this._lastNow;
    }
    this._sync(this.time);
    this.invalidate();
    this.emit('time', this.time);
  };
  engine.step = function (frames) {
    if (this.playing) this.pause();
    const fps = store.project.fps;
    this.seek((Math.round(this.time * fps) + frames) / fps);
  };
  engine.invalidate = function () {
    this.dirty = true;
  };

  /** 내보내기 시작 지점의 영상이 준비될 때까지 기다린다 */
  engine.prepareAt = async function (t) {
    this.pause();
    this.seek(t);
    const until = performance.now() + 10000;
    while (performance.now() < until) {
      const cur = M.mainAt(store.project, t);
      let ok = true;
      if (cur && cur.kind === 'video') {
        const pl = this.players.get(cur.id);
        ok = !pl || pl.failed || !pl.el || (pl.el.readyState >= 3 && !pl.el.seeking);
      }
      if (ok) break;
      await U.sleep(40);
    }
  };
  engine.beginExport = function (opts) {
    this.pause();
    this.exporting = Object.assign({ hasFrame: false, paused: false }, opts);
    this._applyMonitor();
    this._bgTicker();
  };
  engine.endExport = function () {
    this.exporting = null;
    this.pause();
    this._applyMonitor();
    this._bgTicker();
    if (this.pv) this.pv.hasFrame = false;
    this.invalidate();
  };

  // ---------- 프레임 루프 ----------
  engine._frame = function (now) {
    if (now === this._lastFrame) return;
    this._lastFrame = now;
    if (this.playing) this._advance(now);
    const ex = this.exporting;
    if (ex) {
      if (this.playing || this.dirty) {
        this.dirty = false;
        this.renderFrame(ex, this.time, false);
        if (ex.onFrame) ex.onFrame(this.time, this.stalled);
        this.emit('time', this.time);
      }
    } else if (this.playing || this.dirty) {
      this.dirty = false;
      if (this.pv) {
        this.pv.w = this.canvas.width;
        this.pv.h = this.canvas.height;
        this.renderFrame(this.pv, this.time, true);
      }
      this.emit('time', this.time);
    }
    if (now - this._lastGc > 1000) {
      this._lastGc = now;
      this._gc(now);
    }
  };
  const loop = (now) => {
    requestAnimationFrame(loop);
    engine._frame(now);
  };

  // 탭이 가려지면 requestAnimationFrame이 멈추므로 워커 타이머로 이어 간다
  engine._bgTicker = function () {
    const need = (this.playing || !!this.exporting) && document.hidden;
    if (need && !this._bg) {
      const tick = () => this._frame(performance.now());
      try {
        const src = 'let t=0;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const w = new Worker(url);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        w.onmessage = tick;
        w.postMessage(1000 / 30);
        this._bg = { stop: () => w.terminate() };
      } catch (e) {
        const id = setInterval(tick, 1000 / 30);
        this._bg = { stop: () => clearInterval(id) };
      }
    } else if (!need && this._bg) {
      this._bg.stop();
      this._bg = null;
    }
  };

  engine._gc = function (now) {
    const p = store.project;
    for (const [id, pl] of this.players) {
      const alive = M.find(p, id);
      const idle = id !== this._curMainId && now - pl.lastUsed > 4000 && (!pl.el || pl.el.paused);
      if (!alive || idle) {
        pl.destroy();
        this.players.delete(id);
      }
    }
  };

  engine._reconcile = function () {
    const p = store.project;
    for (const [id, pl] of this.players) {
      const f = M.find(p, id);
      if (!f || f.clip.mediaId !== pl.mediaId) {
        pl.destroy();
        this.players.delete(id);
      }
    }
    const total = M.duration(p);
    if (this.time > total) this.time = total;
    if (!this.playing) this._sync(this.time);
    this.invalidate();
    this.emit('time', this.time);
  };

  engine.init = function (canvas, host) {
    this.canvas = canvas;
    this.host = host;
    this.pv = { ctx: canvas.getContext('2d', { alpha: false }), w: canvas.width, h: canvas.height, hasFrame: false };
    store.on('change', () => this._reconcile());
    store.on('select', () => this.invalidate());
    VE.media.on('update', () => {
      if (!this.playing) this._sync(this.time);
      this.invalidate();
    });
    VE.media.on('relink', (id) => {
      for (const [cid, pl] of this.players) {
        if (pl.mediaId === id) {
          pl.destroy();
          this.players.delete(cid);
        }
      }
      this._sync(this.time);
      this.invalidate();
    });
    document.addEventListener('visibilitychange', () => this._bgTicker());
    requestAnimationFrame(loop);
  };
  /** 미리보기 캔버스 크기가 바뀐 뒤 */
  engine.resized = function () {
    if (this.pv) this.pv.hasFrame = false;
    this.invalidate();
  };

  VE.engine = engine;
})();
