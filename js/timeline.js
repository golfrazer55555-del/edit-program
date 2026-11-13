/* 싹둑 영상 편집기 — 타임라인: 트랙, 클립 이동·순서 바꾸기·길이 조절, 눈금자, 확대/축소 */
(function () {
  'use strict';
  const VE = window.VE;
  const U = VE.U;
  const M = VE.M;
  const store = VE.store;
  const engine = VE.engine;

  const ROW_H = { text: 34, main: 62, audio: 46 };
  const SNAP_PX = 8;
  const tl = new U.Emitter();
  Object.assign(tl, { pps: 60, minPps: 0.2, maxPps: 800, snap: true, rows: [], drag: null });

  let E = null;
  let colors = {};

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    colors = { tick: v('--fg-3', '#6f7684'), label: v('--fg-2', '#a3a9b5'), mono: v('--font-mono', 'monospace') };
  }

  const ppsToSlider = (pps) => (1000 * Math.log(pps / tl.minPps)) / Math.log(tl.maxPps / tl.minPps);
  const sliderToPps = (v) => tl.minPps * Math.pow(tl.maxPps / tl.minPps, v / 1000);

  // ---------- 그리기 ----------
  tl.render = function () {
    if (!E) return;
    const p = store.project;
    const tLanes = Math.max(1, M.laneCount(p.texts));
    const aLanes = Math.max(1, M.laneCount(p.audio));
    const rows = [];
    for (let l = tLanes - 1; l >= 0; l--) rows.push({ type: 'text', lane: l });
    rows.push({ type: 'main', lane: 0 });
    for (let l = 0; l < aLanes; l++) rows.push({ type: 'audio', lane: l });
    E.rows.textContent = '';
    E.heads.textContent = '';
    let top = 0;
    for (const r of rows) {
      r.h = ROW_H[r.type];
      r.top = top;
      top += r.h;
      r.el = U.h('div', { class: 'tl-row tl-row-' + r.type, style: `height:${r.h}px` });
      E.rows.appendChild(r.el);
      E.heads.appendChild(headEl(r, tLanes, aLanes));
    }
    tl.rows = rows;
    E.rows.style.height = top + 'px';
    E.content.style.height = top + 'px';
    const rowOf = (type, lane) => rows.find((r) => r.type === type && r.lane === lane);
    const main = rowOf('main', 0);
    for (const c of p.main) main.el.appendChild(clipEl(c, 'main', p));
    for (const c of p.texts) {
      const r = rowOf('text', c.lane);
      if (r) r.el.appendChild(clipEl(c, 'text', p));
    }
    for (const c of p.audio) {
      const r = rowOf('audio', c.lane);
      if (r) r.el.appendChild(clipEl(c, 'audio', p));
    }
    if (M.isEmpty(p)) {
      main.el.appendChild(U.h('div', { class: 'tl-empty' }, '영상이나 사진을 여기로 끌어다 놓거나, 미디어 목록에서 + 를 누르세요'));
    }
    updateWidth();
    placePlayhead(engine.time);
    drawRuler();
    updateZoomUI();
  };

  function headEl(r, tLanes, aLanes) {
    let label;
    if (r.type === 'main') label = '영상';
    else if (r.type === 'text') label = tLanes > 1 ? `텍스트 ${r.lane + 1}` : '텍스트';
    else label = aLanes > 1 ? `오디오 ${r.lane + 1}` : '오디오';
    const icon = r.type === 'main' ? 'film' : r.type === 'text' ? 'text' : 'music';
    return U.h('div', { class: 'tl-head tl-head-' + r.type, style: `height:${r.h}px` }, [U.icon(icon), U.h('span', null, label)]);
  }

  function clipEl(c, track, p) {
    const pps = tl.pps;
    const d = M.clipDur(c);
    const w = Math.max(3, d * pps);
    const meta = c.mediaId ? M.media(p, c.mediaId) : null;
    const rt = c.mediaId ? VE.media.get(c.mediaId) : null;
    let name;
    if (c.kind === 'text') name = (c.text || '').split('\n')[0].trim() || '(빈 텍스트)';
    else if (c.kind === 'color') name = '단색 화면';
    else name = meta ? meta.name : '미디어 없음';
    const el = U.h('div', {
      class: `clip clip-${c.kind}`,
      style: `left:${c.start * pps}px;width:${w}px`,
      dataset: { id: c.id },
      title: `${name} · ${U.fmtSec(d)}`,
    });
    if (c.id === store.selection) el.classList.add('selected');
    if (rt && (rt.status === 'missing' || rt.status === 'error')) el.classList.add('offline');
    if (c.kind === 'video' || c.kind === 'image') el.appendChild(stripEl(c, rt, w, meta));
    if (c.kind === 'color') el.style.setProperty('--swatch', c.color);
    if ((c.kind === 'audio' || c.kind === 'video') && rt && rt.peaks && w > 6) el.appendChild(waveEl(c, rt, w, track));
    const label = U.h('div', { class: 'clip-label' }, [U.h('span', { class: 'clip-name' }, name), U.h('span', { class: 'clip-dur' }, U.fmtSec(d))]);
    if (c.speed && c.speed !== 1) label.appendChild(U.h('span', { class: 'clip-badge' }, `${+c.speed.toFixed(2)}×`));
    if (c.muted) label.appendChild(U.h('span', { class: 'clip-badge' }, '음소거'));
    if (rt && rt.status === 'missing') label.appendChild(U.h('span', { class: 'clip-badge warn' }, '파일 없음'));
    el.appendChild(label);
    if (c.fadeIn > 0) el.appendChild(U.h('div', { class: 'clip-fade in', style: `width:${Math.min(w, c.fadeIn * pps)}px` }));
    if (c.fadeOut > 0) el.appendChild(U.h('div', { class: 'clip-fade out', style: `width:${Math.min(w, c.fadeOut * pps)}px` }));
    el.appendChild(U.h('div', { class: 'clip-handle l', title: '끌어서 시작 지점 조절' }));
    el.appendChild(U.h('div', { class: 'clip-handle r', title: '끌어서 끝 지점 조절' }));
    return el;
  }

  function stripEl(c, rt, w, meta) {
    const strip = U.h('div', { class: 'clip-strip' });
    if (!rt) return strip;
    const H = ROW_H.main - 2;
    const aspect = rt.aspect || (meta && meta.width && meta.height ? meta.width / meta.height : 16 / 9);
    const tw = Math.round(U.clamp(H * aspect, 30, 140));
    if (c.kind === 'image' || !rt.strip || !rt.strip.length) {
      if (rt.thumb) {
        strip.style.backgroundImage = `url("${rt.thumb}")`;
        strip.style.backgroundSize = `${tw}px 100%`;
      }
      return strip;
    }
    const n = Math.min(160, Math.ceil(w / tw));
    const step = Math.max(tw, w / Math.max(1, n));
    const mediaDur = (meta && meta.duration) || rt.duration || 1;
    for (let i = 0; i < n; i++) {
      const x = i * step;
      if (x >= w) break;
      const srcT = c.in + ((x + tw / 2) / tl.pps) * c.speed;
      const j = U.clamp(Math.round((srcT / mediaDur) * rt.strip.length - 0.5), 0, rt.strip.length - 1);
      strip.appendChild(U.h('img', { src: rt.strip[j].url, alt: '', draggable: 'false', style: `left:${x}px;width:${tw}px` }));
    }
    return strip;
  }

  function waveEl(c, rt, w, track) {
    const hgt = track === 'main' ? 18 : ROW_H.audio - 16;
    const cw = Math.max(1, Math.min(Math.ceil(w), 6000));
    const cv = U.h('canvas', { class: 'clip-wave' + (track === 'main' ? ' small' : ''), width: cw, height: hgt * 2 });
    cv.style.height = hgt + 'px';
    const ctx = cv.getContext('2d');
    const peaks = rt.peaks;
    const rate = rt.peaksRate;
    const max = rt.peaksMax || 1;
    const d = M.clipDur(c);
    const vol = c.muted ? 0.12 : U.clamp(c.volume == null ? 1 : c.volume, 0.12, 1.4);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let x = 0; x < cw; x++) {
      const t0 = c.in + (x / cw) * d * c.speed;
      const t1 = c.in + ((x + 1) / cw) * d * c.speed;
      const i0 = Math.floor(t0 * rate);
      const i1 = Math.max(i0 + 1, Math.ceil(t1 * rate));
      let m = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const hh = Math.max(0.6, Math.min(1, (m / max) * vol) * hgt * 0.95);
      ctx.fillRect(x, hgt - hh, 1, hh * 2);
    }
    return cv;
  }

  function drawRuler() {
    if (!E) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = E.rulerWrap.clientWidth;
    const hgt = E.rulerWrap.clientHeight;
    if (!w || !hgt) return;
    const cv = E.ruler;
    const bw = Math.round(w * dpr);
    const bh = Math.round(hgt * dpr);
    if (cv.width !== bw || cv.height !== bh) {
      cv.width = bw;
      cv.height = bh;
      cv.style.width = w + 'px';
      cv.style.height = hgt + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const pps = tl.pps;
    const sl = E.scroll.scrollLeft;
    const fps = store.project.fps;
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    let major = steps[steps.length - 1];
    for (const s of steps) {
      if (s * pps >= 68) {
        major = s;
        break;
      }
    }
    let minor = major;
    for (const n of [10, 5, 4, 2]) {
      if ((major / n) * pps >= 7) {
        minor = major / n;
        break;
      }
    }
    ctx.font = `500 10px ${colors.mono}`;
    ctx.textBaseline = 'top';
    ctx.lineWidth = 1;
    const i0 = Math.max(0, Math.floor(sl / pps / minor));
    const i1 = Math.ceil((sl + w) / pps / minor);
    for (let i = i0; i <= i1; i++) {
      const t = i * minor;
      const x = Math.round(t * pps - sl) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      ctx.strokeStyle = isMajor ? colors.label : colors.tick;
      ctx.beginPath();
      ctx.moveTo(x, hgt);
      ctx.lineTo(x, hgt - (isMajor ? 10 : 5));
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = colors.label;
        ctx.fillText(rulerLabel(t, major, fps), x + 4, 5);
      }
    }
  }
  function rulerLabel(t, major, fps) {
    if (major >= 1) return U.fmtClock(t);
    const s = Math.floor(t + 1e-6);
    const f = Math.round((t - s) * fps);
    return `${U.fmtClock(s)}:${String(f).padStart(2, '0')}`;
  }

  function updateWidth() {
    const total = M.duration(store.project);
    const vw = E.scroll.clientWidth || 600;
    const w = Math.max(vw, (total + 30) * tl.pps, total * tl.pps + vw * 0.6);
    E.content.style.width = Math.ceil(w) + 'px';
    E.heads.style.paddingBottom = Math.max(0, E.scroll.offsetHeight - E.scroll.clientHeight) + 'px';
  }

  function placePlayhead(t) {
    if (!E) return;
    const x = t * tl.pps;
    E.playhead.style.transform = `translateX(${x}px)`;
    if (engine.playing && !tl.drag) {
      const sl = E.scroll.scrollLeft;
      const vw = E.scroll.clientWidth;
      if (x > sl + vw - 30 || x < sl) E.scroll.scrollLeft = Math.max(0, x - vw * 0.2);
    }
    placeRulerHead();
  }
  function placeRulerHead() {
    const x = engine.time * tl.pps - E.scroll.scrollLeft;
    E.rulerHead.style.transform = `translateX(${x}px)`;
    const hide = x < -12 || x > E.rulerWrap.clientWidth + 12;
    if (E.rulerHead.hidden !== hide) E.rulerHead.hidden = hide;
  }
  tl.ensureVisible = function (t) {
    const x = t * tl.pps;
    const sl = E.scroll.scrollLeft;
    const vw = E.scroll.clientWidth;
    if (x < sl + 20 || x > sl + vw - 20) E.scroll.scrollLeft = Math.max(0, x - vw * 0.3);
  };

  function markSelection() {
    if (!E) return;
    for (const n of E.rows.querySelectorAll('.clip')) n.classList.toggle('selected', n.dataset.id === store.selection);
  }

  function updateZoomUI() {
    E.zoom.value = String(Math.round(ppsToSlider(tl.pps)));
    const span = (E.scroll.clientWidth || 0) / tl.pps;
    E.zoomLabel.textContent = span > 0 ? `화면 폭 ${U.fmtClock(span)}` : '';
  }

  // ---------- 좌표·자석 ----------
  const timeAtX = (x) => Math.max(0, (x - E.content.getBoundingClientRect().left) / tl.pps);
  function rowAtY(y) {
    const rows = tl.rows;
    if (!rows.length) return null;
    for (const r of rows) {
      const rr = r.el.getBoundingClientRect();
      if (y >= rr.top && y < rr.bottom) return r;
    }
    return y < rows[0].el.getBoundingClientRect().top ? rows[0] : rows[rows.length - 1];
  }
  function snapTargets(exclude, mainBefore) {
    const p = store.project;
    const arr = [0, engine.time];
    const add = (c) => {
      if (!exclude.has(c.id)) arr.push(c.start, M.clipEnd(c));
    };
    p.main.forEach((c, i) => {
      if (mainBefore == null || i < mainBefore) add(c);
    });
    p.texts.forEach(add);
    p.audio.forEach(add);
    return arr;
  }
  function snapValue(t, targets) {
    if (!tl.snap) return { t, hit: null };
    let best = null;
    let bd = SNAP_PX / tl.pps;
    for (const s of targets) {
      const d = Math.abs(s - t);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best == null ? { t, hit: null } : { t: best, hit: best };
  }
  function showSnap(t) {
    if (t == null) {
      E.snap.hidden = true;
      return;
    }
    E.snap.hidden = false;
    E.snap.style.transform = `translateX(${t * tl.pps}px)`;
  }
  function showInsert(x) {
    if (x == null) {
      E.insert.hidden = true;
      return;
    }
    const main = tl.rows.find((r) => r.type === 'main');
    E.insert.hidden = false;
    E.insert.style.top = main.top + 'px';
    E.insert.style.height = main.h + 'px';
    E.insert.style.transform = `translateX(${x}px)`;
  }
  function autoScroll(x) {
    const r = E.scroll.getBoundingClientRect();
    if (x < r.left + 32) E.scroll.scrollLeft -= 14;
    else if (x > r.right - 32) E.scroll.scrollLeft += 14;
  }
  function insertIndexAt(list, t) {
    let acc = 0;
    let idx = 0;
    for (const c of list) {
      const d = M.clipDur(c);
      if (t > acc + d / 2) {
        idx++;
        acc += d;
      } else break;
    }
    return { index: idx, time: acc };
  }

  // ---------- 포인터 조작 ----------
  function track(onMove, onUp, onCancel) {
    const el = E.content;
    const move = (ev) => onMove(ev);
    const up = (ev) => {
      done();
      onUp(ev);
    };
    const cancel = (ev) => {
      done();
      (onCancel || onUp)(ev, true);
    };
    function done() {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  }

  function onRulerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (engine.playing) engine.pause();
    const seekTo = (x) => {
      const r = E.rulerWrap.getBoundingClientRect();
      engine.seek((x - r.left + E.scroll.scrollLeft) / tl.pps);
    };
    seekTo(e.clientX);
    const el = E.rulerWrap;
    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {}
    const move = (ev) => seekTo(ev.clientX);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function onContentDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const node = e.target.closest('.clip');
    if (!node) return emptyDown(e);
    const f = M.find(store.project, node.dataset.id);
    if (!f) return;
    const handle = e.target.closest('.clip-handle');
    store.select(f.clip.id);
    if (handle) {
      e.preventDefault();
      startTrim(e, f, handle.classList.contains('l') ? 'l' : 'r');
      return;
    }
    if (e.pointerType === 'touch') {
      touchHold(e, f, node);
      return;
    }
    e.preventDefault();
    startMove(e, f, node, false);
  }

  function emptyDown(e) {
    if (e.pointerType === 'touch') {
      const x0 = e.clientX;
      const y0 = e.clientY;
      let far = false;
      const move = (ev) => {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) far = true;
      };
      const end = (ev, cancelled) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', cancel);
        if (!cancelled && !far) {
          store.select(null);
          engine.seek(timeAtX(ev.clientX));
        }
      };
      const cancel = (ev) => end(ev, true);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', cancel);
      return;
    }
    e.preventDefault();
    store.select(null);
    if (engine.playing) engine.pause();
    engine.seek(timeAtX(e.clientX));
    try {
      E.content.setPointerCapture(e.pointerId);
    } catch (err) {}
    track((ev) => {
      autoScroll(ev.clientX);
      engine.seek(timeAtX(ev.clientX));
    }, () => {});
  }

  /** 터치: 길게 누르면 클립을 옮긴다(짧게 끌면 화면 스크롤) */
  function touchHold(e, f, node) {
    const x0 = e.clientX;
    const y0 = e.clientY;
    const pid = e.pointerId;
    let timer = setTimeout(() => {
      timer = 0;
      cleanup();
      try {
        if (navigator.vibrate) navigator.vibrate(12);
      } catch (err) {}
      startMove({ clientX: x0, clientY: y0, pointerId: pid }, f, node, true);
    }, 380);
    const move = (ev) => {
      if (timer && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) {
        clearTimeout(timer);
        timer = 0;
        cleanup();
      }
    };
    const up = () => {
      if (timer) clearTimeout(timer);
      timer = 0;
      cleanup();
    };
    function cleanup() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startMove(e, f, node, isTouch) {
    const p = store.project;
    const clip = f.clip;
    const id = clip.id;
    const kind = f.track;
    const dur = M.clipDur(clip);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const sl0 = E.scroll.scrollLeft;
    const startRow = tl.rows.find((r) => r.type === kind && r.lane === (kind === 'main' ? 0 : clip.lane));
    let moved = !!isTouch;
    let insertIndex = f.index;
    let newStart = clip.start;
    let lane = clip.lane;
    const targets = kind === 'main' ? null : snapTargets(new Set([id]));
    const others = kind === 'main' ? p.main.filter((c) => c.id !== id) : null;
    tl.drag = { active: !!isTouch, id };
    if (isTouch) node.classList.add('dragging');
    try {
      E.content.setPointerCapture(e.pointerId);
    } catch (err) {}
    track(
      (ev) => {
        if (!moved) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
          moved = true;
          tl.drag.active = true;
          node.classList.add('dragging');
        }
        autoScroll(ev.clientX);
        const dx = ev.clientX - x0 + (E.scroll.scrollLeft - sl0);
        if (kind === 'main') {
          node.style.transform = `translateX(${dx}px)`;
          const ins = insertIndexAt(others, timeAtX(ev.clientX));
          insertIndex = ins.index;
          showInsert(ins.time * tl.pps);
        } else {
          let s = Math.max(0, clip.start + dx / tl.pps);
          const a = snapValue(s, targets);
          const b = snapValue(s + dur, targets);
          let hit = null;
          if (a.hit != null && (b.hit == null || Math.abs(a.t - s) <= Math.abs(b.t - s - dur))) {
            s = a.t;
            hit = a.hit;
          } else if (b.hit != null) {
            s = b.t - dur;
            hit = b.hit;
          }
          newStart = Math.max(0, s);
          node.style.left = newStart * tl.pps + 'px';
          showSnap(hit);
          const r = rowAtY(ev.clientY);
          if (r && r.type === kind) lane = r.lane;
          const target = tl.rows.find((x) => x.type === kind && x.lane === lane) || startRow;
          node.style.transform = `translateY(${target.top - startRow.top}px)`;
        }
      },
      (ev, cancelled) => {
        node.classList.remove('dragging');
        node.style.transform = '';
        showInsert(null);
        showSnap(null);
        tl.drag = null;
        if (!moved) return;
        if (cancelled) {
          tl.render();
          return;
        }
        let changed = false;
        if (kind === 'main') {
          if (insertIndex !== f.index) {
            changed = store.commit((pp) => {
              const i = pp.main.findIndex((c) => c.id === id);
              if (i < 0) return;
              const [c] = pp.main.splice(i, 1);
              pp.main.splice(insertIndex, 0, c);
            });
          }
        } else {
          changed = store.commit((pp) => {
            const g = M.find(pp, id);
            if (!g) return;
            g.clip.start = newStart;
            g.clip.lane = M.freeLane(g.list, newStart, newStart + dur, lane, id);
          });
        }
        if (!changed) tl.render();
      }
    );
  }

  /** 길이 조절 결과 값 */
  function trimParams(c0, side, dt, mediaDur) {
    const MIN = M.MIN;
    const sp = c0.speed || 1;
    const d0 = M.clipDur(c0);
    if (c0.kind === 'text') {
      if (side === 'l') {
        const d = U.clamp(dt, -c0.start, d0 - MIN);
        return { start: c0.start + d, duration: d0 - d };
      }
      return { duration: Math.max(MIN, d0 + dt) };
    }
    if (c0.kind === 'image' || c0.kind === 'color') {
      const d = side === 'l' ? -dt : dt;
      return { out: Math.max(MIN, c0.out + d) };
    }
    if (side === 'l') {
      let dIn = U.clamp(dt * sp, -c0.in, c0.out - c0.in - MIN * sp);
      if (c0.kind === 'audio' && c0.start + dIn / sp < 0) dIn = -c0.start * sp;
      const r = { in: c0.in + dIn };
      if (c0.kind === 'audio') r.start = c0.start + dIn / sp;
      return r;
    }
    const dOut = U.clamp(dt * sp, c0.in + MIN * sp - c0.out, mediaDur - c0.out);
    return { out: c0.out + dOut };
  }

  function startTrim(e, f, side) {
    const p = store.project;
    const c0 = U.clone(f.clip);
    const id = c0.id;
    const kind = f.track;
    const meta = c0.mediaId ? M.media(p, c0.mediaId) : null;
    const mediaDur = c0.kind === 'video' || c0.kind === 'audio' ? (meta && meta.duration > 0 ? meta.duration : c0.out) : Infinity;
    const x0 = e.clientX;
    const sl0 = E.scroll.scrollLeft;
    const d0 = M.clipDur(c0);
    const targets = snapTargets(new Set([id]), kind === 'main' ? f.index : null);
    if (engine.playing) engine.pause();
    tl.drag = { active: true, id, trim: true };
    try {
      E.content.setPointerCapture(e.pointerId);
    } catch (err) {}
    let pending = null;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const ev = pending;
      if (!ev) return;
      pending = null;
      let dt = (ev.clientX - x0 + (E.scroll.scrollLeft - sl0)) / tl.pps;
      let hit = null;
      if (kind !== 'main' || side === 'r') {
        const edge0 = side === 'l' ? c0.start : c0.start + d0;
        const sv = snapValue(edge0 + dt, targets);
        if (sv.hit != null) {
          dt = sv.t - edge0;
          hit = sv.hit;
        }
      }
      const np = trimParams(c0, side, dt, mediaDur);
      showSnap(hit);
      store.commit((pp) => {
        const g = M.find(pp, id);
        if (g) Object.assign(g.clip, np);
      }, { coalesce: 'trim:' + id + side });
      if (kind === 'main') {
        const g = M.find(store.project, id);
        if (g) engine.seek(side === 'l' ? g.clip.start : Math.max(g.clip.start, M.clipEnd(g.clip) - 1 / store.project.fps));
      }
      autoScroll(ev.clientX);
    };
    track(
      (ev) => {
        pending = ev;
        if (!raf) raf = requestAnimationFrame(apply);
      },
      () => {
        if (raf) {
          cancelAnimationFrame(raf);
          apply();
        }
        tl.drag = null;
        showSnap(null);
        store.endCoalesce();
        tl.render();
      }
    );
  }

  function onDblClick(e) {
    const node = e.target.closest('.clip');
    if (!node) return;
    const f = M.find(store.project, node.dataset.id);
    if (f && f.clip.kind === 'text' && VE.inspector) VE.inspector.focusText();
  }

  function onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.06 : 0.0025));
      setZoom(tl.pps * k, e.clientX);
      return;
    }
    if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && E.scroll.scrollHeight <= E.scroll.clientHeight + 2) {
      e.preventDefault();
      E.scroll.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 30 : 1);
    }
  }

  function setZoom(pps, clientX) {
    pps = U.clamp(pps, tl.minPps, tl.maxPps);
    if (Math.abs(pps - tl.pps) < 1e-9) return;
    const r = E.scroll.getBoundingClientRect();
    const ax = clientX != null ? clientX - r.left : U.clamp(engine.time * tl.pps - E.scroll.scrollLeft, 0, r.width);
    const at = (E.scroll.scrollLeft + ax) / tl.pps;
    tl.pps = pps;
    tl.render();
    E.scroll.scrollLeft = Math.max(0, at * pps - ax);
    drawRuler();
    placeRulerHead();
  }
  tl.zoomBy = (k) => setZoom(tl.pps * k);
  tl.zoomFit = function () {
    if (!E) return;
    const total = M.duration(store.project);
    const vw = (E.scroll.clientWidth || 600) - 28;
    setZoom(total > 0 ? vw / total : 60);
    E.scroll.scrollLeft = 0;
    drawRuler();
    placeRulerHead();
  };
  tl.setSnap = (v) => {
    tl.snap = !!v;
  };

  // ---------- 미디어 목록에서 끌어 놓기 ----------
  function dropInfo(e) {
    const p = store.project;
    const meta = M.media(p, VE.dragMediaId);
    if (!meta) return null;
    const r = rowAtY(e.clientY);
    const t = timeAtX(e.clientX);
    if (meta.type === 'audio' || (meta.type === 'video' && r && r.type === 'audio')) {
      const sv = snapValue(t, snapTargets(new Set()));
      return { kind: 'audio', time: sv.t, hit: sv.hit, lane: r && r.type === 'audio' ? r.lane : 0 };
    }
    const ins = insertIndexAt(p.main, t);
    return { kind: 'main', index: ins.index, x: ins.time * tl.pps };
  }
  function onDragOver(e) {
    if (!VE.dragMediaId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const info = dropInfo(e);
    if (!info) return;
    if (info.kind === 'main') {
      showSnap(null);
      showInsert(info.x);
    } else {
      showInsert(null);
      showSnap(info.time);
    }
  }
  function clearDrop() {
    showInsert(null);
    showSnap(null);
  }
  tl.clearDrop = clearDrop;
  function onDrop(e) {
    const id = VE.dragMediaId;
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    const info = dropInfo(e);
    clearDrop();
    VE.dragMediaId = null;
    if (!info) return;
    if (info.kind === 'main') VE.actions.addMedia(id, { index: info.index });
    else VE.actions.addMedia(id, { time: info.time, lane: info.lane, asAudio: true });
  }

  tl.init = function () {
    E = {
      rulerWrap: U.$('#tlRulerWrap'),
      ruler: U.$('#tlRuler'),
      rulerHead: U.$('#tlRulerHead'),
      heads: U.$('#tlHeads'),
      scroll: U.$('#tlScroll'),
      content: U.$('#tlContent'),
      rows: U.$('#tlRows'),
      snap: U.$('#tlSnap'),
      insert: U.$('#tlInsert'),
      playhead: U.$('#tlPlayhead'),
      zoom: U.$('#zoomRange'),
      zoomLabel: U.$('#zoomLabel'),
    };
    readColors();
    E.scroll.addEventListener('scroll', () => {
      E.heads.scrollTop = E.scroll.scrollTop;
      drawRuler();
      placeRulerHead();
    }, { passive: true });
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        updateWidth();
        drawRuler();
        placeRulerHead();
        updateZoomUI();
      }).observe(E.scroll);
    }
    E.rulerWrap.addEventListener('pointerdown', onRulerDown);
    E.content.addEventListener('pointerdown', onContentDown);
    E.content.addEventListener('dblclick', onDblClick);
    E.scroll.addEventListener('wheel', onWheel, { passive: false });
    E.heads.addEventListener('wheel', (e) => {
      E.scroll.scrollTop += e.deltaY;
    }, { passive: true });
    E.content.addEventListener('dragover', onDragOver);
    E.content.addEventListener('dragleave', (e) => {
      if (!E.content.contains(e.relatedTarget)) clearDrop();
    });
    E.content.addEventListener('drop', onDrop);
    E.content.addEventListener('touchmove', (e) => {
      if (tl.drag && tl.drag.active) e.preventDefault();
    }, { passive: false });
    E.zoom.addEventListener('input', () => setZoom(sliderToPps(+E.zoom.value)));
    store.on('change', () => tl.render());
    store.on('select', markSelection);
    engine.on('time', placePlayhead);
    VE.media.on('update', U.debounce(() => {
      if (!tl.drag) tl.render();
    }, 150));
    tl.render();
  };

  VE.timeline = tl;
})();
