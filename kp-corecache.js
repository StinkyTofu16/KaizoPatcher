// Keeps the emulator's unpacked core files in Cache Storage, so the "Decompress Game Core" step (an old in-browser
// 7z unpacker in a worker, which can silently die near the end on phones that are short on memory and leave the
// screen at 99%) runs only once. If unpacking does stall, it is restarted up to 3 times.
// KPCoreCache.install() patches EmulatorJS's EJS_COMPRESSION once emulator.min.js has defined it.
const KPCoreCache = (() => {
  const CACHE = 'kp-core-v1', PREFIX = '__kpcore/';
  const withTimeout = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(() => res(null), ms))]);
  // A cheap fingerprint of the compressed core: its size plus a hash of sampled bytes.
  function sig(u8) {
    let h = 2166136261 >>> 0;
    const step = Math.max(1, Math.floor(u8.length / 4096));
    for (let i = 0; i < u8.length; i += step) h = Math.imul(h ^ u8[i], 16777619) >>> 0;
    for (let i = Math.max(0, u8.length - 64); i < u8.length; i++) h = Math.imul(h ^ u8[i], 16777619) >>> 0;
    return u8.length + '-' + h.toString(16);
  }
  async function load(key) {
    if (!('caches' in window)) return null;
    const c = await caches.open(CACHE);
    const idx = await c.match(PREFIX + key + '/index'); if (!idx) return null;
    const names = await idx.json(), out = {};
    for (const n of names) { const r = await c.match(PREFIX + key + '/f/' + encodeURIComponent(n)); if (!r) return null; out[n] = new Uint8Array(await r.arrayBuffer()); }
    return out;
  }
  async function store(key, files) {
    if (!('caches' in window)) return;
    const c = await caches.open(CACHE);
    for (const req of await c.keys()) if (!new URL(req.url).pathname.includes('/' + PREFIX + key + '/')) await c.delete(req);
    const names = Object.keys(files);
    for (const n of names) await c.put(PREFIX + key + '/f/' + encodeURIComponent(n), new Response(new Blob([files[n]])));
    await c.put(PREFIX + key + '/index', new Response(JSON.stringify(names), { headers: { 'content-type': 'application/json' } }));
  }
  function install() {
    const C = window.EJS_COMPRESSION;
    if (!C || C.prototype.__kpCore) return !!C;
    const orig = C.prototype.decompress;
    C.prototype.decompress = function (data, onProgress, onFile) {
      // Only the core download is a 7z with no per-file callback; anything else goes through untouched.
      if (onFile || this.isCompressed(data.slice(0, 10)) !== '7z') return orig.call(this, data, onProgress, onFile);
      const key = sig(data);
      return (async () => {
        try { const hit = await withTimeout(load(key), 4000); if (hit && Object.keys(hit).some((n) => n.endsWith('.wasm'))) return hit; } catch (e) { console.warn('Core cache read failed', e); }
        let files = null;
        for (let attempt = 0; attempt < 3 && !files; attempt++) {
          files = await withTimeout(orig.call(this, data, onProgress, onFile), 20000);
          if (!files) console.warn('Core unpacking stalled; retrying');
        }
        if (!files) throw new Error('Core unpacking stalled');
        store(key, files).catch((e) => console.warn('Core cache write failed', e));
        return files;
      })();
    };
    C.prototype.__kpCore = true;
    return true;
  }
  return { install };
})();
