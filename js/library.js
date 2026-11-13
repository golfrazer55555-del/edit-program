/* 싹둑 영상 편집기 — 미디어 목록 */
(function () {
  'use strict';
  const VE = window.VE;
  const U = VE.U;
  const M = VE.M;
  const store = VE.store;
  const h = U.h;
  let listEl = null;
  let sig = '';

  function uses(p, id) {
    return p.main.filter((c) => c.mediaId === id).length + p.audio.filter((c) => c.mediaId === id).length;
  }

  function metaText(m, rt, used) {
    if (!rt || rt.status === 'missing') return '파일 없음 · 같은 파일을 다시 가져오세요';
    if (rt.status === 'error') return '열 수 없음 · ' + (rt.error || '');
    if (rt.status === 'loading') return '불러오는 중…';
    const parts = [m.type === 'video' ? '영상' : m.type === 'audio' ? '오디오' : '사진'];
    if (m.width) parts.push(`${m.width}×${m.height}`);
    if (m.size) parts.push(U.fmtBytes(m.size));
    if (used) parts.push(`${used}곳에 사용`);
    return parts.join(' · ');
  }

  function itemEl(m, p) {
    const rt = VE.media.get(m.id);
    const status = rt ? rt.status : 'missing';
    const used = uses(p, m.id);
    const icon = m.type === 'audio' ? 'music' : m.type === 'image' ? 'image' : 'film';
    const thumb = h('div', { class: 'mi-thumb' }, rt && rt.thumb ? h('img', { src: rt.thumb, alt: '', draggable: 'false' }) : U.icon(icon));
    if (m.type !== 'image' && m.duration) thumb.appendChild(h('span', { class: 'mi-dur' }, U.fmtClock(m.duration)));
    const ready = status === 'ready';
    const add = h('button', { class: 'icon-btn small', type: 'button', title: '타임라인에 추가', 'aria-label': `${m.name} 타임라인에 추가`, disabled: ready ? null : true }, [U.icon('plus')]);
    add.addEventListener('click', () => VE.actions.addMedia(m.id));
    const del = h('button', { class: 'icon-btn small quiet', type: 'button', title: '목록에서 지우기', 'aria-label': `${m.name} 목록에서 지우기` }, [U.icon('close')]);
    del.addEventListener('click', () => VE.actions.removeMedia(m.id));
    const el = h('div', {
      class: `mi mi-${m.type} is-${status}`,
      draggable: ready ? 'true' : 'false',
      dataset: { id: m.id },
      title: ready ? `${m.name} — 끌어서 타임라인에 놓거나 + 를 누르세요` : m.name,
    }, [
      thumb,
      h('div', { class: 'mi-body' }, [h('div', { class: 'mi-name' }, m.name), h('div', { class: 'mi-meta' }, metaText(m, rt, used))]),
      h('div', { class: 'mi-acts' }, [add, del]),
    ]);
    el.addEventListener('dragstart', (e) => {
      if (!ready) {
        e.preventDefault();
        return;
      }
      VE.dragMediaId = m.id;
      try {
        e.dataTransfer.setData('text/plain', m.name);
        e.dataTransfer.effectAllowed = 'copy';
      } catch (err) {}
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      VE.dragMediaId = null;
      el.classList.remove('dragging');
      if (VE.timeline) VE.timeline.clearDrop();
    });
    el.addEventListener('dblclick', (e) => {
      if (!e.target.closest('button') && ready) VE.actions.addMedia(m.id);
    });
    return el;
  }

  function pendingEl(rt) {
    return h('div', { class: 'mi is-loading' }, [
      h('div', { class: 'mi-thumb' }, h('span', { class: 'spinner', 'aria-hidden': 'true' })),
      h('div', { class: 'mi-body' }, [h('div', { class: 'mi-name' }, rt.name || '파일'), h('div', { class: 'mi-meta' }, '불러오는 중…')]),
    ]);
  }

  function render() {
    if (!listEl) return;
    const p = store.project;
    const pend = VE.media.pending();
    const next = JSON.stringify([
      p.media.map((m) => {
        const rt = VE.media.get(m.id);
        return [m.id, m.name, rt ? rt.status : 'x', rt && rt.thumb ? 1 : 0, uses(p, m.id)];
      }),
      pend.map((r) => r.id),
    ]);
    if (next === sig) return;
    sig = next;
    listEl.textContent = '';
    if (!p.media.length && !pend.length) {
      const empty = h('button', { type: 'button', class: 'media-empty' }, [
        U.icon('upload'),
        h('strong', null, '파일을 끌어다 놓거나 눌러서 고르세요'),
        h('span', null, 'MP4 · WebM · MOV · MP3 · WAV · M4A · JPG · PNG'),
      ]);
      empty.addEventListener('click', () => VE.actions.pickFiles());
      listEl.appendChild(empty);
      return;
    }
    p.media.forEach((m) => listEl.appendChild(itemEl(m, p)));
    pend.forEach((r) => listEl.appendChild(pendingEl(r)));
  }

  VE.library = {
    init() {
      listEl = U.$('#mediaList');
      store.on('change', render);
      VE.media.on('update', render);
      VE.media.on('pending', render);
      VE.media.on('relink', render);
      render();
    },
    render,
  };
})();
