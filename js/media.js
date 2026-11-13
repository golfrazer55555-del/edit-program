/* 싹둑 영상 편집기 — 미디어 파일 등록, 정보 읽기, 썸네일·파형 만들기 */
(function () {
  'use strict';
  const VE = window.VE;
  const U = VE.U;
  const registry = new Map(); // id → 런타임 정보 (파일, URL, 썸네일, 파형)
  const em = new U.Emitter();
  const host = () => document.getElementById('mediaHost') || document.body;

  const EXT = {
    video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', '3gp', 'avi', 'ts', 'mts', 'm2ts', 'wmv', 'flv', 'qt'],
    audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba', 'wma', 'aif', 'aiff', 'caf'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif', 'jfif'],
  };
  function kindOf(file) {
    const name = (file && file.name) || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'srt' || ext === 'vtt') return 'srt';
    const t = ((file && file.type) || '').toLowerCase();
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    if (t.startsWith('image/')) return 'image';
    for (const k in EXT) if (EXT[k].includes(ext)) return k;
    return null;
  }

  function errText(err) {
    if (!err) return '알 수 없는 오류';
    switch (err.code) {
      case 1: return '불러오기가 중단되었습니다';
      case 2: return '파일을 읽는 중 오류가 났습니다';
      case 3: return '파일을 해석할 수 없습니다. 손상되었거나 지원하지 않는 코덱입니다';
      case 4: return '이 브라우저가 재생할 수 없는 형식입니다';
      default: return err.message || '알 수 없는 오류';
    }
  }

  function waitEvent(el, ok, bad, ms) {
    return new Promise((resolve, reject) => {
      let timer = 0;
      const done = (fn, v) => {
        clearTimeout(timer);
        el.removeEventListener(ok, onOk);
        if (bad) el.removeEventListener(bad, onBad);
        fn(v);
      };
      const onOk = () => done(resolve);
      const onBad = () => done(reject, new Error(errText(el.error)));
      el.addEventListener(ok, onOk);
      if (bad) el.addEventListener(bad, onBad);
      timer = setTimeout(() => done(reject, new Error('응답이 없습니다(시간 초과)')), ms || 15000);
    });
  }

  async function seekEl(el, t) {
    if (Math.abs(el.currentTime - t) < 0.002 && el.readyState >= 2 && !el.seeking) return;
    const p = waitEvent(el, 'seeked', 'error', 6000).catch(() => {});
    try {
      el.currentTime = t;
    } catch (e) {
      return;
    }
    await p;
  }

  /** MediaRecorder로 만든 WebM처럼 길이가 Infinity로 나오는 파일 처리 */
  async function finiteDuration(el) {
    if (isFinite(el.duration) && el.duration > 0) return el.duration;
    await new Promise((resolve) => {
      let timer = 0;
      const check = () => {
        if (isFinite(el.duration) && el.duration > 0) finish();
      };
      const finish = () => {
        clearTimeout(timer);
        el.removeEventListener('durationchange', check);
        el.removeEventListener('timeupdate', check);
        el.removeEventListener('seeked', check);
        resolve();
      };
      el.addEventListener('durationchange', check);
      el.addEventListener('timeupdate', check);
      el.addEventListener('seeked', check);
      timer = setTimeout(finish, 6000);
      try {
        el.currentTime = 1e9;
      } catch (e) {
        finish();
      }
    });
    const d = el.duration;
    try {
      el.currentTime = 0;
    } catch (e) {}
    return isFinite(d) && d > 0 ? d : NaN;
  }

  function thumbCanvas(src, sw, sh, tw, th) {
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    const x = c.getContext('2d');
    x.fillStyle = '#0b0c0e';
    x.fillRect(0, 0, tw, th);
    const s = Math.max(tw / sw, th / sh);
    x.drawImage(src, (tw - sw * s) / 2, (th - sh * s) / 2, sw * s, sh * s);
    return c;
  }
  const toURL = (c) => c.toDataURL('image/jpeg', 0.74);

  // 무거운 작업(필름스트립, 파형)은 하나씩
  let bgQueue = Promise.resolve();
  const enqueue = (fn) => {
    const p = bgQueue.then(fn, fn);
    bgQueue = p.catch(() => {});
    return p;
  };

  async function loadVideo(rt) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    host().appendChild(v);
    const cleanup = () => {
      v.removeAttribute('src');
      try {
        v.load();
      } catch (e) {}
      v.remove();
    };
    try {
      const meta = waitEvent(v, 'loadedmetadata', 'error', 25000);
      v.src = rt.url;
      await meta;
      const duration = await finiteDuration(v);
      if (!(duration > 0)) throw new Error('영상 길이를 알 수 없습니다');
      const width = v.videoWidth;
      const height = v.videoHeight;
      if (!width || !height) {
        cleanup();
        return { audioOnly: true, duration };
      }
      if (v.readyState < 2) await waitEvent(v, 'loadeddata', 'error', 10000).catch(() => {});
      await seekEl(v, Math.min(duration * 0.1, 1));
      const th = 90;
      const tw = Math.round(U.clamp((th * width) / height, 50, 160));
      rt.thumb = toURL(thumbCanvas(v, width, height, tw, th));
      rt.aspect = width / height;
      em.emit('update', rt.id);
      enqueue(() => buildStrip(rt, v, duration, width, height)).finally(cleanup);
      return { duration, width, height };
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  async function buildStrip(rt, v, duration, width, height) {
    const n = U.clamp(Math.ceil(duration / 2.5), 2, 30);
    const th = 64;
    const tw = Math.round(U.clamp((th * width) / height, 36, 116));
    const strip = [];
    for (let i = 0; i < n; i++) {
      if (rt.disposed) return;
      const t = Math.max(0, Math.min(duration - 0.05, ((i + 0.5) * duration) / n));
      await seekEl(v, t);
      strip.push({ t, url: toURL(thumbCanvas(v, width, height, tw, th)) });
    }
    rt.strip = strip;
    em.emit('update', rt.id);
  }

  async function loadAudio(rt) {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    try {
      const meta = waitEvent(a, 'loadedmetadata', 'error', 25000);
      a.src = rt.url;
      await meta;
      const duration = await finiteDuration(a);
      if (!(duration > 0)) throw new Error('오디오 길이를 알 수 없습니다');
      return { duration };
    } finally {
      a.removeAttribute('src');
      try {
        a.load();
      } catch (e) {}
    }
  }

  async function loadImage(rt) {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('이미지를 열 수 없습니다. 지원하지 않는 형식일 수 있습니다(HEIC는 JPG로 바꿔 주세요)'));
      img.src = rt.url;
    });
    try {
      await img.decode();
    } catch (e) {}
    const width = img.naturalWidth || 1920;
    const height = img.naturalHeight || 1080;
    let src = img;
    // 아주 큰 사진은 줄여 두어 매 프레임 그리기 부담을 줄인다
    const LIMIT = 3840;
    if (Math.max(width, height) > LIMIT) {
      const k = LIMIT / Math.max(width, height);
      const c = document.createElement('canvas');
      c.width = Math.round(width * k);
      c.height = Math.round(height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      src = c;
    }
    rt.img = src;
    const th = 90;
    const tw = Math.round(U.clamp((th * width) / height, 50, 160));
    rt.thumb = toURL(thumbCanvas(img, width, height, tw, th));
    rt.aspect = width / height;
    return { width, height };
  }

  async function computePeaks(rt, duration) {
    if (!rt.file || rt.disposed) return;
    const limit = rt.type === 'audio' ? 900 : 420;
    if (!(duration <= limit) || rt.file.size > 160 * 1048576) return;
    if (navigator.deviceMemory && navigator.deviceMemory < 4 && duration > 240) return;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return;
    try {
      const buf = await rt.file.arrayBuffer();
      let ctx;
      try {
        ctx = new OAC(1, 1, 8000); // 낮은 샘플레이트로 디코딩 → 메모리 절약
      } catch (e) {
        ctx = new OAC(1, 1, 44100);
      }
      const audio = await new Promise((resolve, reject) => {
        const r = ctx.decodeAudioData(buf, resolve, reject);
        if (r && r.then) r.then(resolve, reject);
      });
      const rate = 40;
      const n = Math.ceil(audio.duration * rate);
      const peaks = new Float32Array(n);
      const chans = [];
      for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) chans.push(audio.getChannelData(c));
      const per = audio.sampleRate / rate;
      let max = 0;
      for (let i = 0; i < n; i++) {
        const s0 = Math.floor(i * per);
        const s1 = Math.min(audio.length, Math.floor((i + 1) * per));
        let m = 0;
        for (const ch of chans) {
          for (let s = s0; s < s1; s++) {
            const v = ch[s] < 0 ? -ch[s] : ch[s];
            if (v > m) m = v;
          }
        }
        peaks[i] = m;
        if (m > max) max = m;
      }
      rt.peaks = peaks;
      rt.peaksRate = rate;
      rt.peaksMax = max > 0.01 ? max : 1;
      em.emit('update', rt.id);
    } catch (e) {
      // 파형을 못 만들어도 편집에는 문제없음
    }
  }

  async function probe(rt) {
    rt.status = 'loading';
    em.emit('update', rt.id);
    try {
      let info;
      if (rt.type === 'video') {
        info = await loadVideo(rt);
        if (info.audioOnly) rt.type = 'audio';
      } else if (rt.type === 'audio') {
        info = await loadAudio(rt);
      } else {
        info = await loadImage(rt);
      }
      rt.status = 'ready';
      rt.error = null;
      rt.duration = info.duration || 0;
      if (rt.type === 'audio' || rt.type === 'video') enqueue(() => computePeaks(rt, info.duration));
      em.emit('update', rt.id);
      return info;
    } catch (err) {
      rt.status = 'error';
      rt.error = err.message;
      em.emit('update', rt.id);
      throw err;
    }
  }

  function makeRuntime(id, type, blob, name) {
    return { id, type, file: blob, url: blob ? URL.createObjectURL(blob) : null, status: 'loading', name, thumb: null, strip: null, peaks: null, img: null };
  }
  function disposeRuntime(rt) {
    if (!rt) return;
    rt.disposed = true;
    if (rt.url) URL.revokeObjectURL(rt.url);
  }

  VE.media = {
    on: (ev, fn) => em.on(ev, fn),
    kindOf,
    get: (id) => registry.get(id) || null,
    /** 새 파일을 등록하고 프로젝트에 넣을 메타 정보를 돌려준다 */
    async add(file) {
      const type = kindOf(file);
      if (!type || type === 'srt') throw new Error('지원하지 않는 파일입니다');
      const id = U.uid('m');
      const rt = makeRuntime(id, type, file, file.name);
      rt.pending = true;
      registry.set(id, rt);
      em.emit('pending', id);
      try {
        const info = await probe(rt);
        rt.pending = false;
        return {
          id, name: file.name, type: rt.type, size: file.size || 0, lastModified: file.lastModified || 0,
          duration: info.duration || 0, width: info.width || 0, height: info.height || 0,
        };
      } catch (err) {
        registry.delete(id);
        disposeRuntime(rt);
        em.emit('pending', id);
        throw err;
      }
    },
    /** 브라우저 저장소에서 꺼낸 파일 복원 */
    restore(meta, blob) {
      const rt = makeRuntime(meta.id, meta.type, blob, meta.name);
      registry.set(meta.id, rt);
      return probe(rt).catch(() => {});
    },
    missing(meta) {
      registry.set(meta.id, { id: meta.id, type: meta.type, status: 'missing', name: meta.name });
      em.emit('update', meta.id);
    },
    /** 찾을 수 없던 미디어에 파일 다시 연결 */
    async relink(id, file) {
      const old = registry.get(id);
      const rt = makeRuntime(id, kindOf(file), file, file.name);
      registry.set(id, rt);
      try {
        await probe(rt);
        disposeRuntime(old);
        em.emit('relink', id);
        return rt;
      } catch (err) {
        registry.set(id, old);
        disposeRuntime(rt);
        throw err;
      }
    },
    pending() {
      return [...registry.values()].filter((r) => r.pending);
    },
    forget(id) {
      disposeRuntime(registry.get(id));
      registry.delete(id);
    },
  };
})();
