/* 싹둑 영상 편집기 — 처음 열었을 때 보여 줄 예제 프로젝트 (그림·음악을 브라우저에서 바로 만든다) */
(function () {
  'use strict';
  const VE = window.VE;
  const U = VE.U;
  const M = VE.M;
  const C = VE.C;

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const toBlob = (c, type, q) => new Promise((resolve) => c.toBlob((b) => resolve(b), type, q));
  function ridge(x, W, H, base, amp, seed) {
    const r = rng(seed);
    const p1 = r() * 6;
    const p2 = r() * 6;
    const p3 = r() * 6;
    x.beginPath();
    x.moveTo(0, H);
    for (let px = 0; px <= W; px += 8) {
      const y = H * base - amp * (0.55 * Math.sin(px * 0.0042 + p1) + 0.3 * Math.sin(px * 0.011 + p2) + 0.15 * Math.sin(px * 0.031 + p3));
      x.lineTo(px, y);
    }
    x.lineTo(W, H);
    x.closePath();
    x.fill();
  }

  async function paintDawn() {
    const W = 1600;
    const H = 900;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    const r = rng(11);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#101c36');
    g.addColorStop(0.42, '#34497a');
    g.addColorStop(0.7, '#d17f68');
    g.addColorStop(1, '#f3c58f');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    for (let i = 0; i < 140; i++) {
      x.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.6})`;
      const s = r() < 0.9 ? 1.4 : 2.4;
      x.fillRect(r() * W, r() * H * 0.42, s, s);
    }
    const sg = x.createRadialGradient(W * 0.66, H * 0.68, 8, W * 0.66, H * 0.68, 420);
    sg.addColorStop(0, 'rgba(255,240,200,0.98)');
    sg.addColorStop(0.12, 'rgba(255,214,160,0.7)');
    sg.addColorStop(1, 'rgba(255,180,120,0)');
    x.fillStyle = sg;
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#5a4766';
    ridge(x, W, H, 0.64, 90, 3);
    x.fillStyle = '#382f4d';
    ridge(x, W, H, 0.74, 70, 5);
    x.fillStyle = '#1d1b2e';
    ridge(x, W, H, 0.86, 50, 9);
    return toBlob(c, 'image/jpeg', 0.9);
  }

  async function paintCity() {
    const W = 1600;
    const H = 900;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    const r = rng(29);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#070a18');
    g.addColorStop(0.55, '#1b2148');
    g.addColorStop(1, '#45305a');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const bx = r() * W;
      const by = H * (0.15 + r() * 0.5);
      const rad = 30 + r() * 90;
      const hue = r() < 0.5 ? '255,176,96' : '120,170,255';
      const bg = x.createRadialGradient(bx, by, 0, bx, by, rad);
      bg.addColorStop(0, `rgba(${hue},0.34)`);
      bg.addColorStop(1, `rgba(${hue},0)`);
      x.fillStyle = bg;
      x.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
    }
    let px = -20;
    while (px < W) {
      const bw = 60 + r() * 110;
      const bh = H * (0.25 + r() * 0.45);
      const top = H - bh;
      x.fillStyle = r() < 0.5 ? '#0c0f1f' : '#111529';
      x.fillRect(px, top, bw, bh);
      for (let wy = top + 14; wy < H - 10; wy += 18) {
        for (let wx = px + 10; wx < px + bw - 12; wx += 16) {
          if (r() < 0.38) {
            x.fillStyle = r() < 0.8 ? 'rgba(255,208,120,0.85)' : 'rgba(170,210,255,0.8)';
            x.fillRect(wx, wy, 7, 9);
          }
        }
      }
      px += bw + 6 + r() * 14;
    }
    return toBlob(c, 'image/jpeg', 0.9);
  }

  function wavBlob(buf) {
    const ch = buf.numberOfChannels;
    const n = buf.length;
    const sr = buf.sampleRate;
    const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const str = (o, s) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, 'RIFF');
    dv.setUint32(4, 36 + n * ch * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, ch, true);
    dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * ch * 2, true);
    dv.setUint16(32, ch * 2, true);
    dv.setUint16(34, 16, true);
    str(36, 'data');
    dv.setUint32(40, n * ch * 2, true);
    const chans = [];
    for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return new Blob([dv.buffer], { type: 'audio/wav' });
  }

  async function synthMusic(seconds) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return null;
    const sr = 44100;
    const ctx = new OAC(1, Math.ceil(sr * seconds), sr);
    const master = ctx.createGain();
    master.connect(ctx.destination);
    master.gain.setValueAtTime(0.0001, 0);
    master.gain.exponentialRampToValueAtTime(0.7, 1.0);
    master.gain.setValueAtTime(0.7, seconds - 2.2);
    master.gain.exponentialRampToValueAtTime(0.0001, seconds);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.36;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(master);
    const bus = ctx.createGain();
    bus.connect(master);
    bus.connect(delay);
    const f = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]];
    const len = seconds / 4;
    chords.forEach((chord, i) => {
      const t0 = i * len;
      chord.forEach((n) => {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.045, t0 + 0.5);
        g.gain.setValueAtTime(0.045, t0 + len - 0.3);
        g.gain.linearRampToValueAtTime(0, t0 + len + 0.25);
        g.connect(bus);
        for (const [type, det] of [['triangle', 1], ['sine', 1.004]]) {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = f(n) * det;
          o.connect(g);
          o.start(t0);
          o.stop(t0 + len + 0.3);
        }
      });
      const bass = ctx.createOscillator();
      bass.type = 'sine';
      bass.frequency.value = f(chord[0] - 12);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0, t0);
      bg.gain.linearRampToValueAtTime(0.14, t0 + 0.08);
      bg.gain.exponentialRampToValueAtTime(0.03, t0 + len);
      bass.connect(bg);
      bg.connect(bus);
      bass.start(t0);
      bass.stop(t0 + len + 0.05);
      const arp = [0, 1, 2, 3, 2, 1].map((k) => chord[k] + 12);
      const steps = Math.floor(len / 0.25);
      for (let k = 0; k < steps; k++) {
        const tn = t0 + k * 0.25;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f(arp[k % arp.length]);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, tn);
        g.gain.exponentialRampToValueAtTime(0.085, tn + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, tn + 0.38);
        o.connect(g);
        g.connect(bus);
        o.start(tn);
        o.stop(tn + 0.42);
      }
    });
    const rendered = await new Promise((resolve, reject) => {
      ctx.oncomplete = (e) => resolve(e.renderedBuffer);
      const pr = ctx.startRendering();
      if (pr && pr.then) pr.then(resolve, reject);
    });
    return wavBlob(rendered);
  }

  async function build() {
    const [dawn, city, music] = await Promise.all([paintDawn(), paintCity(), synthMusic(10.5).catch(() => null)]);
    const files = [new File([dawn], '예제 - 새벽 산.jpg', { type: 'image/jpeg' }), new File([city], '예제 - 밤 도시.jpg', { type: 'image/jpeg' })];
    if (music) files.push(new File([music], '예제 - 배경 음악.wav', { type: 'audio/wav' }));
    const metas = [];
    for (const f of files) metas.push(await VE.media.add(f));
    const [m1, m2, m3] = metas;
    const T = C.TEXT_PRESETS;
    const text = (preset, props) => M.makeClip('text', Object.assign({}, T[preset], props));
    const p = VE.newProject({ name: '예제 프로젝트', sample: true });
    p.media = metas;
    p.main = [
      M.makeClip('image', { mediaId: m1.id, out: 4, motion: 'zoomIn', fadeIn: 0.6 }),
      M.makeClip('image', { mediaId: m2.id, out: 4, motion: 'panRight' }),
      M.makeClip('color', { color: '#101318', out: 2.5, fadeOut: 0.8 }),
    ];
    p.texts = [
      text('title', { text: '싹둑', start: 0.3, duration: 3.3, size: 170, y: 0.42, lane: 1 }),
      text('subtitle', { text: '불러오고, 자르고, 자막 넣고, 내보내기까지', start: 0.9, duration: 2.9, lane: 0 }),
      text('highlight', { text: '끌어서 순서 바꾸기', start: 4.4, duration: 3.2, lane: 1 }),
      text('subtitle', { text: '클립 끝을 끌면 길이가, S 키를 누르면 그 자리가 잘립니다', start: 4.6, duration: 3.2, lane: 0 }),
      text('title', { text: '이제 직접 만들어 보세요', start: 8.2, duration: 2.2, size: 92, y: 0.44, anim: 'fade', lane: 1 }),
      text('subtitle', { text: '왼쪽 위 가져오기로 내 영상을 불러오면 새 프로젝트가 시작됩니다', start: 8.4, duration: 2.0, size: 40, bgOpacity: 0, y: 0.6, lane: 0 }),
    ];
    if (m3) p.audio = [M.makeClip('audio', { mediaId: m3.id, start: 0, in: 0, out: m3.duration, volume: 0.8, fadeOut: 1.5 })];
    return p;
  }

  VE.sample = { build };
})();
