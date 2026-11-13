/* 싹둑 영상 편집기 — 앱 연결: 동작, 단축키, 파일 가져오기, 화면 배치 */
(function () {
  'use strict';
  const VE = window.VE;
  const U = VE.U;
  const M = VE.M;
  const C = VE.C;
  const store = VE.store;
  const engine = VE.engine;
  const h = U.h;
  const $ = U.$;
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  const MOD = isMac ? '⌘' : 'Ctrl';

  const actions = {};
  VE.actions = actions;

  // ---------- 가져오기 ----------
  actions.pickFiles = () => $('#fileInput').click();

  actions.importFiles = async (list) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    const kinds = files.map((f) => VE.media.kindOf(f));
    const media = files.filter((f, i) => ['video', 'audio', 'image'].includes(kinds[i]));
    const subs = files.filter((f, i) => kinds[i] === 'srt');
    const unknown = files.filter((f, i) => !kinds[i]);
    if (unknown.length) {
      U.toast(`${unknown.slice(0, 3).map((f) => f.name).join(', ')}${unknown.length > 3 ? ' 외' : ''}: 지원하지 않는 파일이라 건너뜁니다`, { type: 'warn' });
    }
    if (media.length) await importMedia(media);
    for (const f of subs) await importSubs(f);
  };

  async function importMedia(files) {
    const metas = [];
    let relinked = 0;
    for (const file of files) {
      const p = store.project;
      const miss = p.media.find((m) => {
        const rt = VE.media.get(m.id);
        return (!rt || rt.status === 'missing' || rt.status === 'error') && m.name === file.name && (!m.size || m.size === file.size);
      });
      try {
        if (miss) {
          await VE.media.relink(miss.id, file);
          VE.persist.saveMedia(miss, file);
          relinked++;
          continue;
        }
        metas.push(await VE.media.add(file));
      } catch (err) {
        U.toast(`${file.name}: ${err.message}`, { type: 'error' });
      }
    }
    if (relinked) {
      U.toast(`파일 ${relinked}개를 다시 연결했습니다`);
      VE.timeline.render();
    }
    if (!metas.length) return;
    const wasSample = !!store.project.sample;
    const wasEmpty = wasSample || M.isEmpty(store.project);
    let added = 0;
    store.commit((p) => {
      if (p.sample) {
        const fresh = VE.newProject();
        for (const k of Object.keys(p)) delete p[k];
        Object.assign(p, fresh);
      }
      for (const m of metas) p.media.push(m);
      if (!wasEmpty) return;
      const v = metas.find((m) => m.type === 'video' || m.type === 'image');
      if (v) {
        const s = M.sizeFor(v.width, v.height);
        p.width = s.w;
        p.height = s.h;
      }
      let at = 0;
      for (const m of metas) {
        if (m.type === 'video') p.main.push(M.makeClip('video', { mediaId: m.id, in: 0, out: m.duration }));
        else if (m.type === 'image') p.main.push(M.makeClip('image', { mediaId: m.id, out: 4 }));
        else {
          p.audio.push(M.makeClip('audio', { mediaId: m.id, start: at, in: 0, out: m.duration }));
          at += m.duration;
        }
        added++;
      }
    });
    for (const m of metas) {
      const rt = VE.media.get(m.id);
      if (rt && rt.file) VE.persist.saveMedia(m, rt.file);
    }
    if (wasEmpty) {
      store.select(null);
      engine.seek(0);
      VE.timeline.zoomFit();
      const p = store.project;
      const msg = `${wasSample ? '예제를 닫고 새 프로젝트를 시작했습니다. ' : ''}타임라인에 ${added}개를 넣었습니다 · 화면 ${p.width}×${p.height}`;
      U.toast(msg, wasSample ? { action: { label: '예제로 되돌리기', fn: () => store.undo() }, timeout: 6000 } : {});
    } else {
      U.toast(`미디어 목록에 ${metas.length}개를 추가했습니다. + 를 누르거나 타임라인으로 끌어 넣으세요.`);
    }
  }

  function parseTime(s) {
    const m = String(s).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?/);
    if (!m) return NaN;
    return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +('0.' + m[4].padEnd(3, '0')) : 0);
  }
  function parseSubs(text) {
    const out = [];
    for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0) continue;
      const [a, z] = lines[i].split('-->');
      const s = parseTime(a);
      const e = parseTime(z);
      const body = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
      if (isFinite(s) && isFinite(e) && e > s && body) out.push({ start: s, end: e, text: body });
    }
    return out;
  }
  async function importSubs(file) {
    const buf = await file.arrayBuffer();
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      try {
        text = new TextDecoder('euc-kr').decode(buf); // 오래된 한국어 자막 파일
      } catch (e2) {
        text = new TextDecoder().decode(buf);
      }
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const cues = parseSubs(text);
    if (!cues.length) {
      U.toast(`${file.name}: 자막을 찾지 못했습니다`, { type: 'warn' });
      return;
    }
    store.commit((p) => {
      const lane = M.laneCount(p.texts);
      for (const q of cues) {
        const c = M.makeClip('text', Object.assign({}, C.TEXT_PRESETS.subtitle, { text: q.text, start: q.start, duration: q.end - q.start, anim: 'none' }));
        c.lane = M.freeLane(p.texts, c.start, c.start + c.duration, lane);
        p.texts.push(c);
      }
    });
    U.toast(`자막 ${cues.length}개를 불러왔습니다`);
  }

  // ---------- 편집 동작 ----------
  actions.addMedia = (id, opts) => {
    opts = opts || {};
    const p = store.project;
    const m = M.media(p, id);
    const rt = VE.media.get(id);
    if (!m) return;
    if (!rt || rt.status !== 'ready') {
      U.toast(rt && rt.status === 'loading' ? '아직 불러오는 중입니다' : '이 파일은 지금 쓸 수 없습니다. 같은 파일을 다시 가져와 주세요.', { type: 'warn' });
      return;
    }
    const asAudio = m.type === 'audio' || (opts.asAudio && m.type === 'video');
    let nid = null;
    store.commit((pp) => {
      if (asAudio) {
        const start = Math.max(0, opts.time != null ? opts.time : engine.time);
        const c = M.makeClip('audio', { mediaId: id, start, in: 0, out: m.duration });
        c.lane = M.freeLane(pp.audio, start, start + m.duration, opts.lane || 0);
        pp.audio.push(c);
        nid = c.id;
      } else {
        const c = m.type === 'video' ? M.makeClip('video', { mediaId: id, in: 0, out: m.duration }) : M.makeClip('image', { mediaId: id, out: 4 });
        pp.main.splice(opts.index != null ? opts.index : pp.main.length, 0, c);
        nid = c.id;
      }
    });
    if (!nid) return;
    store.select(nid);
    const f = M.find(store.project, nid);
    if (f) VE.timeline.ensureVisible(f.clip.start);
  };

  actions.removeMedia = async (id) => {
    const p = store.project;
    const m = M.media(p, id);
    if (!m) return;
    const n = p.main.filter((c) => c.mediaId === id).length + p.audio.filter((c) => c.mediaId === id).length;
    if (n) {
      const ok = await U.confirm(`‘${m.name}’을(를) 쓰는 클립 ${n}개도 타임라인에서 함께 지워집니다.`, { title: '미디어 지우기', ok: '함께 지우기', danger: true });
      if (!ok) return;
    }
    store.commit((pp) => {
      pp.media = pp.media.filter((x) => x.id !== id);
      pp.main = pp.main.filter((c) => c.mediaId !== id);
      pp.audio = pp.audio.filter((c) => c.mediaId !== id);
    });
    U.toast(`‘${m.name}’을(를) 지웠습니다`, { action: { label: '되돌리기', fn: () => store.undo() } });
  };

  const inside = (c, t) => t > c.start + M.MIN && t < M.clipEnd(c) - M.MIN;
  actions.split = () => {
    const p = store.project;
    const t = engine.time;
    let f = store.selected();
    if (!f || !inside(f.clip, t)) {
      const c = M.mainAt(p, t);
      f = c && inside(c, t) ? M.find(p, c.id) : null;
    }
    if (!f) {
      U.toast('재생헤드(노란 선)를 자를 클립 위에 두고 다시 누르세요');
      return;
    }
    let nid = null;
    if (engine.playing) engine.pause();
    store.commit((pp) => {
      nid = M.split(pp, f.clip.id, t);
    });
    if (nid) store.select(nid);
  };
  actions.remove = () => {
    const id = store.selection;
    if (!id) {
      U.toast('먼저 지울 클립을 누르세요');
      return;
    }
    store.commit((p) => {
      const f = M.find(p, id);
      if (f) f.list.splice(f.index, 1);
    });
  };
  actions.duplicate = () => {
    const id = store.selection;
    if (!id) {
      U.toast('먼저 복제할 클립을 누르세요');
      return;
    }
    let nid = null;
    store.commit((p) => {
      const f = M.find(p, id);
      if (!f) return;
      const b = U.clone(f.clip);
      b.id = U.uid(b.kind[0]);
      if (f.track === 'main') f.list.splice(f.index + 1, 0, b);
      else {
        const d = M.clipDur(b);
        b.start = M.clipEnd(f.clip);
        b.lane = M.freeLane(f.list, b.start, b.start + d, f.clip.lane);
        f.list.push(b);
      }
      nid = b.id;
    });
    if (nid) store.select(nid);
  };
  actions.addText = (preset) => {
    const pre = C.TEXT_PRESETS[preset] || C.TEXT_PRESETS.subtitle;
    const total = M.duration(store.project);
    let start = engine.time;
    if (total > 0 && start >= total - 0.05) start = Math.max(0, total - pre.duration);
    let nid = null;
    store.commit((p) => {
      const c = M.makeClip('text', Object.assign({}, pre, { start }));
      c.lane = M.freeLane(p.texts, start, start + c.duration, 0);
      p.texts.push(c);
      nid = c.id;
    });
    store.select(nid);
    VE.timeline.ensureVisible(start);
    setTimeout(() => VE.inspector.focusText(), 30);
  };
  actions.addColor = () => {
    let nid = null;
    store.commit((p) => {
      const c = M.makeClip('color', { color: '#16181d', out: 3 });
      p.main.push(c);
      nid = c.id;
    });
    store.select(nid);
    const f = M.find(store.project, nid);
    if (f) VE.timeline.ensureVisible(f.clip.start);
  };
  actions.newProject = async () => {
    const p = store.project;
    if (!M.isEmpty(p) || p.media.length) {
      const ok = await U.confirm('지금 프로젝트를 닫고 빈 프로젝트를 시작할까요? 바로 실행 취소하면 되돌릴 수 있지만, 새로고침한 뒤에는 되돌릴 수 없습니다.', { title: '새 프로젝트', ok: '새로 시작' });
      if (!ok) return;
    }
    engine.pause();
    store.commit((pp) => {
      const fresh = VE.newProject();
      for (const k of Object.keys(pp)) delete pp[k];
      Object.assign(pp, fresh);
    });
    store.select(null);
    engine.seek(0);
    VE.timeline.zoomFit();
    U.toast('새 프로젝트를 시작했습니다', { action: { label: '되돌리기', fn: () => store.undo() } });
  };

  actions.help = () => {
    const keys = [
      ['Space', '재생 / 일시정지'],
      ['← →', '한 프레임씩 이동 (Shift: 1초)'],
      ['Home  End', '처음 / 끝으로'],
      ['S', '재생헤드 위치에서 자르기'],
      ['Delete', '선택한 클립 지우기'],
      [`${MOD} + D`, '선택한 클립 복제'],
      ['T', '재생헤드 위치에 자막 넣기'],
      [`${MOD} + Z`, '실행 취소'],
      [`${MOD} + Shift + Z`, '다시 실행'],
      ['+  −', '타임라인 확대 / 축소'],
      ['\\', '타임라인 전체 보기'],
      [`${MOD} + 휠`, '마우스 위치를 기준으로 확대/축소'],
      [`${MOD} + E`, '내보내기'],
      ['Esc', '선택 해제'],
    ];
    U.modal({
      title: '사용법과 단축키',
      wide: true,
      body: h('div', { class: 'help' }, [
        h('section', null, [
          h('h3', null, '기본 흐름'),
          h('ol', { class: 'guide' }, [
            h('li', null, '가져오기(또는 화면에 파일 끌어 놓기)로 영상·사진·음악을 불러옵니다. 처음 불러온 영상의 비율로 화면이 맞춰집니다.'),
            h('li', null, '타임라인의 영상 줄에서 클립을 끌면 순서가 바뀌고, 클립 양 끝을 끌면 앞뒤를 잘라 낼 수 있습니다.'),
            h('li', null, '재생헤드를 원하는 곳에 두고 S를 누르면 클립이 둘로 나뉩니다. 필요 없는 조각은 눌러서 Delete.'),
            h('li', null, '텍스트 항목의 제목·자막·강조로 글자를 넣습니다. 미리보기에서 글자를 끌어 위치를 옮깁니다.'),
            h('li', null, '음악 파일은 오디오 줄에 들어갑니다. 속성에서 볼륨과 페이드 아웃을 조절하세요.'),
            h('li', null, '내보내기를 누르면 영상을 실제 속도로 재생하며 MP4 또는 WebM 파일로 녹화합니다.'),
          ]),
        ]),
        h('section', null, [
          h('h3', null, '단축키'),
          h('table', { class: 'keys' }, [h('tbody', null, keys.map(([k, d]) => h('tr', null, [h('td', null, h('kbd', null, k)), h('td', null, d)])))]),
        ]),
        h('section', null, [
          h('h3', null, '알아 두기'),
          h('ul', { class: 'notes' }, [
            h('li', null, '파일은 인터넷으로 올라가지 않습니다. 모든 처리는 이 브라우저 안에서 이루어집니다.'),
            h('li', null, '작업 내용과 가져온 파일은 이 브라우저에 자동 저장됩니다. 다른 기기나 다른 브라우저와는 공유되지 않습니다.'),
            h('li', null, 'Chrome·Edge 최신 버전을 권장합니다. 아이폰 HEVC(.mov)나 HEIC 사진은 브라우저에 따라 열리지 않을 수 있습니다.'),
            h('li', null, '자막 파일(.srt, .vtt)을 불러오면 시간에 맞춰 자막 클립이 만들어집니다.'),
          ]),
        ]),
      ]),
      actions: [{ label: '닫기', primary: true, onClick: (m) => m.close() }],
    });
  };

  // ---------- 화면 배치 ----------
  const app = {
    showPanel(name) {
      const root = $('#app');
      root.dataset.panel = name;
      $('#tabMedia').setAttribute('aria-selected', String(name === 'media'));
      $('#tabInspector').setAttribute('aria-selected', String(name === 'inspector'));
    },
  };
  VE.app = app;

  function layoutCanvas() {
    const viewer = $('#viewer');
    const canvas = $('#previewCanvas');
    const p = store.project;
    const cs = getComputedStyle(viewer);
    const aw = Math.max(10, viewer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const ah = Math.max(10, viewer.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
    const ar = p.width / p.height;
    let cw = aw;
    let ch = aw / ar;
    if (ch > ah) {
      ch = ah;
      cw = ah * ar;
    }
    canvas.style.width = Math.floor(cw) + 'px';
    canvas.style.height = Math.floor(ch) + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let pw = Math.round(cw * dpr);
    if (pw > p.width) pw = p.width;
    pw = Math.max(16, pw);
    const ph = Math.max(16, Math.round(pw / ar));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      engine.resized();
    }
  }

  function bindPreview() {
    const canvas = $('#previewCanvas');
    const toCanvas = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height, r };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const pt = toCanvas(e);
      const hit = engine.hitText(pt.x, pt.y, canvas.width, canvas.height);
      if (hit) {
        store.select(hit.id);
        dragOnPreview(e, hit.id, pt.r, 'text');
        return;
      }
      const cur = M.mainForDisplay(store.project, engine.time);
      if (cur) {
        store.select(cur.id);
        if (cur.kind !== 'color') dragOnPreview(e, cur.id, pt.r, 'main');
      } else store.select(null);
    });
    canvas.addEventListener('dblclick', () => {
      const f = store.selected();
      if (f && f.clip.kind === 'text') VE.inspector.focusText();
    });
  }

  function dragOnPreview(e, id, rect, kind) {
    const canvas = $('#previewCanvas');
    const f = M.find(store.project, id);
    if (!f) return;
    const x0 = f.clip.x || 0;
    const y0 = f.clip.y || 0;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {}
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      moved = true;
      let dx = (ev.clientX - sx) / rect.width;
      let dy = (ev.clientY - sy) / rect.height;
      if (kind === 'main') {
        dx *= 2;
        dy *= 2;
      }
      let nx = x0 + dx;
      let ny = y0 + dy;
      const center = kind === 'main' ? 0 : 0.5;
      const g = { x: false, y: false };
      if (!ev.shiftKey) {
        const th = kind === 'main' ? 0.03 : 0.015;
        if (Math.abs(nx - center) < th) {
          nx = center;
          g.x = true;
        }
        if (Math.abs(ny - center) < th) {
          ny = center;
          g.y = true;
        }
      }
      engine.guides = g.x || g.y ? g : null;
      store.commit((p) => {
        const k = M.find(p, id);
        if (!k) return;
        if (kind === 'main') {
          k.clip.x = U.clamp(nx, -2, 2);
          k.clip.y = U.clamp(ny, -2, 2);
        } else {
          k.clip.x = U.clamp(nx, 0, 1);
          k.clip.y = U.clamp(ny, 0, 1);
        }
      }, { coalesce: 'drag:' + id });
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      engine.guides = null;
      engine.invalidate();
      store.endCoalesce();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  function bindTimelineResizer() {
    const handle = $('#tlResizer');
    const root = $('#app');
    try {
      const saved = +localStorage.getItem('ssakdook.tlh');
      if (saved > 120) root.style.setProperty('--tl-h', saved + 'px');
    } catch (e) {}
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = $('#timeline').getBoundingClientRect().height;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const max = window.innerHeight * 0.7;
        const hgt = U.clamp(startH - (ev.clientY - startY), 160, max);
        root.style.setProperty('--tl-h', Math.round(hgt) + 'px');
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        try {
          localStorage.setItem('ssakdook.tlh', String(Math.round($('#timeline').getBoundingClientRect().height)));
        } catch (err) {}
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  // ---------- 상단 막대·재생 버튼 ----------
  function refreshTopbar() {
    $('#btnUndo').disabled = !store.canUndo;
    $('#btnRedo').disabled = !store.canRedo;
    const name = $('#projName');
    if (document.activeElement !== name) name.value = store.project.name;
    const hasSel = !!store.selection;
    $('#btnDelete').disabled = !hasSel;
    $('#btnDuplicate').disabled = !hasSel;
    $('#tcDur').textContent = U.fmtTC(M.duration(store.project), store.project.fps);
  }
  function setPlayIcon() {
    const b = $('#btnPlay');
    U.setIcon(b, engine.playing ? 'pause' : 'play');
    b.setAttribute('aria-label', engine.playing ? '일시정지' : '재생');
  }
  let saveTimer = 0;
  function setSaveState(state) {
    const el = $('#saveState');
    clearTimeout(saveTimer);
    if (state === 'saving') el.textContent = '저장 중…';
    else if (state === 'saved') {
      el.textContent = '자동 저장됨';
      el.title = '';
      saveTimer = setTimeout(() => {
        el.textContent = '';
      }, 2500);
    } else if (state === 'off') {
      el.textContent = '자동 저장 안 됨';
      el.title = '이 창에서는 브라우저 저장소를 쓸 수 없어, 새로고침하면 작업이 사라집니다. 끝나면 내보내기로 파일을 저장하세요.';
    }
  }

  function onKey(e) {
    if (U.modalOpen()) {
      if (e.key === 'Escape') {
        const m = U.topModal();
        if (m && m.dismissable) m.close();
      }
      return;
    }
    if (U.isTyping(e)) {
      if (e.key === 'Escape' && e.target.blur) e.target.blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const code = e.code || '';
    if (mod) {
      if (code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (code === 'KeyY') {
        e.preventDefault();
        store.redo();
      } else if (code === 'KeyD') {
        e.preventDefault();
        actions.duplicate();
      } else if (code === 'KeyB') {
        e.preventDefault();
        actions.split();
      } else if (code === 'KeyE') {
        e.preventDefault();
        VE.exporter.open();
      } else if (code === 'KeyS') {
        e.preventDefault();
        VE.persist.saveProject().then(() => U.toast('저장했습니다'));
      } else if (code === 'KeyO') {
        e.preventDefault();
        actions.pickFiles();
      }
      return;
    }
    if (e.altKey) return;
    switch (code) {
      case 'Space':
      case 'KeyK':
        e.preventDefault();
        engine.toggle();
        return;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) engine.seek(engine.time - 1);
        else engine.step(-1);
        return;
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) engine.seek(engine.time + 1);
        else engine.step(1);
        return;
      case 'Home':
        e.preventDefault();
        engine.seek(0);
        VE.timeline.ensureVisible(0);
        return;
      case 'End':
        e.preventDefault();
        engine.seek(M.duration(store.project));
        VE.timeline.ensureVisible(engine.time);
        return;
      case 'KeyS':
        e.preventDefault();
        actions.split();
        return;
      case 'Delete':
      case 'Backspace':
        if (store.selection) {
          e.preventDefault();
          actions.remove();
        }
        return;
      case 'KeyT':
        e.preventDefault();
        actions.addText('subtitle');
        return;
      case 'Equal':
      case 'NumpadAdd':
        e.preventDefault();
        VE.timeline.zoomBy(1.4);
        return;
      case 'Minus':
      case 'NumpadSubtract':
        e.preventDefault();
        VE.timeline.zoomBy(1 / 1.4);
        return;
      case 'Backslash':
        e.preventDefault();
        VE.timeline.zoomFit();
        return;
      case 'Escape':
        store.select(null);
        return;
      case 'KeyM':
        $('#btnMute').click();
        return;
      default:
        if (e.key === '?') {
          e.preventDefault();
          actions.help();
        }
    }
  }

  function bindUI() {
    const fileInput = $('#fileInput');
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      actions.importFiles(files);
    });
    const srtInput = $('#srtInput');
    srtInput.addEventListener('change', () => {
      const files = Array.from(srtInput.files || []);
      srtInput.value = '';
      actions.importFiles(files);
    });
    $('#btnImport').addEventListener('click', actions.pickFiles);
    $('#btnSrt').addEventListener('click', () => srtInput.click());
    $('#btnColorClip').addEventListener('click', actions.addColor);
    U.$$('[data-text-preset]').forEach((b) => b.addEventListener('click', () => actions.addText(b.dataset.textPreset)));
    $('#btnUndo').addEventListener('click', () => store.undo());
    $('#btnRedo').addEventListener('click', () => store.redo());
    $('#btnNew').addEventListener('click', actions.newProject);
    $('#btnHelp').addEventListener('click', actions.help);
    $('#btnExport').addEventListener('click', () => VE.exporter.open());
    $('#btnSplit').addEventListener('click', actions.split);
    $('#btnDelete').addEventListener('click', actions.remove);
    $('#btnDuplicate').addEventListener('click', actions.duplicate);
    $('#btnZoomIn').addEventListener('click', () => VE.timeline.zoomBy(1.4));
    $('#btnZoomOut').addEventListener('click', () => VE.timeline.zoomBy(1 / 1.4));
    $('#btnZoomFit').addEventListener('click', () => VE.timeline.zoomFit());
    const snap = $('#btnSnap');
    snap.addEventListener('click', () => {
      const on = snap.getAttribute('aria-pressed') !== 'true';
      snap.setAttribute('aria-pressed', String(on));
      VE.timeline.setSnap(on);
    });
    $('#btnPlay').addEventListener('click', () => {
      if (!engine.toggle() && !engine.playing && M.duration(store.project) <= 0) U.toast('재생할 클립이 없습니다. 먼저 미디어를 가져오세요.');
    });
    $('#btnStart').addEventListener('click', () => {
      engine.seek(0);
      VE.timeline.ensureVisible(0);
    });
    $('#btnEnd').addEventListener('click', () => {
      engine.seek(M.duration(store.project));
      VE.timeline.ensureVisible(engine.time);
    });
    $('#btnPrevFrame').addEventListener('click', () => engine.step(-1));
    $('#btnNextFrame').addEventListener('click', () => engine.step(1));
    const safe = $('#btnSafe');
    safe.addEventListener('click', () => {
      engine.showSafe = !engine.showSafe;
      safe.setAttribute('aria-pressed', String(engine.showSafe));
      engine.invalidate();
    });
    const vol = $('#monitorVol');
    const mute = $('#btnMute');
    const setVolIcon = () => U.setIcon(mute, engine.monitorMuted || engine.monitorVolume === 0 ? 'mute' : 'volume');
    vol.addEventListener('input', () => {
      engine.setMonitor(+vol.value, false);
      setVolIcon();
    });
    mute.addEventListener('click', () => {
      engine.setMonitor(null, !engine.monitorMuted);
      setVolIcon();
    });
    const name = $('#projName');
    name.addEventListener('input', () => store.commit((p) => { p.name = name.value.slice(0, 60) || '이름 없는 프로젝트'; }, { coalesce: 'name', source: 'topbar' }));
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });
    $('#tabMedia').addEventListener('click', () => app.showPanel('media'));
    $('#tabInspector').addEventListener('click', () => app.showPanel('inspector'));

    // 마우스로 누른 버튼은 포커스를 풀어 스페이스바가 재생 단축키로 쓰이게 한다
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (b && e.detail > 0 && !b.closest('.modal')) b.blur();
    });
    document.addEventListener('keydown', onKey);

    // 파일 끌어 놓기
    const overlay = $('#dropOverlay');
    let depth = 0;
    const hasFiles = (e) => !VE.dragMediaId && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      overlay.hidden = false;
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.hidden = true;
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      actions.importFiles(e.dataTransfer.files);
    });

    engine.on('time', (t) => {
      $('#tcCur').textContent = U.fmtTC(t, store.project.fps);
    });
    engine.on('play', setPlayIcon);
    engine.on('pause', setPlayIcon);
    store.on('change', () => {
      refreshTopbar();
      layoutCanvas();
    });
    store.on('select', (id) => {
      refreshTopbar();
      if (id) app.showPanel('inspector');
    });
    if (window.ResizeObserver) new ResizeObserver(layoutCanvas).observe($('#viewer'));
    window.addEventListener('resize', layoutCanvas);
    window.addEventListener('beforeunload', (e) => {
      if (engine.exporting) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) VE.persist.saveProjectSoon.flush();
    });
    bindPreview();
    bindTimelineResizer();
  }

  async function restore() {
    const p = await VE.persist.loadProject();
    if (!p || !Array.isArray(p.media) || (M.isEmpty(p) && !p.media.length)) return false;
    await Promise.all(
      p.media.map(async (m) => {
        const rec = await VE.persist.loadMedia(m.id);
        if (rec && rec.blob) await VE.media.restore(m, rec.blob);
        else VE.media.missing(m);
      })
    );
    store.replace(p);
    const missing = p.media.filter((m) => {
      const rt = VE.media.get(m.id);
      return !rt || rt.status !== 'ready';
    });
    if (missing.length) U.toast(`파일 ${missing.length}개를 찾지 못했습니다. 같은 파일을 다시 가져오면 자동으로 연결됩니다.`, { type: 'warn', timeout: 8000 });
    else if (!p.sample) U.toast('지난 작업을 이어서 엽니다');
    return true;
  }

  async function boot() {
    U.injectIcons(document);
    engine.init($('#previewCanvas'), $('#mediaHost'));
    VE.timeline.init();
    VE.inspector.init();
    VE.library.init();
    bindUI();
    app.showPanel('media');
    layoutCanvas();
    refreshTopbar();
    let restored = false;
    try {
      restored = await restore();
    } catch (err) {
      console.warn('저장된 작업을 불러오지 못했습니다', err);
    }
    if (!restored) {
      try {
        store.replace(await VE.sample.build());
        U.toast('예제 프로젝트입니다. 재생해 보거나, 가져오기로 내 영상을 불러오면 새 프로젝트로 시작합니다.', { timeout: 7000 });
      } catch (err) {
        console.warn('예제를 만들지 못했습니다', err);
      }
    }
    store.on('change', () => {
      setSaveState('saving');
      VE.persist.saveProjectSoon();
    });
    VE.persist.on('saved', () => setSaveState('saved'));
    VE.persist.on('disabled', () => setSaveState('off'));
    if (!restored) VE.persist.saveProjectSoon();
    engine.seek(0);
    layoutCanvas();
    VE.timeline.zoomFit();
    refreshTopbar();
    document.documentElement.classList.add('ready');
    VE.ready = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
