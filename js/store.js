/* 싹둑 영상 편집기 — 프로젝트 데이터 모델, 실행 취소/다시 실행 */
(function () {
  'use strict';
  const VE = window.VE;
  const U = VE.U;
  const MIN = 0.1; // 클립 최소 길이(초)

  const FILTER0 = { preset: 'none', brightness: 100, contrast: 100, saturate: 100, blur: 0 };
  const VISUAL = { fadeIn: 0, fadeOut: 0, fit: 'contain', scale: 1, x: 0, y: 0, rotate: 0, motion: 'none', filter: FILTER0 };
  const DEFAULTS = {
    video: Object.assign({ kind: 'video', mediaId: null, in: 0, out: 1, speed: 1, volume: 1, muted: false }, VISUAL),
    image: Object.assign({ kind: 'image', mediaId: null, in: 0, out: 4, speed: 1 }, VISUAL),
    color: { kind: 'color', color: '#16181d', in: 0, out: 3, speed: 1, fadeIn: 0, fadeOut: 0 },
    text: {
      kind: 'text', lane: 0, start: 0, duration: 3, text: '텍스트', font: 'Noto Sans KR', size: 64,
      color: '#ffffff', bold: true, italic: false, align: 'center', strokeWidth: 0, strokeColor: '#000000',
      bgOpacity: 0, bgColor: '#000000', shadow: true, x: 0.5, y: 0.85, anim: 'fade',
    },
    audio: { kind: 'audio', lane: 0, mediaId: null, start: 0, in: 0, out: 1, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 },
  };

  function newProject(over) {
    return Object.assign(
      { v: 1, name: '새 프로젝트', width: 1920, height: 1080, fps: 30, background: '#000000', media: [], main: [], texts: [], audio: [], sample: false },
      over || {}
    );
  }

  const M = {};
  M.MIN = MIN;
  M.DEFAULTS = DEFAULTS;

  M.makeClip = (kind, props) => {
    const c = Object.assign(U.clone(DEFAULTS[kind]), props ? U.clone(props) : {});
    if (DEFAULTS[kind].filter) c.filter = Object.assign(U.clone(FILTER0), (props && props.filter) || {});
    c.id = U.uid(kind[0]);
    return c;
  };

  /** 타임라인 위에서의 길이(초) */
  M.clipDur = (c) => (c.kind === 'text' ? c.duration : Math.max(0, (c.out - c.in) / (c.speed || 1)));
  M.clipEnd = (c) => c.start + M.clipDur(c);
  M.media = (p, id) => p.media.find((m) => m.id === id) || null;
  M.mainEnd = (p) => (p.main.length ? M.clipEnd(p.main[p.main.length - 1]) : 0);
  M.duration = (p) => {
    let e = M.mainEnd(p);
    for (const c of p.texts) e = Math.max(e, c.start + c.duration);
    for (const c of p.audio) e = Math.max(e, M.clipEnd(c));
    return e;
  };
  M.isEmpty = (p) => !p.main.length && !p.texts.length && !p.audio.length;

  M.find = (p, id) => {
    if (!id) return null;
    const lists = [['main', p.main], ['text', p.texts], ['audio', p.audio]];
    for (const [track, list] of lists) {
      const i = list.findIndex((c) => c.id === id);
      if (i >= 0) return { clip: list[i], list, track, index: i };
    }
    return null;
  };
  M.mainIndexAt = (p, t) => {
    for (let i = 0; i < p.main.length; i++) {
      const c = p.main[i];
      if (t >= c.start && t < M.clipEnd(c)) return i;
    }
    return -1;
  };
  M.mainAt = (p, t) => {
    const i = M.mainIndexAt(p, t);
    return i >= 0 ? p.main[i] : null;
  };
  /** 화면에 보일 메인 클립 — 맨 끝(재생 종료 지점)에서는 마지막 클립의 마지막 프레임 */
  M.mainForDisplay = (p, t) => {
    const c = M.mainAt(p, t);
    if (c || !p.main.length) return c;
    const end = M.mainEnd(p);
    return t >= end - 1e-6 && t <= end + 1e-3 ? p.main[p.main.length - 1] : null;
  };
  M.laneCount = (list) => list.reduce((m, c) => Math.max(m, c.lane + 1), 0);
  /** 겹치지 않는 레인 찾기 — 원하는 레인에서 가까운 순서 */
  M.freeLane = (list, start, end, preferred, excludeId) => {
    const busy = (lane) =>
      list.some((c) => c.id !== excludeId && c.lane === lane && c.start < end - 1e-6 && M.clipEnd(c) > start + 1e-6);
    const pref = preferred == null ? 0 : Math.max(0, preferred);
    const max = M.laneCount(list.filter((c) => c.id !== excludeId));
    if (!busy(pref)) return pref;
    for (let d = 1; d <= max + 1; d++) {
      for (const l of [pref - d, pref + d]) if (l >= 0 && l <= max && !busy(l)) return l;
    }
    return max;
  };

  /** 재생헤드 위치에서 클립 자르기. 새로 생긴 오른쪽 클립 id 반환 */
  M.split = (p, id, t) => {
    const f = M.find(p, id);
    if (!f) return null;
    const c = f.clip;
    const local = t - c.start;
    const d = M.clipDur(c);
    if (local < MIN || local > d - MIN) return null;
    const b = U.clone(c);
    b.id = U.uid(c.kind[0]);
    if (c.kind === 'text') {
      c.duration = local;
      b.start = t;
      b.duration = d - local;
    } else if (c.kind === 'video' || c.kind === 'audio') {
      const cut = c.in + local * c.speed;
      c.out = cut;
      b.in = cut;
      if (c.kind === 'audio') b.start = t;
    } else {
      c.out = local;
      b.in = 0;
      b.out = d - local;
    }
    c.fadeOut = 0;
    b.fadeIn = 0;
    f.list.splice(f.index + 1, 0, b);
    return b.id;
  };

  function num(v, d) {
    v = +v;
    return isFinite(v) ? v : d;
  }
  function fill(c) {
    const def = DEFAULTS[c.kind];
    if (!def) return false;
    for (const k in def) if (c[k] === undefined) c[k] = U.clone(def[k]);
    if (def.filter) for (const k in FILTER0) if (c.filter[k] === undefined) c.filter[k] = FILTER0[k];
    if (!c.id) c.id = U.uid(c.kind[0]);
    return true;
  }
  function compactLanes(list) {
    const lanes = [...new Set(list.map((c) => c.lane))].sort((a, b) => a - b);
    const map = new Map(lanes.map((l, i) => [l, i]));
    for (const c of list) c.lane = map.get(c.lane);
  }
  function fixRange(c, p) {
    const m = c.mediaId ? M.media(p, c.mediaId) : null;
    const md = m && m.duration > 0 ? m.duration : Infinity;
    c.speed = U.clamp(num(c.speed, 1), 0.1, 8);
    c.in = U.clamp(num(c.in, 0), 0, Math.max(0, md - MIN * c.speed));
    c.out = U.clamp(num(c.out, md), c.in + MIN * c.speed, md);
  }

  /** 값 정리 + 메인 트랙 시작 시간 계산 (모든 변경 뒤에 실행) */
  M.normalize = (p) => {
    p.fps = [24, 25, 30, 60].includes(+p.fps) ? +p.fps : 30;
    p.width = U.even(num(p.width, 1920));
    p.height = U.even(num(p.height, 1080));
    for (const k of ['media', 'main', 'texts', 'audio']) if (!Array.isArray(p[k])) p[k] = [];
    p.main = p.main.filter(fill);
    p.texts = p.texts.filter(fill);
    p.audio = p.audio.filter(fill);
    let t = 0;
    for (const c of p.main) {
      if (c.kind === 'video') fixRange(c, p);
      else {
        c.speed = 1;
        c.in = 0;
        c.out = U.clamp(num(c.out, 3), MIN, 36000);
      }
      const d = M.clipDur(c);
      c.fadeIn = U.clamp(num(c.fadeIn, 0), 0, d);
      c.fadeOut = U.clamp(num(c.fadeOut, 0), 0, d);
      if (c.volume !== undefined) c.volume = U.clamp(num(c.volume, 1), 0, 2);
      if (c.scale !== undefined) c.scale = U.clamp(num(c.scale, 1), 0.1, 5);
      c.start = t;
      t += d;
    }
    for (const c of p.texts) {
      c.start = Math.max(0, num(c.start, 0));
      c.duration = U.clamp(num(c.duration, 3), MIN, 36000);
      c.lane = Math.max(0, Math.round(num(c.lane, 0)));
      c.size = U.clamp(num(c.size, 64), 8, 400);
      c.x = U.clamp(num(c.x, 0.5), -0.5, 1.5);
      c.y = U.clamp(num(c.y, 0.5), -0.5, 1.5);
      if (typeof c.text !== 'string') c.text = String(c.text || '');
    }
    for (const c of p.audio) {
      fixRange(c, p);
      c.start = Math.max(0, num(c.start, 0));
      c.lane = Math.max(0, Math.round(num(c.lane, 0)));
      c.volume = U.clamp(num(c.volume, 1), 0, 2);
      const d = M.clipDur(c);
      c.fadeIn = U.clamp(num(c.fadeIn, 0), 0, d);
      c.fadeOut = U.clamp(num(c.fadeOut, 0), 0, d);
    }
    compactLanes(p.texts);
    compactLanes(p.audio);
    p.texts.sort((a, b) => a.lane - b.lane || a.start - b.start);
    p.audio.sort((a, b) => a.lane - b.lane || a.start - b.start);
    return p;
  };

  // ---------- 저장소 ----------
  class Store extends U.Emitter {
    constructor() {
      super();
      this.project = M.normalize(newProject());
      this.selection = null;
      this.history = [];
      this.future = [];
      this.co = null;
    }
    /**
     * 프로젝트 변경. fn(project)가 직접 고친다.
     * opts.coalesce: 같은 키로 1.5초 안에 이어지는 변경은 실행 취소 한 번으로 묶는다.
     */
    commit(fn, opts) {
      opts = opts || {};
      const before = JSON.stringify(this.project);
      try {
        fn(this.project);
        // 예제 프로젝트를 고치기 시작하면 일반 프로젝트가 된다
        if (this.project.sample && !opts.keepSample) this.project.sample = false;
        M.normalize(this.project);
      } catch (err) {
        console.error(err);
        this.project = JSON.parse(before);
        return false;
      }
      const after = JSON.stringify(this.project);
      if (after === before) return false;
      const now = Date.now();
      if (opts.coalesce && this.co && this.co.key === opts.coalesce && now - this.co.time < 1500) {
        this.co.time = now;
      } else {
        this.history.push(before);
        if (this.history.length > 150) this.history.shift();
        this.co = opts.coalesce ? { key: opts.coalesce, time: now } : null;
      }
      this.future = [];
      this._fixSelection();
      this.emit('change', opts);
      return true;
    }
    replace(p, opts) {
      opts = opts || {};
      if (opts.undoable) this.history.push(JSON.stringify(this.project));
      else this.history = [];
      this.future = [];
      this.co = null;
      this.project = M.normalize(p);
      this.selection = null;
      this.emit('change', { replaced: true });
      this.emit('select', null);
    }
    endCoalesce() {
      this.co = null;
    }
    get canUndo() {
      return this.history.length > 0;
    }
    get canRedo() {
      return this.future.length > 0;
    }
    undo() {
      if (!this.history.length) return false;
      this.future.push(JSON.stringify(this.project));
      this.project = JSON.parse(this.history.pop());
      this.co = null;
      this._fixSelection();
      this.emit('change', { undo: true });
      return true;
    }
    redo() {
      if (!this.future.length) return false;
      this.history.push(JSON.stringify(this.project));
      this.project = JSON.parse(this.future.pop());
      this.co = null;
      this._fixSelection();
      this.emit('change', { redo: true });
      return true;
    }
    select(id) {
      id = id || null;
      if (id === this.selection) return;
      this.selection = id;
      this.co = null;
      this.emit('select', id);
    }
    selected() {
      return M.find(this.project, this.selection);
    }
    _fixSelection() {
      if (this.selection && !M.find(this.project, this.selection)) {
        this.selection = null;
        this.emit('select', null);
      }
    }
  }

  /** 미디어 크기에 맞는 프로젝트 화면 크기 */
  M.sizeFor = (w, h) => {
    if (!(w > 0 && h > 0)) return { w: 1920, h: 1080 };
    const r = w / h;
    for (const a of VE.C.ASPECTS) if (Math.abs(Math.log(r / (a.w / a.h))) < 0.03) return { w: a.w, h: a.h };
    return r >= 1 ? { w: U.even(1080 * r), h: 1080 } : { w: 1080, h: U.even(1080 / r) };
  };
  M.aspectId = (p) => {
    const a = VE.C.ASPECTS.find((x) => x.w === p.width && x.h === p.height);
    return a ? a.id : null;
  };

  VE.M = M;
  VE.newProject = newProject;
  VE.store = new Store();
})();
