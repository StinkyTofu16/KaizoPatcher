// Runs Universal Pokémon Randomizer ZX in the browser through CheerpJ.
// KPRandom.run(romBytes, ext, presetFile, onStatus) -> {rom: Blob, log: Blob|null}
const KPRandom = (() => {
  const CJ_URL = 'https://cjrtnc.leaningtech.com/3.0/cj3loader.js';
  // Java runtime files the randomizer uses (recorded with cjGetRuntimeResources), fetched up front in parallel.
  const PRELOAD = {"/lt/8/jre/lib/rt.jar":[0,131072,10354688,10878976,11272192,11665408,11796480,12451840,15204352,15335424,15466496,15597568,17694720,17825792,18219008,18481152,20840448,21233664,21364736,21495808,21626880,21889024,22020096,22806528,22937600,23461888,23592960,26869760],"/lt/8/jre/lib/cheerpj-awt.jar":[0,131072],"/lt/etc/passwd":[0,131072],"/lt/etc/localtime":[],"/lt/8/ext/meta-index":[0,131072],"/lt/8/ext":[],"/lt/8/ext/index.list":[],"/lt/8/ext/sunjce_provider.jar":[],"/lt/8/jre/lib/jsse.jar":[0,131072,786432,917504],"/lt/8/jre/lib/jce.jar":[0,131072],"/lt/8/jre/lib/charsets.jar":[0,131072,1703936,1835008],"/lt/8/jre/lib/resources.jar":[0,131072,917504,1179648],"/lt/8/jre/lib/javaws.jar":[0,131072,1441792,1703936],"/lt/8/jre/lib/meta-index":[0,131072],"/lt/8/jre/lib":[],"/lt/8/lib/ext/localedata.jar":[],"/lt/8/lib/currency.data":[0,131072],"/lt/8/lib/currency.properties":[],"/lt/8/lib/security/java.security":[0,131072]};
  let ready = null, runs = 0;
  function load() {
    if (ready) return ready;
    ready = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = CJ_URL; sc.onload = res;
      sc.onerror = () => rej(new Error('Couldn’t load the randomizer. Check your connection and try again.'));
      document.head.append(sc);
    }).then(() => cheerpjInit({ status: 'none', preloadResources: PRELOAD })).catch((e) => { ready = null; throw e; });
    return ready;
  }
  async function readFile(path) { try { return await cjFileBlob(path); } catch (e) { return null; } }
  let usedJar = null;
  // FireRed MaxDex has its own randomizer that runs in the page (kp-maxdex.js), loaded when first needed.
  let maxdexReady = null;
  function loadMaxDex() {
    if (typeof KPMaxDex !== 'undefined') return Promise.resolve();
    return maxdexReady || (maxdexReady = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = new URL('kp-maxdex.js', location.href).href; sc.onload = res;
      sc.onerror = () => { maxdexReady = null; rej(new Error('Couldn’t load the randomizer. Check your connection and try again.')); };
      document.head.append(sc);
    }));
  }
  async function run(romBytes, ext, presetFile, onStatus) {
    if (/^maxdex\//.test(presetFile)) {
      onStatus && onStatus('Randomizing…');
      await loadMaxDex();
      await new Promise((res) => setTimeout(res, 30));
      const out = KPMaxDex.randomize(romBytes, presetFile.slice(7));
      return { rom: new Blob([out.rom]), log: new Blob([out.log], { type: 'text/plain' }) };
    }
    onStatus && onStatus('Loading the randomizer…');
    await load();
    onStatus && onStatus('Randomizing…');
    const n = ++runs, stamp = Date.now().toString(36) + n;
    const inPath = '/str/kp-in-' + stamp + '.' + ext, setPath = '/str/kp-set-' + stamp + '.rnqs';
    const outPath = '/files/kp-out-' + stamp + '.' + ext, logPath = '/files/kp-log-' + stamp + '.txt', resPath = '/files/kp-res-' + stamp + '.txt';
    cheerpOSAddStringFile(inPath, romBytes);
    const sres = await fetch(new URL('randomizer/presets/' + presetFile, location.href));
    if (!sres.ok) throw new Error('Couldn’t download the preset. Try again.');
    cheerpOSAddStringFile(setPath, new Uint8Array(await sres.arrayBuffer()));
    const base = '/app' + new URL('randomizer/', location.href).pathname;
    // Nat. Dex presets (presets/natdex/…) run with the Nat. Dex build of the randomizer; Java keeps the first one loaded.
    const jar = /^natdex\//.test(presetFile) ? 'randomizer_natdex.jar' : 'PokeRandoZX.jar';
    if (usedJar && usedJar !== jar) throw new Error('Reload the page to switch between Nat. Dex and regular games.');
    usedJar = jar;
    await cheerpjRunMain('KpCli', base + jar + ':' + base + 'kp-cli.jar',
      '--clean=/files', '--tmp=/files/kptmp', '--log=' + logPath, '--result=' + resPath, '-s', setPath, '-i', inPath, '-o', outPath, '-l');
    const res = await readFile(resPath), code = res ? (await res.text()).trim() : '';
    if (code !== '0') {
      const lg = await readFile(logPath);
      const txt = lg ? (await lg.text()).trim().split('\n').filter(Boolean).slice(-2).join(' ') : '';
      throw new Error(txt ? 'The randomizer said: ' + txt : 'The randomizer stopped without finishing.');
    }
    const out = await readFile(outPath);
    if (!out || !out.size) throw new Error('The randomizer finished but didn’t produce a game.');
    return { rom: out, log: await readFile(outPath + '.log') };
  }
  return { run, load };
})();
