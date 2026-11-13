/* 싹둑 영상 편집기 — 내보내기: 캔버스와 오디오를 MediaRecorder로 실시간 녹화 */
(function () {
  'use strict';
  const VE = window.VE;
  const U = VE.U;
  const M = VE.M;
  const store = VE.store;
  const engine = VE.engine;
  const h = U.h;

  const CANDIDATES = [
    { ext: 'mp4', mime: 'video/mp4;codecs="avc1.640028,mp4a.40.2"' },
    { ext: 'mp4', mime: 'video/mp4;codecs="avc1.4d002a,mp4a.40.2"' },
    { ext: 'mp4', mime: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"' },
    { ext: 'mp4', mime: 'video/mp4;codecs=avc1,mp4a.40.2' },
    { ext: 'mp4', mime: 'video/mp4' },
    { ext: 'webm', mime: 'video/webm;codecs=vp9,opus' },
    { ext: 'webm', mime: 'video/webm;codecs=vp8,opus' },
    { ext: 'webm', mime: 'video/webm' },
  ];
  const FORMAT_INFO = {
    mp4: { label: 'MP4', hint: '휴대폰·메신저·유튜브 어디서나 재생됩니다' },
    webm: { label: 'WebM', hint: '용량 대비 화질이 좋지만 아이폰 등 일부 기기에서는 재생되지 않을 수 있습니다' },
  };
  const QUALITY = [
    { id: 'high', label: '높음', bpp: 0.16 },
    { id: 'normal', label: '보통', bpp: 0.1 },
    { id: 'low', label: '낮음', bpp: 0.055 },
  ];

  function supportedFormats() {
    if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return [];
    const found = {};
    for (const c of CANDIDATES) {
      try {
        if (!found[c.ext] && MediaRecorder.isTypeSupported(c.mime)) found[c.ext] = c;
      } catch (e) {}
    }
    return ['mp4', 'webm'].filter((e) => found[e]).map((e) => Object.assign({}, found[e], FORMAT_INFO[e]));
  }
  const canCapture = () => typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';

  function resOptions(p) {
    const short = Math.min(p.width, p.height);
    return [1080, 720, 480].map((s) => {
      const k = s / short;
      return { id: String(s), label: s + 'p', w: U.even(p.width * k), h: U.even(p.height * k) };
    });
  }
  const safeName = (s) => (String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '싹둑 영상');
  const baseMime = (m) => m.split(';')[0];

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem('ssakdook.export') || '{}') || {};
    } catch (e) {
      return {};
    }
  }
  function savePrefs(o) {
    try {
      localStorage.setItem('ssakdook.export', JSON.stringify(o));
    } catch (e) {}
  }

  // ---------- WebM 길이 정보 넣기 ----------
  // 브라우저가 녹화한 WebM에는 전체 길이 정보가 없어 일부 플레이어에서 탐색이 안 된다.
  function encodeSize(value, len) {
    if (len < 1 || len > 8 || value >= Math.pow(2, 7 * len) - 1) return null;
    const out = new Uint8Array(len);
    let v = value;
    for (let i = len - 1; i >= 0; i--) {
      out[i] = v % 256;
      v = Math.floor(v / 256);
    }
    out[0] |= 0x80 >> (len - 1);
    return out;
  }
  async function fixWebmDuration(blob, ms) {
    try {
      const headLen = Math.min(blob.size, 256 * 1024);
      const buf = new Uint8Array(await blob.slice(0, headLen).arrayBuffer());
      const readId = (pos) => {
        const b = buf[pos];
        if (b === undefined) return null;
        let len = 1;
        let mask = 0x80;
        while (len <= 4 && !(b & mask)) {
          len++;
          mask >>= 1;
        }
        if (len > 4 || pos + len > buf.length) return null;
        let id = 0;
        for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
        return { id, len };
      };
      const readSize = (pos) => {
        const b = buf[pos];
        if (b === undefined) return null;
        let len = 1;
        let mask = 0x80;
        while (len <= 8 && !(b & mask)) {
          len++;
          mask >>= 1;
        }
        if (len > 8 || pos + len > buf.length) return null;
        let v = b & (mask - 1);
        let ones = v === mask - 1;
        for (let i = 1; i < len; i++) {
          const x = buf[pos + i];
          v = v * 256 + x;
          if (x !== 0xff) ones = false;
        }
        return { value: v, len, unknown: ones };
      };
      let pos = 0;
      let e = readId(pos);
      if (!e || e.id !== 0x1a45dfa3) return blob;
      let s = readSize(pos + e.len);
      if (!s || s.unknown) return blob;
      pos += e.len + s.len + s.value;
      e = readId(pos);
      if (!e || e.id !== 0x18538067) return blob;
      const segSizePos = pos + e.len;
      const seg = readSize(segSizePos);
      if (!seg) return blob;
      pos = segSizePos + seg.len;
      while (pos < buf.length) {
        const ce = readId(pos);
        if (!ce) return blob;
        const cs = readSize(pos + ce.len);
        if (!cs) return blob;
        const dataStart = pos + ce.len + cs.len;
        if (ce.id === 0x114d9b74) return blob; // SeekHead가 있으면 위치 정보가 어긋나므로 그대로 둔다
        if (ce.id === 0x1549a966) {
          if (cs.unknown) return blob;
          const dataEnd = dataStart + cs.value;
          if (dataEnd > buf.length) return blob;
          let scale = 1000000;
          let durPos = -1;
          let durLen = 0;
          let q = dataStart;
          while (q < dataEnd) {
            const ie = readId(q);
            if (!ie) return blob;
            const is = readSize(q + ie.len);
            if (!is || is.unknown) return blob;
            const d0 = q + ie.len + is.len;
            if (ie.id === 0x2ad7b1) {
              let v = 0;
              for (let i = 0; i < is.value; i++) v = v * 256 + buf[d0 + i];
              scale = v || 1000000;
            } else if (ie.id === 0x4489) {
              durPos = q;
              durLen = ie.len + is.len + is.value;
            }
            q = d0 + is.value;
          }
          const durEl = new Uint8Array(11);
          durEl[0] = 0x44;
          durEl[1] = 0x89;
          durEl[2] = 0x88;
          new DataView(durEl.buffer).setFloat64(3, (ms * 1e6) / scale);
          const before = buf.subarray(dataStart, durPos >= 0 ? durPos : dataEnd);
          const after = durPos >= 0 ? buf.subarray(durPos + durLen, dataEnd) : new Uint8Array(0);
          const newSize = before.length + after.length + durEl.length;
          const sizeBytes = encodeSize(newSize, cs.len) || encodeSize(newSize, 8);
          const delta = ce.len + sizeBytes.length + newSize - (dataEnd - pos);
          const parts = [];
          if (!seg.unknown) {
            const ns = encodeSize(seg.value + delta, seg.len);
            if (!ns) return blob;
            parts.push(buf.subarray(0, segSizePos), ns, buf.subarray(segSizePos + seg.len, pos));
          } else {
            parts.push(buf.subarray(0, pos));
          }
          parts.push(buf.subarray(pos, pos + ce.len), sizeBytes, before, durEl, after, buf.subarray(dataEnd));
          if (blob.size > headLen) parts.push(blob.slice(headLen));
          return new Blob(parts, { type: blob.type });
        }
        if (ce.id === 0x1f43b675 || cs.unknown) return blob;
        pos = dataStart + cs.value;
      }
      return blob;
    } catch (err) {
      return blob;
    }
  }

  // ---------- 녹화 ----------
  async function record(cfg, view) {
    const p = store.project;
    const total = M.duration(p);
    const canvas = view.canvas;
    canvas.width = cfg.w;
    canvas.height = cfg.h;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cfg.w, cfg.h);
    await VE.fonts.ensureAll(p);

    const actx = engine.audio();
    let dest = null;
    if (actx) {
      try {
        if (actx.state !== 'running') await actx.resume();
      } catch (e) {}
      try {
        dest = actx.createMediaStreamDestination();
        engine.master.connect(dest);
      } catch (e) {
        dest = null;
      }
    }
    const vStream = canvas.captureStream(cfg.fps);
    const tracks = vStream.getVideoTracks().slice();
    if (dest) tracks.push(...dest.stream.getAudioTracks());
    const stream = new MediaStream(tracks);
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: cfg.format.mime, videoBitsPerSecond: cfg.vbps, audioBitsPerSecond: 160000 });
    } catch (e) {
      rec = new MediaRecorder(stream, { mimeType: cfg.format.mime });
    }
    const chunks = [];
    let recError = null;
    let finish = null;
    const ended = new Promise((resolve) => {
      finish = resolve;
    });
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) chunks.push(ev.data);
    };
    rec.onerror = (ev) => {
      recError = (ev && ev.error) || new Error('녹화 중 오류가 났습니다');
      finish('error');
    };
    const stopped = new Promise((resolve) => {
      rec.onstop = resolve;
    });
    const offEnd = engine.once('ended', () => finish('done'));
    view.onCancel = () => finish('cancel');

    let stallAt = 0;
    let recMs = 0;
    let lastResume = 0;
    const startWall = performance.now();
    engine.beginExport({
      ctx, w: cfg.w, h: cfg.h, listen: cfg.listen,
      onFrame: (t, stalled) => {
        const now = performance.now();
        const ex = engine.exporting;
        if (stalled) {
          if (!stallAt) stallAt = now;
          else if (rec.state === 'recording' && now - stallAt > 150) {
            rec.pause();
            recMs += now - lastResume;
            if (ex) ex.paused = true;
          }
        } else {
          stallAt = 0;
          if (rec.state === 'paused') {
            rec.resume();
            lastResume = now;
            if (ex) ex.paused = false;
          }
        }
        view.progress(t, total, now - startWall);
      },
    });
    let result = 'error';
    try {
      await engine.prepareAt(0);
      engine.renderFrame(engine.exporting, 0, false);
      rec.start(1000);
      lastResume = performance.now();
      if (!engine.play()) finish('done');
      result = await ended;
      if (rec.state === 'recording') recMs += performance.now() - lastResume;
      engine.pause();
      if (result === 'done') await U.sleep(60);
      if (rec.state !== 'inactive') rec.stop();
      await Promise.race([stopped, U.sleep(5000)]);
    } finally {
      offEnd();
      engine.endExport();
      if (dest) {
        try {
          engine.master.disconnect(dest);
        } catch (e) {}
      }
      tracks.forEach((t) => t.stop());
    }
    if (result === 'cancel') return { cancelled: true };
    if (recError) throw recError;
    if (!chunks.length) throw new Error('녹화된 데이터가 없습니다');
    let blob = new Blob(chunks, { type: baseMime(cfg.format.mime) });
    if (cfg.format.ext === 'webm') blob = await fixWebmDuration(blob, recMs > 0 ? recMs : total * 1000);
    return { blob, duration: total };
  }

  // ---------- 대화상자 ----------
  function segRow(label, id, options, value, onChange) {
    const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    options.forEach((o) => {
      const on = o.id === value;
      const b = h('button', { type: 'button', class: 'seg-btn' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), id: `${id}-${o.id}`, title: o.title || null }, o.label);
      b.addEventListener('click', () => {
        for (const x of wrap.children) {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-checked', String(x === b));
        }
        onChange(o.id);
      });
      wrap.appendChild(b);
    });
    return h('div', { class: 'ex-row' }, [h('span', { class: 'ex-label' }, label), wrap]);
  }

  function unsupported() {
    U.modal({
      title: '이 브라우저에서는 내보낼 수 없습니다',
      body: h('p', { class: 'modal-text' }, '영상 녹화 기능(MediaRecorder)을 지원하지 않는 브라우저입니다. 최신 Chrome, Edge, Safari 또는 Firefox에서 다시 열어 주세요.'),
      actions: [{ label: '닫기', primary: true, onClick: (m) => m.close() }],
    });
  }

  function open() {
    if (engine.exporting) return;
    const p = store.project;
    const total = M.duration(p);
    if (total <= 0) {
      U.toast('타임라인이 비어 있습니다. 먼저 클립을 추가하세요.', { type: 'warn' });
      return;
    }
    const formats = supportedFormats();
    if (!formats.length || !canCapture()) {
      unsupported();
      return;
    }
    engine.pause();
    const prefs = loadPrefs();
    const res = resOptions(p);
    const cfg = {
      format: formats.find((f) => f.ext === prefs.fmt) || formats[0],
      res: res.find((r) => r.id === prefs.res) || res[0],
      quality: QUALITY.find((q) => q.id === prefs.q) || QUALITY[1],
      fps: [24, 25, 30, 60].includes(prefs.fps) ? prefs.fps : p.fps,
      listen: !!prefs.listen,
    };
    const missing = p.media.filter((m) => {
      const rt = VE.media.get(m.id);
      const used = p.main.some((c) => c.mediaId === m.id) || p.audio.some((c) => c.mediaId === m.id);
      return used && (!rt || rt.status !== 'ready');
    });

    const nameInp = h('input', { type: 'text', id: 'exName', value: safeName(p.name), maxlength: '80', spellcheck: 'false', autocomplete: 'off' });
    const extEl = h('span', { class: 'ex-ext' }, '.' + cfg.format.ext);
    const fmtHint = h('p', { class: 'ex-hint' }, cfg.format.hint);
    const est = h('p', { class: 'ex-est' });
    const updateEst = () => {
      const vbps = U.clamp(Math.round(cfg.res.w * cfg.res.h * cfg.fps * cfg.quality.bpp), 800000, 40000000);
      cfg.vbps = vbps;
      const bytes = ((vbps + 160000) * total) / 8;
      est.textContent = `${cfg.res.w}×${cfg.res.h} · ${cfg.fps}fps · 예상 크기 약 ${U.fmtBytes(bytes)} · 걸리는 시간 약 ${U.fmtClock(total)}`;
      extEl.textContent = '.' + cfg.format.ext;
      fmtHint.textContent = cfg.format.hint;
    };
    const listen = h('input', { type: 'checkbox', id: 'exListen', checked: cfg.listen ? true : null });
    listen.addEventListener('change', () => {
      cfg.listen = listen.checked;
    });
    const settings = h('div', { class: 'ex-settings' }, [
      h('div', { class: 'ex-row' }, [h('label', { class: 'ex-label', for: 'exName' }, '파일 이름'), h('div', { class: 'ex-name' }, [nameInp, extEl])]),
      segRow('형식', 'exFmt', formats.map((f) => ({ id: f.ext, label: f.label })), cfg.format.ext, (v) => {
        cfg.format = formats.find((f) => f.ext === v);
        updateEst();
      }),
      fmtHint,
      segRow('해상도', 'exRes', res.map((r) => ({ id: r.id, label: r.label, title: `${r.w}×${r.h}` })), cfg.res.id, (v) => {
        cfg.res = res.find((r) => r.id === v);
        updateEst();
      }),
      segRow('프레임', 'exFps', [24, 30, 60].map((n) => ({ id: String(n), label: n + 'fps' })), String(cfg.fps === 25 ? 24 : cfg.fps), (v) => {
        cfg.fps = +v;
        updateEst();
      }),
      segRow('화질', 'exQ', QUALITY.map((q) => ({ id: q.id, label: q.label })), cfg.quality.id, (v) => {
        cfg.quality = QUALITY.find((q) => q.id === v);
        updateEst();
      }),
      est,
      h('label', { class: 'insp-toggle', for: 'exListen' }, [listen, h('span', { class: 'sw', 'aria-hidden': 'true' }), h('span', null, '내보내는 동안 소리 듣기')]),
      missing.length ? h('p', { class: 'ex-warn' }, [U.icon('warn'), `파일을 찾을 수 없는 미디어가 ${missing.length}개 있습니다. 그 부분은 안내 화면으로 녹화됩니다.`]) : null,
      h('p', { class: 'ex-note' }, '내보내기는 영상을 처음부터 끝까지 실제 속도로 재생하며 녹화합니다. 끝날 때까지 이 탭을 화면에 띄워 두세요.'),
    ]);
    if (cfg.fps === 25) cfg.fps = 24;
    updateEst();

    const canvas = h('canvas', { class: 'ex-canvas', 'aria-label': '내보내기 화면' });
    const bar = h('div', { class: 'ex-bar' }, [h('div', { class: 'ex-bar-fill' })]);
    const pText = h('p', { class: 'ex-ptext' }, '준비하는 중…');
    const progressView = h('div', { class: 'ex-progress', hidden: true }, [h('div', { class: 'ex-canvas-wrap' }, [canvas]), bar, pText]);
    const resultView = h('div', { class: 'ex-result', hidden: true });
    const errorView = h('div', { class: 'ex-error', hidden: true });
    const bodyEl = h('div', { class: 'ex-body' }, [settings, progressView, resultView, errorView]);
    let outUrl = null;
    let running = false;

    const m = U.modal({
      title: '영상 내보내기',
      wide: true,
      body: bodyEl,
      onClose: () => {
        if (outUrl) URL.revokeObjectURL(outUrl);
        if (running && view.onCancel) view.onCancel();
      },
    });

    const view = {
      canvas,
      onCancel: null,
      progress(t, tot, elapsed) {
        const r = tot > 0 ? U.clamp(t / tot, 0, 1) : 0;
        bar.firstChild.style.width = (r * 100).toFixed(1) + '%';
        bar.setAttribute('aria-valuenow', String(Math.round(r * 100)));
        const left = r > 0.02 ? (elapsed / r) * (1 - r) / 1000 : tot - t;
        pText.textContent = `${U.fmtClock(t)} / ${U.fmtClock(tot)} · ${Math.round(r * 100)}% · 남은 시간 약 ${U.fmtClock(Math.max(0, left))}`;
      },
    };
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');

    function showSettings() {
      settings.hidden = false;
      progressView.hidden = true;
      resultView.hidden = true;
      errorView.hidden = true;
      m.setTitle('영상 내보내기');
      m.setDismissable(true);
      m.setActions([
        { label: '취소', ghost: true, onClick: () => m.close() },
        { label: '내보내기 시작', primary: true, icon: 'download', id: 'exStart', onClick: start },
      ]);
    }

    async function start() {
      engine.unlock(); // 클릭 안에서 오디오·미디어 재생 잠금 해제
      cfg.name = safeName(nameInp.value);
      savePrefs({ fmt: cfg.format.ext, res: cfg.res.id, q: cfg.quality.id, fps: cfg.fps, listen: cfg.listen });
      settings.hidden = true;
      progressView.hidden = false;
      m.setTitle('내보내는 중');
      m.setDismissable(false);
      m.setActions([{ label: '중지', danger: true, onClick: () => view.onCancel && view.onCancel() }]);
      pText.textContent = '준비하는 중…';
      bar.firstChild.style.width = '0%';
      running = true;
      let out;
      try {
        out = await record({ format: cfg.format, w: cfg.res.w, h: cfg.res.h, fps: cfg.fps, vbps: cfg.vbps, listen: cfg.listen }, view);
      } catch (err) {
        running = false;
        console.error(err);
        progressView.hidden = true;
        errorView.hidden = false;
        errorView.textContent = '';
        errorView.append(h('p', { class: 'modal-text' }, '내보내기에 실패했습니다: ' + (err && err.message ? err.message : err)), h('p', { class: 'ex-note' }, '해상도를 낮추거나 다른 형식을 골라 다시 시도해 보세요.'));
        m.setTitle('내보내기 실패');
        m.setDismissable(true);
        m.setActions([{ label: '닫기', ghost: true, onClick: () => m.close() }, { label: '설정으로 돌아가기', primary: true, onClick: showSettings }]);
        return;
      }
      running = false;
      if (out.cancelled) {
        U.toast('내보내기를 중지했습니다');
        showSettings();
        return;
      }
      showResult(out);
    }

    function showResult(out) {
      progressView.hidden = true;
      resultView.hidden = false;
      if (outUrl) URL.revokeObjectURL(outUrl);
      outUrl = URL.createObjectURL(out.blob);
      const filename = `${cfg.name}.${cfg.format.ext}`;
      const status = h('p', { class: 'ex-status', role: 'status' });
      resultView.textContent = '';
      resultView.append(
        h('video', { class: 'ex-video', src: outUrl, controls: true, playsinline: true }),
        h('p', { class: 'ex-file' }, [h('strong', null, filename), h('span', null, ` · ${U.fmtSec(out.duration)} · ${U.fmtBytes(out.blob.size)}`)]),
        status
      );
      m.setTitle('내보내기 완료');
      m.setDismissable(true);
      const save = async () => {
        const r = await U.saveFile(out.blob, filename);
        if (r === 'saved') {
          status.textContent = '저장했습니다. 브라우저의 다운로드 목록을 확인하세요.';
        } else if (r === 'declined') status.textContent = '저장을 취소했습니다.';
        else if (r === 'busy') status.textContent = '저장 창이 이미 열려 있습니다. 잠시 뒤 다시 눌러 주세요.';
        else if (r === 'too_large') status.textContent = '파일이 너무 커서 이 앱에서는 저장할 수 없습니다. 해상도나 화질을 낮춰 다시 내보내 보세요.';
        else status.textContent = '이 화면에서는 파일 저장을 지원하지 않습니다. 위 영상에서 마우스 오른쪽 버튼(또는 길게 누르기) → 동영상 저장을 이용하세요.';
      };
      m.setActions([
        { label: '다시 설정', ghost: true, onClick: showSettings },
        { label: '닫기', ghost: true, onClick: () => m.close() },
        { label: '파일 저장', primary: true, icon: 'download', id: 'exSave', onClick: save },
      ]);
    }

    showSettings();
  }

  VE.exporter = { open, supportedFormats, fixWebmDuration };
})();
