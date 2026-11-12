// Storage for the KaizoPatcher pages, without IndexedDB (Safari's IndexedDB can hang on iPhone).
//   Small details (setup, run, progress) -> localStorage as JSON: instant and synchronous.
//   Game files (setupRom, runRom, runLog, startSave) -> Cache Storage, which handles large files reliably.
// Same interface as before: get(key) / set(key, value) / del(key) / migrate().
const KPStore = (() => {
  const LS = 'kp:';
  const CACHE = 'kp-files-v1';
  const url = (k) => new URL('__kpstore/' + encodeURIComponent(k), location.href).href;
  let cachep = null;
  const cache = () => (cachep = cachep || caches.open(CACHE));
  const isBinary = (v) => v instanceof ArrayBuffer || ArrayBuffer.isView(v) || v instanceof Blob;

  async function get(k) {
    let raw = null;
    try { raw = localStorage.getItem(LS + k); } catch (e) {}
    if (raw !== null) { try { return JSON.parse(raw); } catch (e) { return undefined; } }
    try {
      const res = await (await cache()).match(url(k));
      return res ? await res.arrayBuffer() : undefined;
    } catch (e) { return undefined; }
  }
  async function set(k, v) {
    if (isBinary(v)) {
      const body = v instanceof Blob ? v : new Blob([v]);
      await (await cache()).put(url(k), new Response(body, { headers: { 'Content-Type': 'application/octet-stream' } }));
      try { localStorage.removeItem(LS + k); } catch (e) {}
    } else {
      try { localStorage.setItem(LS + k, JSON.stringify(v)); }
      catch (e) { throw new Error('This phone’s storage for the site is full.'); }
      try { await (await cache()).delete(url(k)); } catch (e) {}
    }
  }
  async function del(k) {
    try { localStorage.removeItem(LS + k); } catch (e) {}
    try { await (await cache()).delete(url(k)); } catch (e) {}
  }

  // One-time move of data saved by older versions (IndexedDB "kaizopatcher"). Best effort with a short time limit:
  // if Safari's IndexedDB is stuck, the old data is skipped and the player sets the game up again.
  async function migrate() {
    try { if (localStorage.getItem(LS + '_migrated')) return; } catch (e) { return; }
    const finish = () => { try { localStorage.setItem(LS + '_migrated', '1'); } catch (e) {} };
    if (typeof indexedDB === 'undefined') { finish(); return; }
    const readAll = () => new Promise((res, rej) => {
      const r = indexedDB.open('kaizopatcher', 1);
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} res(null); };
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('kv')) { db.close(); res(null); return; }
        const out = {}; const t = db.transaction('kv', 'readonly'); const st = t.objectStore('kv');
        const keys = ['setup', 'setupRom', 'startSave', 'run', 'runRom', 'runLog'];
        for (const k of keys) { const q = st.get(k); q.onsuccess = () => { if (q.result !== undefined) out[k] = q.result; }; }
        t.oncomplete = () => { db.close(); res(out); };
        t.onerror = () => { db.close(); rej(t.error); };
      };
    });
    let old = null;
    try { old = await Promise.race([readAll(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]); } catch (e) { old = null; }
    if (old) {
      try {
        const s = old.setup, r = old.run;
        if (s) {
          const rom = old.setupRom || s.rom, ss = old.startSave || s.startSave;
          if (rom) { if (!s.code) s.code = String.fromCharCode(...new Uint8Array(rom, 0xAC, 4)); await set('setupRom', rom); }
          if (ss) await set('startSave', ss);
          delete s.rom; delete s.startSave;
          if (rom) await set('setup', s);
        }
        if (r) {
          const rom = old.runRom || r.rom, log = old.runLog || r.log;
          if (rom) {
            await set('runRom', rom);
            if (log) await set('runLog', log);
            r.hasLog = !!log; delete r.rom; delete r.log;
            await set('run', r);
          }
        }
      } catch (e) { console.warn('Migration incomplete', e); }
    }
    finish();
    try { indexedDB.deleteDatabase('kaizopatcher'); } catch (e) {}
  }
  return { get, set, del, migrate };
})();

const KP_CORES = { GBA: { core: 'gba', ext: 'gba' }, GB: { core: 'gb', ext: 'gb' }, GBC: { core: 'gb', ext: 'gbc' }, NDS: { core: 'nds', ext: 'nds' } };
