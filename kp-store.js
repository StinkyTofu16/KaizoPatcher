// Small IndexedDB key-value store shared by the KaizoPatcher pages.
// Keys: "setup" = {label, sys, core, ext, fam, presetFile, presetName, baseName, rom: ArrayBuffer, runs, ...}
//       "run"   = {id, preset, created, rom: ArrayBuffer, log: ArrayBuffer|null, ...}
const KPStore = (() => {
  let dbp = null;

  // Safari sometimes leaves IndexedDB unresponsive on a freshly loaded page until indexedDB.databases() is called.
  // Poke it until it answers (well-known workaround), then open, retrying an open that never completes.
  function wakeSafari() {
    if (!indexedDB.databases) return Promise.resolve();
    return new Promise((res) => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearInterval(t); res(); } };
      const poke = () => { try { indexedDB.databases().then(finish, finish); } catch (e) { finish(); } };
      const t = setInterval(poke, 100); poke();
      setTimeout(finish, 1500);
    });
  }
  function openOnce(ms) {
    return new Promise((res, rej) => {
      let r;
      const timer = setTimeout(() => rej(new Error('open-timeout')), ms);
      try { r = indexedDB.open('kaizopatcher', 1); } catch (e) { clearTimeout(timer); rej(e); return; }
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
      r.onsuccess = () => {
        clearTimeout(timer);
        const db = r.result;
        db.onversionchange = () => { db.close(); dbp = null; };
        db.onclose = () => { dbp = null; };
        res(db);
      };
      r.onerror = () => { clearTimeout(timer); rej(r.error || new Error('open-failed')); };
      r.onblocked = () => {};
    });
  }
  function open() {
    if (dbp) return dbp;
    dbp = (async () => {
      let last;
      for (let attempt = 0; attempt < 4; attempt++) {
        await wakeSafari();
        try { return await openOnce(attempt === 0 ? 3000 : 5000); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 300)); }
      }
      throw last || new Error('Storage unavailable');
    })().catch((e) => { dbp = null; throw e; });
    return dbp;
  }
  async function tx(mode, fn) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const db = await open();
      try {
        return await new Promise((res, rej) => {
          const t = db.transaction('kv', mode);
          const out = fn(t.objectStore('kv'));
          t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
          t.onerror = () => rej(t.error);
          t.onabort = () => rej(t.error || new Error('Storage was full or blocked.'));
        });
      } catch (e) {
        // A connection Safari closed behind our back: reopen once and retry.
        if (attempt === 0 && e && (e.name === 'InvalidStateError' || /closing|closed/i.test(e.message || ''))) { dbp = null; continue; }
        throw e;
      }
    }
  }
  return {
    get: (k) => tx('readonly', (s) => s.get(k)),
    set: (k, v) => tx('readwrite', (s) => { s.put(v, k); }),
    del: (k) => tx('readwrite', (s) => { s.delete(k); }),
  };
})();

const KP_CORES = { GBA: { core: 'gba', ext: 'gba' }, GB: { core: 'gb', ext: 'gb' }, GBC: { core: 'gb', ext: 'gbc' } };
