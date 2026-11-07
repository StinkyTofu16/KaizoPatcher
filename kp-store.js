// Small IndexedDB key-value store shared by the KaizoPatcher pages.
// Keys: "setup" = {label, sys, core, ext, fam, presetFile, presetName, baseName, rom: ArrayBuffer, runs}
//       "run"   = {id, preset, created, rom: ArrayBuffer, log: ArrayBuffer|null}
const KPStore = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('kaizopatcher', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode);
      const out = fn(t.objectStore('kv'));
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Storage was full or blocked.'));
    });
  }
  return {
    get: (k) => tx('readonly', (s) => s.get(k)),
    set: (k, v) => tx('readwrite', (s) => { s.put(v, k); }),
    del: (k) => tx('readwrite', (s) => { s.delete(k); }),
  };
})();

const KP_CORES = { GBA: { core: 'gba', ext: 'gba' }, GB: { core: 'gb', ext: 'gb' }, GBC: { core: 'gb', ext: 'gbc' } };
