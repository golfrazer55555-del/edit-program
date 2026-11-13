/* 싹둑 영상 편집기 — 속성 패널: 선택한 클립(또는 프로젝트)의 설정 */
(function () {
  'use strict';
  const VE = window.VE;
  const U = VE.U;
  const M = VE.M;
  const C = VE.C;
  const store = VE.store;
  const h = U.h;

  let body = null;
  let titleEl = null;
  let kindEl = null;
  let live = [];
  let lastSel = undefined;

  const fid = (name) => 'insp-' + name;
  const decimals = (step) => (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
  const round = (v, step) => (+v).toFixed(decimals(step));

  function commitClip(id, key, fn) {
    store.commit((p) => {
      const f = M.find(p, id);
      if (f) fn(f.clip, p);
    }, { coalesce: id + ':' + key, source: 'inspector' });
  }
  function commitProject(key, fn) {
    store.commit(fn, { coalesce: 'project:' + key, source: 'inspector' });
  }

  // ---------- 입력 요소 ----------
  function section(title, children) {
    return h('section', { class: 'insp-sec' }, [title ? h('h3', null, title) : null, children]);
  }
  function slider(o) {
    const id = fid(o.id);
    const range = h('input', { type: 'range', id, min: o.min, max: o.max, step: o.step, value: o.value });
    const num = h('input', { type: 'number', class: 'num', id: id + '-n', min: o.min, max: o.max, step: o.step, value: round(o.value, o.step), 'aria-label': o.label + ' 값' });
    range.addEventListener('input', () => {
      num.value = round(range.value, o.step);
      o.onInput(+range.value);
    });
    num.addEventListener('change', () => {
      let v = +num.value;
      if (!isFinite(v)) v = +range.value;
      v = U.clamp(v, o.min, o.max);
      range.value = v;
      num.value = round(v, o.step);
      o.onInput(v);
    });
    return h('div', { class: 'insp-field' }, [
      h('div', { class: 'insp-line' }, [h('label', { for: id }, o.label), h('span', { class: 'num-wrap' }, [num, o.unit ? h('span', { class: 'unit' }, o.unit) : null])]),
      range,
    ]);
  }
  function seg(o) {
    const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': o.label || o.id });
    for (const opt of o.options) {
      const on = String(opt.id) === String(o.value);
      const b = h('button', { type: 'button', class: 'seg-btn' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), title: opt.title || null, id: fid(o.id + '-' + opt.id) }, opt.label);
      b.addEventListener('click', () => {
        for (const x of wrap.children) {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-checked', String(x === b));
        }
        o.onChange(opt.id);
      });
      wrap.appendChild(b);
    }
    return h('div', { class: 'insp-field' }, [o.label ? h('div', { class: 'insp-line' }, [h('span', { class: 'lbl' }, o.label)]) : null, wrap]);
  }
  function toggle(o) {
    const id = fid(o.id);
    const inp = h('input', { type: 'checkbox', id, checked: o.checked ? true : null });
    inp.addEventListener('change', () => o.onChange(inp.checked));
    return h('label', { class: 'insp-toggle', for: id }, [inp, h('span', { class: 'sw', 'aria-hidden': 'true' }), h('span', null, o.label)]);
  }
  function color(o) {
    const id = fid(o.id);
    const inp = h('input', { type: 'color', id, value: o.value });
    inp.addEventListener('input', () => o.onInput(inp.value));
    return h('div', { class: 'insp-field inline' }, [h('label', { for: id }, o.label), inp]);
  }
  function select(o) {
    const id = fid(o.id);
    const s = h('select', { id }, o.options.map((opt) => h('option', { value: opt.id, selected: opt.id === o.value ? true : null }, opt.label)));
    s.addEventListener('change', () => o.onChange(s.value));
    return h('div', { class: 'insp-field' }, [h('div', { class: 'insp-line' }, [h('label', { for: id }, o.label)]), s]);
  }
  function number(o) {
    const id = fid(o.id);
    const inp = h('input', { type: 'number', class: 'num wide', id, min: o.min, max: o.max, step: o.step, value: round(o.value, o.step) });
    inp.addEventListener('change', () => {
      const v = +inp.value;
      if (isFinite(v)) o.onChange(U.clamp(v, o.min, o.max));
    });
    if (o.ref) o.ref(inp);
    return h('div', { class: 'insp-field inline' }, [h('label', { for: id }, o.label), h('span', { class: 'num-wrap' }, [inp, o.unit ? h('span', { class: 'unit' }, o.unit) : null])]);
  }
  function button(icon, label, onClick, cls) {
    const b = h('button', { type: 'button', class: 'btn small' + (cls ? ' ' + cls : '') }, label);
    b.insertBefore(U.icon(icon), b.firstChild);
    b.addEventListener('click', onClick);
    return b;
  }
  function note(text) {
    return h('p', { class: 'insp-note' }, text);
  }
  function actions() {
    return h('div', { class: 'insp-actions' }, [
      button('scissors', '분할', () => VE.actions.split()),
      button('copy', '복제', () => VE.actions.duplicate()),
      button('trash', '삭제', () => VE.actions.remove(), 'danger'),
    ]);
  }
  function speedField(c) {
    const id = c.id;
    const wrap = h('div', { class: 'insp-field' });
    const chips = h('div', { class: 'chips' });
    const sl = slider({
      id: 'speed', label: '속도', value: c.speed, min: 0.25, max: 4, step: 0.05, unit: '×',
      onInput: (v) => commitClip(id, 'speed', (cc) => { cc.speed = v; }),
    });
    for (const v of [0.25, 0.5, 1, 1.5, 2, 4]) {
      const b = h('button', { type: 'button', class: 'chip' + (Math.abs(c.speed - v) < 1e-6 ? ' on' : '') }, v + '×');
      b.addEventListener('click', () => {
        commitClip(id, 'speed-chip', (cc) => { cc.speed = v; });
        render(true);
      });
      chips.appendChild(b);
    }
    wrap.append(sl, chips);
    return wrap;
  }
  function fadeFields(c, maxCap) {
    const id = c.id;
    const max = Math.max(0.1, Math.min(maxCap, M.clipDur(c) / 2));
    const step = 0.1;
    return [
      slider({ id: 'fadein', label: '페이드 인', value: Math.min(c.fadeIn, max), min: 0, max: +max.toFixed(1), step, unit: '초', onInput: (v) => commitClip(id, 'fadein', (cc) => { cc.fadeIn = v; }) }),
      slider({ id: 'fadeout', label: '페이드 아웃', value: Math.min(c.fadeOut, max), min: 0, max: +max.toFixed(1), step, unit: '초', onInput: (v) => commitClip(id, 'fadeout', (cc) => { cc.fadeOut = v; }) }),
    ];
  }
  function infoLine(fn) {
    const el = h('p', { class: 'insp-info' });
    const upd = () => {
      el.textContent = fn() || '';
    };
    upd();
    live.push(upd);
    return el;
  }
  const curClip = (id) => {
    const f = M.find(store.project, id);
    return f ? f.clip : null;
  };

  // ---------- 패널 ----------
  function renderProject() {
    const p = store.project;
    titleEl.textContent = '프로젝트';
    kindEl.textContent = '';
    const cur = M.aspectId(p);
    const opts = C.ASPECTS.map((a) => ({ id: a.id, label: a.id, title: `${a.w}×${a.h} · ${a.hint}` }));
    if (!cur) opts.push({ id: 'custom', label: '원본', title: `${p.width}×${p.height}` });
    const hint = (C.ASPECTS.find((a) => a.id === cur) || { hint: '가져온 영상 비율' }).hint;
    const total = M.duration(p);
    body.append(
      section('화면', [
        seg({
          id: 'aspect', label: '화면 비율', value: cur || 'custom', options: opts,
          onChange: (v) => {
            const a = C.ASPECTS.find((x) => x.id === v);
            if (!a) return;
            commitProject('aspect', (pp) => {
              pp.width = a.w;
              pp.height = a.h;
            });
            render(true);
          },
        }),
        note(`${p.width} × ${p.height} 픽셀 · ${hint}`),
        seg({ id: 'fps', label: '초당 프레임 수', value: String(p.fps), options: [24, 25, 30, 60].map((n) => ({ id: String(n), label: String(n) })), onChange: (v) => commitProject('fps', (pp) => { pp.fps = +v; }) }),
        color({ id: 'bg', label: '빈 화면 배경색', value: p.background, onInput: (v) => commitProject('bg', (pp) => { pp.background = v; }) }),
      ]),
      section('요약', [
        h('dl', { class: 'stats' }, [
          h('dt', null, '전체 길이'), h('dd', null, U.fmtClock(total) + (total ? ` (${U.fmtSec(total)})` : '')),
          h('dt', null, '영상 트랙'), h('dd', null, `클립 ${p.main.length}개`),
          h('dt', null, '텍스트'), h('dd', null, `${p.texts.length}개`),
          h('dt', null, '오디오'), h('dd', null, `${p.audio.length}개`),
        ]),
      ]),
      section('처음이라면', [
        h('ol', { class: 'guide' }, [
          h('li', null, [h('strong', null, '가져오기'), '로 영상·사진·음악을 불러옵니다.']),
          h('li', null, '타임라인에서 클립을 끌어 순서를 바꾸고, 양 끝을 끌어 길이를 줄입니다.'),
          h('li', null, ['재생헤드를 옮기고 ', h('kbd', null, 'S'), '를 누르면 그 자리에서 잘립니다.']),
          h('li', null, '텍스트 항목으로 제목·자막을 넣고, 미리보기에서 끌어 위치를 옮깁니다.'),
          h('li', null, [h('strong', null, '내보내기'), '를 누르면 MP4 또는 WebM 파일로 저장됩니다.']),
        ]),
        note('작업 내용은 이 브라우저에 자동으로 저장됩니다.'),
      ])
    );
  }

  function renderVisual(c) {
    const p = store.project;
    const meta = M.media(p, c.mediaId);
    const id = c.id;
    titleEl.textContent = meta ? meta.name : '미디어 없음';
    kindEl.textContent = c.kind === 'video' ? '영상' : '사진';
    const secs = [];
    secs.push(infoLine(() => {
      const cc = curClip(id);
      if (!cc) return '';
      const parts = [`길이 ${U.fmtSec(M.clipDur(cc))}`];
      if (cc.kind === 'video') parts.push(`원본 ${U.fmtClock(cc.in)}.${Math.floor((cc.in % 1) * 10)} – ${U.fmtClock(cc.out)}.${Math.floor((cc.out % 1) * 10)}`);
      if (meta && meta.width) parts.push(`${meta.width}×${meta.height}`);
      return parts.join(' · ');
    }));
    if (c.kind === 'video') {
      secs.push(section('재생', [
        speedField(c),
        slider({ id: 'vol', label: '볼륨', value: Math.round(c.volume * 100), min: 0, max: 200, step: 1, unit: '%', onInput: (v) => commitClip(id, 'vol', (cc) => { cc.volume = v / 100; }) }),
        toggle({ id: 'mute', label: '원본 소리 끄기', checked: c.muted, onChange: (v) => commitClip(id, 'mute', (cc) => { cc.muted = v; }) }),
      ]));
    } else {
      secs.push(section('길이', [
        number({ id: 'dur', label: '보여 줄 시간', value: M.clipDur(c), min: 0.1, max: 3600, step: 0.1, unit: '초', onChange: (v) => commitClip(id, 'dur', (cc) => { cc.out = v; }) }),
      ]));
    }
    secs.push(section('전환', [...fadeFields(c, 5), note('검은 화면에서 서서히 나타나고 사라집니다. 영상 소리도 함께 줄어듭니다.')]));
    secs.push(section('화면 배치', [
      seg({ id: 'fit', label: '맞춤', value: c.fit, options: [{ id: 'contain', label: '전체 보이기' }, { id: 'cover', label: '꽉 채우기' }], onChange: (v) => commitClip(id, 'fit', (cc) => { cc.fit = v; }) }),
      slider({ id: 'scale', label: '크기', value: Math.round(c.scale * 100), min: 10, max: 400, step: 1, unit: '%', onInput: (v) => commitClip(id, 'scale', (cc) => { cc.scale = v / 100; }) }),
      slider({ id: 'px', label: '가로 위치', value: Math.round(c.x * 100), min: -100, max: 100, step: 1, onInput: (v) => commitClip(id, 'px', (cc) => { cc.x = v / 100; }) }),
      slider({ id: 'py', label: '세로 위치', value: Math.round(c.y * 100), min: -100, max: 100, step: 1, onInput: (v) => commitClip(id, 'py', (cc) => { cc.y = v / 100; }) }),
      seg({ id: 'rot', label: '회전', value: String(c.rotate || 0), options: [0, 90, 180, 270].map((d) => ({ id: String(d), label: d + '°' })), onChange: (v) => commitClip(id, 'rot', (cc) => { cc.rotate = +v; }) }),
      select({ id: 'motion', label: '움직임 효과', value: c.motion, options: C.MOTIONS, onChange: (v) => commitClip(id, 'motion', (cc) => { cc.motion = v; }) }),
      note('미리보기 화면에서 끌어서 위치를 옮길 수도 있습니다.'),
      h('div', { class: 'insp-actions' }, [button('reset', '배치 초기화', () => {
        commitClip(id, 'layout-reset', (cc) => { Object.assign(cc, { fit: 'contain', scale: 1, x: 0, y: 0, rotate: 0, motion: 'none' }); });
        render(true);
      }, 'ghost')]),
    ]));
    const chips = h('div', { class: 'filter-grid' });
    for (const fl of C.FILTERS) {
      const b = h('button', { type: 'button', class: 'filter-chip' + (c.filter.preset === fl.id ? ' on' : ''), id: fid('filter-' + fl.id) }, [h('span', { class: 'fsw', style: `filter:${fl.css || 'none'}` }), h('span', null, fl.label)]);
      b.addEventListener('click', () => {
        commitClip(id, 'filter', (cc) => { cc.filter.preset = fl.id; });
        for (const x of chips.children) x.classList.toggle('on', x === b);
      });
      chips.appendChild(b);
    }
    secs.push(section('색 보정', [
      chips,
      slider({ id: 'bri', label: '밝기', value: c.filter.brightness, min: 0, max: 200, step: 1, unit: '%', onInput: (v) => commitClip(id, 'bri', (cc) => { cc.filter.brightness = v; }) }),
      slider({ id: 'con', label: '대비', value: c.filter.contrast, min: 0, max: 200, step: 1, unit: '%', onInput: (v) => commitClip(id, 'con', (cc) => { cc.filter.contrast = v; }) }),
      slider({ id: 'sat', label: '채도', value: c.filter.saturate, min: 0, max: 200, step: 1, unit: '%', onInput: (v) => commitClip(id, 'sat', (cc) => { cc.filter.saturate = v; }) }),
      slider({ id: 'blur', label: '흐림', value: c.filter.blur, min: 0, max: 20, step: 0.5, unit: 'px', onInput: (v) => commitClip(id, 'blur', (cc) => { cc.filter.blur = v; }) }),
      VE.engine.canFilter ? null : note('이 브라우저는 색 보정을 지원하지 않습니다. Chrome·Edge·Firefox에서 사용해 주세요.'),
      h('div', { class: 'insp-actions' }, [button('reset', '색 보정 초기화', () => {
        commitClip(id, 'filter-reset', (cc) => { cc.filter = { preset: 'none', brightness: 100, contrast: 100, saturate: 100, blur: 0 }; });
        render(true);
      }, 'ghost')]),
    ]));
    secs.push(section(null, actions()));
    body.append(...secs);
  }

  function renderColor(c) {
    const id = c.id;
    titleEl.textContent = '단색 화면';
    kindEl.textContent = '배경';
    body.append(
      section('색과 길이', [
        color({ id: 'ccolor', label: '색', value: c.color, onInput: (v) => commitClip(id, 'color', (cc) => { cc.color = v; }) }),
        number({ id: 'cdur', label: '보여 줄 시간', value: M.clipDur(c), min: 0.1, max: 3600, step: 0.1, unit: '초', onChange: (v) => commitClip(id, 'dur', (cc) => { cc.out = v; }) }),
        note('제목 화면이나 장면 사이 쉼표로 쓰기 좋습니다. 위에 텍스트를 얹어 보세요.'),
      ]),
      section('전환', fadeFields(c, 5)),
      section(null, actions())
    );
  }

  function renderText(c) {
    const id = c.id;
    titleEl.textContent = '텍스트';
    kindEl.textContent = `레이어 ${c.lane + 1}`;
    const ta = h('textarea', { id: fid('text'), rows: '3', spellcheck: 'false', value: c.text, 'aria-label': '텍스트 내용' });
    ta.addEventListener('input', () => commitClip(id, 'text', (cc) => { cc.text = ta.value; }));
    const posPresets = h('div', { class: 'chips' });
    for (const [label, y] of [['위', 0.13], ['가운데', 0.5], ['아래', 0.87]]) {
      const b = h('button', { type: 'button', class: 'chip' }, label);
      b.addEventListener('click', () => {
        commitClip(id, 'pos-preset', (cc) => {
          cc.x = 0.5;
          cc.y = y;
        });
        render(true);
      });
      posPresets.appendChild(b);
    }
    body.append(
      section('내용', [ta, note('Enter로 줄을 바꿉니다. 미리보기에서 글자를 끌어 옮길 수 있습니다.')]),
      section('글꼴', [
        select({ id: 'font', label: '글꼴', value: c.font, options: C.FONTS, onChange: (v) => commitClip(id, 'font', (cc) => { cc.font = v; }) }),
        slider({ id: 'size', label: '크기', value: c.size, min: 12, max: 300, step: 1, unit: 'px', onInput: (v) => commitClip(id, 'size', (cc) => { cc.size = v; }) }),
        h('div', { class: 'toggle-row' }, [
          toggle({ id: 'bold', label: '굵게', checked: c.bold, onChange: (v) => commitClip(id, 'bold', (cc) => { cc.bold = v; }) }),
          toggle({ id: 'italic', label: '기울임', checked: c.italic, onChange: (v) => commitClip(id, 'italic', (cc) => { cc.italic = v; }) }),
        ]),
        seg({ id: 'align', label: '줄 정렬', value: c.align, options: [{ id: 'left', label: '왼쪽' }, { id: 'center', label: '가운데' }, { id: 'right', label: '오른쪽' }], onChange: (v) => commitClip(id, 'align', (cc) => { cc.align = v; }) }),
      ]),
      section('색과 꾸밈', [
        color({ id: 'tcolor', label: '글자색', value: c.color, onInput: (v) => commitClip(id, 'color', (cc) => { cc.color = v; }) }),
        slider({ id: 'stroke', label: '외곽선 두께', value: c.strokeWidth, min: 0, max: 20, step: 0.5, unit: 'px', onInput: (v) => commitClip(id, 'stroke', (cc) => { cc.strokeWidth = v; }) }),
        color({ id: 'scolor', label: '외곽선 색', value: c.strokeColor, onInput: (v) => commitClip(id, 'scolor', (cc) => { cc.strokeColor = v; }) }),
        slider({ id: 'bgop', label: '배경 상자', value: Math.round(c.bgOpacity * 100), min: 0, max: 100, step: 1, unit: '%', onInput: (v) => commitClip(id, 'bgop', (cc) => { cc.bgOpacity = v / 100; }) }),
        color({ id: 'bgcolor', label: '상자 색', value: c.bgColor, onInput: (v) => commitClip(id, 'bgcolor', (cc) => { cc.bgColor = v; }) }),
        toggle({ id: 'shadow', label: '그림자', checked: c.shadow, onChange: (v) => commitClip(id, 'shadow', (cc) => { cc.shadow = v; }) }),
      ]),
      section('위치', [
        posPresets,
        slider({ id: 'tx', label: '가로', value: Math.round(c.x * 100), min: 0, max: 100, step: 1, unit: '%', onInput: (v) => commitClip(id, 'tx', (cc) => { cc.x = v / 100; }) }),
        slider({ id: 'ty', label: '세로', value: Math.round(c.y * 100), min: 0, max: 100, step: 1, unit: '%', onInput: (v) => commitClip(id, 'ty', (cc) => { cc.y = v / 100; }) }),
      ]),
      section('등장 효과', [seg({ id: 'anim', value: c.anim, options: C.ANIMS, onChange: (v) => commitClip(id, 'anim', (cc) => { cc.anim = v; }) })]),
      section('시간', [
        number({ id: 'tstart', label: '시작', value: c.start, min: 0, max: 36000, step: 0.1, unit: '초', onChange: (v) => commitClip(id, 'start', (cc) => { cc.start = v; }) }),
        number({ id: 'tdur', label: '길이', value: c.duration, min: 0.1, max: 3600, step: 0.1, unit: '초', onChange: (v) => commitClip(id, 'dur', (cc) => { cc.duration = v; }) }),
      ]),
      section(null, actions())
    );
  }

  function renderAudio(c) {
    const p = store.project;
    const meta = M.media(p, c.mediaId);
    const id = c.id;
    titleEl.textContent = meta ? meta.name : '미디어 없음';
    kindEl.textContent = meta && meta.type === 'video' ? '영상의 소리' : '오디오';
    body.append(
      infoLine(() => {
        const cc = curClip(id);
        if (!cc) return '';
        return `길이 ${U.fmtSec(M.clipDur(cc))} · 원본 ${U.fmtClock(cc.in)} – ${U.fmtClock(cc.out)}`;
      }),
      section('소리', [
        slider({ id: 'avol', label: '볼륨', value: Math.round(c.volume * 100), min: 0, max: 200, step: 1, unit: '%', onInput: (v) => commitClip(id, 'vol', (cc) => { cc.volume = v / 100; }) }),
        toggle({ id: 'amute', label: '음소거', checked: c.muted, onChange: (v) => commitClip(id, 'mute', (cc) => { cc.muted = v; }) }),
        speedField(c),
      ]),
      section('페이드', [...fadeFields(c, 10), note('배경음악 끝을 부드럽게 줄이려면 페이드 아웃을 2~3초로 두세요.')]),
      section('시간', [
        number({ id: 'astart', label: '시작', value: c.start, min: 0, max: 36000, step: 0.1, unit: '초', onChange: (v) => commitClip(id, 'start', (cc) => { cc.start = v; }) }),
      ]),
      section(null, actions())
    );
  }

  function render(keepScroll) {
    if (!body) return;
    const top = keepScroll ? body.scrollTop : 0;
    body.textContent = '';
    live = [];
    const f = store.selected();
    lastSel = f ? f.clip.id : null;
    if (!f) renderProject();
    else {
      const c = f.clip;
      if (c.kind === 'video' || c.kind === 'image') renderVisual(c);
      else if (c.kind === 'color') renderColor(c);
      else if (c.kind === 'text') renderText(c);
      else if (c.kind === 'audio') renderAudio(c);
    }
    body.scrollTop = top;
  }

  VE.inspector = {
    init() {
      body = U.$('#inspBody');
      titleEl = U.$('#inspTitle');
      kindEl = U.$('#inspKind');
      store.on('select', () => render(false));
      store.on('change', (opts) => {
        if (opts && opts.source === 'inspector') {
          live.forEach((fn) => fn());
          return;
        }
        const f = store.selected();
        render(!!f && f.clip.id === lastSel);
      });
      render(false);
    },
    render,
    focusText() {
      if (VE.app) VE.app.showPanel('inspector');
      const ta = document.getElementById(fid('text'));
      if (ta) {
        ta.focus({ preventScroll: false });
        ta.select();
      }
    },
  };
})();
