/* 싹둑 영상 편집기 — 자동 저장 (IndexedDB: 프로젝트 + 미디어 파일) */
(function () {
  'use strict';
  const VE = window.VE;
  const U = VE.U;
  const DB_NAME = 'ssakdook-editor';
  const VERSION = 1;
  let dbp = null;
  let quotaWarned = false;
  const stored = new Set(); // 저장소에 들어 있는 미디어 id
  const em = new U.Emitter();

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        if (!window.indexedDB) return resolve(null);
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
    return dbp;
  }

  async function run(storeName, mode, fn) {
    const db = await open();
    if (!db) return undefined;
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(storeName, mode);
      } catch (e) {
        reject(e);
        return;
      }
      let result;
      const req = fn(tx.objectStore(storeName));
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function isQuota(err) {
    return err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
  }

  const persist = {
    on: (ev, fn) => em.on(ev, fn),
    available: async () => !!(await open()),

    async loadProject() {
      try {
        const rec = await run('kv', 'readonly', (s) => s.get('project'));
        if (!rec || !rec.json) return null;
        return JSON.parse(rec.json);
      } catch (e) {
        return null;
      }
    },
    async loadMedia(id) {
      try {
        const rec = await run('media', 'readonly', (s) => s.get(id));
        if (rec && rec.blob) stored.add(id);
        return rec || null;
      } catch (e) {
        return null;
      }
    },
    async saveMedia(meta, blob) {
      if (!blob || stored.has(meta.id)) return;
      try {
        await run('media', 'readwrite', (s) => s.put({ meta, blob }, meta.id));
        stored.add(meta.id);
      } catch (e) {
        if (!quotaWarned) {
          quotaWarned = true;
          U.toast(isQuota(e)
            ? '브라우저 저장 공간이 모자라 일부 미디어는 자동 저장되지 않습니다. 새로고침하면 그 파일만 다시 가져오면 됩니다.'
            : '미디어 자동 저장에 실패했습니다. 편집은 계속할 수 있습니다.', { type: 'warn', timeout: 7000 });
        }
      }
    },
    async saveProject() {
      const p = VE.store.project;
      if (!(await open())) {
        em.emit('disabled');
        return;
      }
      try {
        await run('kv', 'readwrite', (s) => s.put({ json: JSON.stringify(p), savedAt: Date.now() }, 'project'));
        em.emit('saved', Date.now());
        // 프로젝트에 남아 있는 미디어 중 아직 저장 안 된 파일 저장, 안 쓰는 파일 정리
        const ids = new Set(p.media.map((m) => m.id));
        for (const m of p.media) {
          if (!stored.has(m.id)) {
            const rt = VE.media.get(m.id);
            if (rt && rt.file) await persist.saveMedia(m, rt.file);
          }
        }
        const keys = (await run('media', 'readonly', (s) => s.getAllKeys())) || [];
        const stale = keys.filter((k) => !ids.has(k));
        if (stale.length) {
          await run('media', 'readwrite', (s) => {
            stale.forEach((k) => s.delete(k));
          });
          stale.forEach((k) => stored.delete(k));
        }
      } catch (e) {
        em.emit('error', e);
      }
    },
    async clearAll() {
      try {
        await run('kv', 'readwrite', (s) => s.clear());
        await run('media', 'readwrite', (s) => s.clear());
        stored.clear();
      } catch (e) {}
    },
  };
  persist.saveProjectSoon = U.debounce(() => persist.saveProject(), 800);
  VE.persist = persist;
})();
