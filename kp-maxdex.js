// Randomizer for FireRed MaxDex. MaxDex is built from source rather than patched over FireRed, so it keeps the
// FireRed data formats but stores everything at its own addresses, with 1,280 species. Universal Pokémon Randomizer
// can't read it, so this finds the tables in the game itself and randomizes them directly, in the browser.
// KPMaxDex.randomize(romBytes, presetName) -> { rom: Uint8Array, log: string }
const KPMaxDex = (() => {
  const PRESETS = {
    // Same idea as the regular FireRed presets: random base stats (same total), abilities and level-up moves
    // (four to start with), plus random Pokémon and items. Casual only randomizes Pokémon and items.
    'Kaizo': { levels: 1.5, bossExtra: 3, evolvedAt: 30, stats: true, abilities: true, moves: true },
    'Standard': { levels: 1.5, bossExtra: 0, evolvedAt: 30, stats: true, abilities: true, moves: true },
    'Super Kaizo': { levels: 1.5, bossExtra: 5, evolvedAt: 30, trainerItems: true, stats: true, abilities: true, moves: true },
    'Casual': { levels: 1, bossExtra: 0, evolvedAt: 0 },
  };
  const LEGENDS = ('Articuno Zapdos Moltres Mewtwo Mew Raikou Entei Suicune Lugia Ho-Oh Celebi Regirock Regice Registeel '
    + 'Latias Latios Kyogre Groudon Rayquaza Jirachi Deoxys Uxie Mesprit Azelf Dialga Palkia Heatran Regigigas Giratina '
    + 'Cresselia Phione Manaphy Darkrai Shaymin Arceus Victini Cobalion Terrakion Virizion Tornadus Thundurus Reshiram '
    + 'Zekrom Landorus Kyurem Keldeo Meloetta Genesect Xerneas Yveltal Zygarde Diancie Hoopa Volcanion TypeNull Silvally '
    + 'TapuKoko TapuLele TapuBulu TapuFini Cosmog Cosmoem Solgaleo Lunala Nihilego Buzzwole Pheromosa Xurkitree Celesteela '
    + 'Kartana Guzzlord Necrozma Magearna Marshadow Poipole Naganadel Stakataka Blacephalon Zeraora Meltan Melmetal Zacian '
    + 'Zamazenta Eternatus Kubfu Urshifu Zarude Regieleki Regidrago Glastrier Spectrier Calyrex Enamorus WoChien ChienPao '
    + 'TingLu ChiYu Koraidon Miraidon Okidogi Munkidori Fezandipti Ogerpon Terapagos Pecharunt').split(' ');
  const TYPE_NAMES = ['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL', '???', 'FIRE',
    'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK', 'FAIRY'];

  // ---- Gen 3 text ----
  const ENC = {};
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { ENC[c] = 0xBB + i; });
  'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => { ENC[c] = 0xD5 + i; });
  '0123456789'.split('').forEach((c, i) => { ENC[c] = 0xA1 + i; });
  Object.assign(ENC, { ' ': 0x00, 'é': 0x1B, '-': 0xAE, '.': 0xAD, '\'': 0xB4, '?': 0xAC, '!': 0xAB, ',': 0xB8, ':': 0xF0, '♂': 0xB5, '♀': 0xB6 });
  const DEC = {}; for (const k in ENC) DEC[ENC[k]] = k;
  const enc = (s) => Uint8Array.from(s.split('').map((c) => (c in ENC ? ENC[c] : 0x00)));
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  function find(R, pat, from = 0, to = R.length) {
    const n = pat.length, f = pat[0];
    outer: for (let i = R.indexOf(f, from); i !== -1 && i <= to - n; i = R.indexOf(f, i + 1)) {
      for (let k = 1; k < n; k++) if (R[i + k] !== pat[k]) continue outer;
      return i;
    }
    return -1;
  }

  function rng(seed) {
    let a = seed >>> 0;
    const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { next, int: (n) => Math.floor(next() * n), pick: (arr) => arr[Math.floor(next() * arr.length)] };
  }

  function locate(R) {
    const dv = new DataView(R.buffer, R.byteOffset, R.byteLength);
    const u8 = (o) => R[o], u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
    const isPtr = (v) => v >= 0x08000000 && v < 0x08000000 + R.length;
    const fail = (what) => { throw new Error('This doesn’t look like FireRed MaxDex (couldn’t find ' + what + ').'); };
    const D = { R, dv, u8, u16, u32, isPtr };

    // species names (11 bytes each); entry 0 is the "??????????" placeholder
    let i = find(R, Uint8Array.of(...enc('Bulbasaur'), 0xFF)); if (i < 0) fail('the Pokémon names');
    D.names = i - 11;
    D.name = (s) => { let o = D.names + s * 11, t = ''; for (let k = 0; k < 11 && R[o + k] !== 0xFF; k++) t += DEC[R[o + k]] || '?'; return t; };
    // base stats: find Bulbasaur and Ivysaur to get the entry size
    i = find(R, Uint8Array.of(45, 49, 49, 45, 65, 65, 12, 3)); const j = find(R, Uint8Array.of(60, 62, 63, 60, 80, 80, 12, 3));
    if (i < 0 || j < 0) fail('the base stats');
    D.statSize = j - i; D.stats = i - D.statSize;
    D.bst = (s) => { const o = D.stats + s * D.statSize; return R[o] + R[o + 1] + R[o + 2] + R[o + 3] + R[o + 4] + R[o + 5]; };
    D.types = (s) => { const o = D.stats + s * D.statSize; return [R[o + 6], R[o + 7]]; };
    // species count: names run until move names start (the first entry with leading spaces)
    let n = 1; while (n < 3000 && D.name(n) !== '' && !/^ /.test(D.name(n))) n++;
    // trailing "-" placeholder entries aren't species
    while (n > 1 && (D.name(n - 1) === '-' || D.bst(n - 1) === 0)) n--;
    D.count = n;
    // evolutions: 8-byte entries, a fixed number per species (Bulbasaur -> Ivysaur at 16, Ivysaur -> Venusaur at 32)
    for (let k = find(R, Uint8Array.of(4, 0, 16, 0, 2, 0)); k !== -1 && !D.evos; k = find(R, Uint8Array.of(4, 0, 16, 0, 2, 0), k + 1)) {
      for (const st of [40, 48, 64, 80, 128]) if (R[k + st] === 4 && R[k + st + 2] === 32 && R[k + st + 4] === 3) { D.evoSize = st; D.evos = k - st; break; }
    }
    if (!D.evos) fail('the evolutions');
    D.evoList = (s) => { const out = []; for (let k = 0; k < D.evoSize / 8; k++) { const o = D.evos + s * D.evoSize + k * 8; const t = u16(o + 4); if (u16(o) && t) out.push({ method: u16(o), param: u16(o + 2), target: t }); } return out; };

    // level-up moves: a pointer per species to 3-byte {move, level} entries ending at level 0xFF.
    // Found from Bulbasaur's list (Tackle 1, Growl 1, Vine Whip 3); entry 0 points there too.
    i = find(R, Uint8Array.of(33, 0, 1, 45, 0, 1, 22, 0, 3));
    if (i >= 0) {
      const refs = [];
      for (let o = 0; o + 4 <= R.length; o += 4) if (u32(o) === i + 0x08000000) refs.push(o);
      const last = refs.filter((q) => isPtr(u32(q + 4)) && isPtr(u32(q + 8))).pop();
      if (last !== undefined) D.learn = last - 4;
    }
    if (D.learn === undefined) fail('the level-up moves');
    D.learnEntries = (s) => { const p = u32(D.learn + s * 4); if (!isPtr(p)) return []; const o = p - 0x08000000, out = []; for (let k = 0; k < 120 && R[o + k * 3 + 2] !== 0xFF; k++) out.push(o + k * 3); return out; };
    // ability names (entry 0 is "-------")
    i = find(R, Uint8Array.of(...enc('Stench'), 0xFF)); const dz = find(R, Uint8Array.of(...enc('Drizzle'), 0xFF), i);
    if (i < 0 || dz < 0) fail('the abilities');
    D.abilLen = dz - i; D.abilNames = i - D.abilLen;
    D.abilName = (a) => { let t = '', o = D.abilNames + a * D.abilLen; for (let k = 0; k < D.abilLen && R[o + k] !== 0xFF; k++) t += DEC[R[o + k]] || '?'; return t; };
    // ability descriptions: a pointer per ability, found from Stench's ("Helps repel wild POKéMON.")
    i = find(R, Uint8Array.of(...enc('Helps repel wild')));
    if (i >= 0) for (let o = 0; o + 4 <= R.length; o += 4) if (u32(o) === i + 0x08000000) { D.abilDesc = o - 4; break; }
    D.abilDescText = (a) => { if (D.abilDesc === undefined) return ''; const p = u32(D.abilDesc + a * 4); if (!isPtr(p)) return ''; let t = '', o = p - 0x08000000; for (let k = 0; k < 60 && R[o + k] !== 0xFF; k++) t += DEC[R[o + k]] || '?'; return t; };
    D.abilCount = 1; while (D.abilCount < 1000 && /^[A-Za-z0-9 .'\-]+$/.test(D.abilName(D.abilCount))) D.abilCount++;

    // move names (for the spoiler log)
    let mn = -1, mL = 0;
    for (let k = find(R, Uint8Array.of(...enc('Pound'), 0xFF)); k !== -1 && mn < 0; k = find(R, Uint8Array.of(...enc('Pound'), 0xFF), k + 1)) {
      for (const L of [13, 17, 21]) if (find(R, Uint8Array.of(...enc('Karate Chop'), 0xFF), k + L, k + L + 12) === k + L) { mn = k; mL = L; }
    }
    // battle data: 12-byte entries {effect u16, power, type, split, accuracy, pp, ...}; Pound, Karate Chop, Double Slap
    for (let k = find(R, Uint8Array.of(0, 0, 40, 0, 0, 100, 35)); k !== -1 && D.moveData === undefined; k = find(R, Uint8Array.of(0, 0, 40, 0, 0, 100, 35), k + 1)) {
      if (R[k + 14] === 50 && R[k + 17] === 100 && R[k + 18] === 25 && R[k + 26] === 15 && R[k + 29] === 85 && R[k + 30] === 10) D.moveData = k - 12;
    }
    D.movePP = (m) => (D.moveData === undefined ? 0 : R[D.moveData + m * 12 + 6]);
    D.moveName = (m) => { if (mn < 0) return '#' + m; let t = '', o = mn + (m - 1) * mL; for (let k = 0; k < mL && R[o + k] !== 0xFF; k++) t += DEC[R[o + k]] || '?'; return t.trim() || '#' + m; };

    D.moveCount = 1; if (mn >= 0) while (D.moveCount < 3000 && /^[A-Za-z0-9 .'\-,]+$/.test(D.moveName(D.moveCount)) && !/^#/.test(D.moveName(D.moveCount))) D.moveCount++;

    // trainers: 40-byte entries; Brock is trainer 414 in FireRed
    for (let k = find(R, Uint8Array.of(...enc('BROCK'), 0xFF)); k !== -1; k = find(R, Uint8Array.of(...enc('BROCK'), 0xFF), k + 1)) {
      const t = k - 4; if (t < 0 || !isPtr(u32(t + 36)) || R[t + 32] < 1 || R[t + 32] > 6) continue;
      const base = t - 40 * 414; let c = 1; // trainer 0 is an empty placeholder
      while (c < 2000 && isPtr(u32(base + c * 40 + 36)) && R[base + c * 40 + 32] <= 6) c++;
      if (c >= 700) { D.trainers = base; D.trainerCount = c; break; }
    }
    if (!D.trainers) fail('the trainers');

    // wild encounter headers: {group, num, pad, land*, water*, rock*, fish*}, ended by group 0xFF
    for (let o = 0; o + 20 <= R.length && !D.wild; o += 4) {
      if (R[o + 2] || R[o + 3] || R[o] > 60) continue;
      let q = o, c = 0;
      for (;;) {
        if (R[q + 2] || R[q + 3]) break;
        const ps = [u32(q + 4), u32(q + 8), u32(q + 12), u32(q + 16)];
        if (!ps.every((p) => p === 0 || isPtr(p)) || ps.every((p) => p === 0)) break;
        c++; q += 20;
      }
      if (c >= 60 && R[q] === 0xFF && R[q + 1] === 0xFF) { D.wild = o; D.wildCount = c; }
    }
    if (!D.wild) fail('the wild encounters');

    // map headers -> events (for hidden items) and map names
    const headers = [];
    for (let o = 0; o + 28 <= R.length; o += 4) {
      const a = u32(o), b = u32(o + 4), c = u32(o + 8), d = u32(o + 12);
      if (!(isPtr(a) && isPtr(b) && isPtr(c) && (d === 0 || isPtr(d)))) continue;
      const lay = u16(o + 18); if (!lay || lay > 0x400 || u16(o + 16) > 0x400) continue;
      const e = b - 0x08000000; if (e + 20 > R.length) continue;
      if (R[e] >= 100 || R[e + 1] >= 100 || R[e + 2] >= 100 || R[e + 3] >= 100) continue;
      let ok = true;
      for (let k = 0; k < 4; k++) { const p = u32(e + 4 + k * 4); if (R[e + k] ? !isPtr(p) : !(p === 0 || isPtr(p))) { ok = false; break; } }
      if (!ok) continue;
      const L = a - 0x08000000; if (L + 8 > R.length) continue;
      const w = u32(L), h = u32(L + 4); if (!(w > 0 && w <= 0x200 && h > 0 && h <= 0x200)) continue;
      headers.push(o);
    }
    D.mapHeaders = headers;
    // gMapGroups: pointers to the arrays of map header pointers
    const hset = new Set(headers.map((h) => h + 0x08000000));
    const toHeaders = (v) => isPtr(v) && (v & 3) === 0 && hset.has(u32(v - 0x08000000));
    for (let o = 0; o + 4 <= R.length && !D.mapGroups; o += 4) {
      if (!toHeaders(u32(o))) continue;
      let c = 0; while (toHeaders(u32(o + c * 4))) c++;
      if (c >= 20) D.mapGroups = o; else o += c * 4;
    }
    D.mapHeader = (g, m) => D.mapGroups ? u32(u32(D.mapGroups + g * 4) - 0x08000000 + m * 4) - 0x08000000 : -1;
    // map section names, a pointer table that starts at Pallet Town
    const vir = find(R, Uint8Array.of(0xFF, ...enc('VIRIDIAN CITY'), 0xFF));
    if (vir >= 0) {
      const tgt = vir + 1 + 0x08000000;
      for (let o = 0; o + 4 <= R.length; o += 4) if (u32(o) === tgt && isPtr(u32(o - 4))) { D.secNames = o - 4; break; }
    }
    const str = (o) => { let t = ''; for (let k = 0; k < 40 && R[o + k] !== 0xFF; k++) t += DEC[R[o + k]] || ''; return t; };
    D.mapName = (g, m) => {
      const h = D.mapHeader(g, m); if (h < 0 || !D.secNames) return 'Map ' + g + '.' + m;
      const sec = R[h + 20]; if (sec < 0x58 || sec > 0xC4) return 'Map ' + g + '.' + m;
      const p = u32(D.secNames + (sec - 0x58) * 4); if (!isPtr(p)) return 'Map ' + g + '.' + m;
      return str(p - 0x08000000).toLowerCase().replace(/(^|[ .\-])([a-z])/g, (x, a, b) => a + b.toUpperCase()).replace(/Pok\u00e9mon/i, 'Pok\u00e9mon');
    };

    // starters: setvar 0x4001, k; setvar 0x4002, player's; setvar 0x4003, rival's, for Bulbasaur, Charmander, Squirtle
    D.starters = [];
    for (let k = 0; k + 15 <= R.length; k++) {
      k = R.indexOf(0x16, k); if (k < 0) break;
      if (R[k + 1] === 1 && R[k + 2] === 0x40 && R[k + 3] <= 2 && R[k + 4] === 0 && R[k + 5] === 0x16 && R[k + 6] === 2 && R[k + 7] === 0x40
        && R[k + 10] === 0x16 && R[k + 11] === 3 && R[k + 12] === 0x40) {
        const a = u16(k + 8), b = u16(k + 13);
        if ([1, 4, 7].includes(a) && [1, 4, 7].includes(b) && a !== b) D.starters.push({ off: k + 8, rivalOff: k + 13, species: a });
      }
    }
    if (D.starters.length !== 3) fail('the starters');
    // the starter table read by GetStarterSpecies: {Bulbasaur, Squirtle, Charmander} as u16, pointed to from code
    for (let k = find(R, Uint8Array.of(1, 0, 7, 0, 4, 0)); k !== -1 && D.starterTable === undefined; k = find(R, Uint8Array.of(1, 0, 7, 0, 4, 0), k + 1)) {
      if ((k & 1) === 0) for (let o = 0; o + 4 <= 0x400000; o += 4) if (u32(o) === k + 0x08000000) { D.starterTable = k; break; }
    }

    // item balls: copyvarifnotzero 0x8000, item; copyvarifnotzero 0x8001, n; callstd 1
    D.itemBalls = [];
    for (let k = R.indexOf(0x1A); k !== -1 && k + 13 <= R.length; k = R.indexOf(0x1A, k + 1)) {
      if (R[k + 1] === 0 && R[k + 2] === 0x80 && R[k + 5] === 0x1A && R[k + 6] === 1 && R[k + 7] === 0x80 && R[k + 9] === 0 && R[k + 10] === 9 && R[k + 11] === 1) D.itemBalls.push(k + 3);
    }
    // hidden items: background events of kind 7 hold the item at +8
    D.hidden = [];
    for (const h of headers) {
      const e = u32(h + 4) - 0x08000000, cnt = R[e + 3]; if (!cnt) continue;
      const b = u32(e + 16) - 0x08000000;
      for (let k = 0; k < cnt; k++) { const x = b + k * 12; if (R[x + 5] === 7 && u16(x + 8) > 0 && u16(x + 8) < 400) D.hidden.push(x + 8); }
    }
    D.hidden = [...new Set(D.hidden)];

    // event scripts live around the starter scripts; static encounters are found there
    D.scriptLo = Math.max(0, D.starters[0].off - 0x20000); D.scriptHi = Math.min(R.length, D.starters[0].off + 0x80000);

    // items: 44-byte entries, pointed to from FireRed's item code
    i = find(R, Uint8Array.of(...enc('MASTER BALL'), 0xFF)); if (i < 0) fail('the items');
    D.items = i - 44; D.itemCount = 375; // FireRed's item list; MaxDex keeps it
    if (u16(D.items + 374 * 44 + 14) !== 374) fail('the items');
    D.itemName = (k) => str(D.items + k * 44);
    D.itemPocket = (k) => R[D.items + k * 44 + 26];

    // free space for rebuilt trainer parties: the run of 0xFF at the end of the game
    let f = R.length; while (f > 0 && R[f - 1] === 0xFF) f--;
    D.free = (f + 0x1000) & ~0xFFF;
    if (R.length - D.free < 0x20000) fail('free space');
    return D;
  }

  function randomize(input, presetName, seed) {
    const opts = PRESETS[presetName] || PRESETS.Kaizo;
    const R = new Uint8Array(input); // copy
    const D = locate(R);
    const { dv, u16, u32 } = D;
    const w16 = (o, v) => dv.setUint16(o, v, true), w32 = (o, v) => dv.setUint32(o, v, true);
    seed = seed == null ? (crypto.getRandomValues(new Uint32Array(1))[0]) : seed;
    const rnd = rng(seed);
    const log = [];
    // display names: MaxDex's own are cut to 10 letters ("RoarinMoon") and mark forms with a letter ("WeezingG")
    const MN = typeof KPMaxNames !== 'undefined' ? KPMaxNames : (typeof require === 'function' ? require('./kp-maxnames.js') : null);
    const rawNames = []; for (let s = 0; s < D.count; s++) rawNames.push(D.name(s));
    const shown = MN ? MN.species(rawNames) : rawNames;
    const N = (s) => shown[s] || D.name(s) || ('#' + s);
    const abilTitle = (a) => (MN ? MN.title(D.abilName(a)) : D.abilName(a));

    // ---- species pools ----
    const valid = new Set();
    let lastNational = -1; for (let s = 1; s < D.count; s++) if (D.name(s) === 'Pecharunt') lastNational = s;
    if (lastNational < 0) lastNational = D.count - 1;
    const baseByName = new Map();
    for (let s = 1; s <= lastNational; s++) {
      const nm = D.name(s); if (!nm || /^\?+$/.test(nm) || nm === '-' || D.bst(s) === 0) continue;
      valid.add(s); baseByName.set(nm, s);
    }
    // Alternate forms (regional forms, Megas, battle forms) are left out of every pool, as in the site's presets
    // (Universal Pokémon Randomizer: no alt formes for starters, wild, trainers or static encounters).
    const legendNorm = LEGENDS.map(norm);
    const isLegend = (s) => {
      const a = norm(D.name(s));
      return legendNorm.some((b) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a))));
    };
    const evoTargets = (s) => D.evoList(s).map((e) => e.target).filter((t) => valid.has(t));
    const all = [...valid];
    const nonLegend = all.filter((s) => !isLegend(s));
    const fullyEvolved = all.filter((s) => evoTargets(s).length === 0);
    const evolveTimes = (s, k) => { for (let i = 0; i < k; i++) { const t = evoTargets(s); if (!t.length) break; s = t[0]; } return s; };

    let free = D.free; // free space for rebuilt move lists and trainer teams
    // ---- base stats: same total, split at random (as the regular randomizer does) ----
    const allSpecies = []; for (let s = 1; s < D.count; s++) if (D.bst(s) > 0 && D.name(s) && !/^\?+$/.test(D.name(s))) allSpecies.push(s);
    if (opts.stats) {
      for (const s of allSpecies) {
        const o = D.stats + s * D.statSize, shed = D.name(s) === 'Shedinja';
        const total = D.bst(s);
        for (let tries = 0; tries < 50; tries++) {
          const wt = [0, 0, 0, 0, 0, 0].map(() => rnd.next()), tw = wt.reduce((a, b) => a + b, 0) - (shed ? wt[0] : 0);
          const pool = total - (shed ? 51 : 70);
          const v = wt.map((x, k) => (shed && k === 0 ? 1 : Math.max(1, Math.round(x / tw * pool)) + (k === 0 ? 20 : 10)));
          if (v.every((x) => x <= 255)) { for (let k = 0; k < 6; k++) R[o + k] = v[k]; break; }
        }
      }
    }
    // ---- abilities, the way Universal Pokémon Randomizer does it with the site's presets ----
    // Banned: Wonder Guard, trapping abilities (Shadow Tag, Magnet Pull, Arena Trap), abilities that only work for one
    // Pokémon's form, and duplicate abilities (Vital Spirit = Insomnia, etc.), which instead share their original's chance.
    // A second ability is added half the time, and a Pokémon that has Wonder Guard keeps its abilities.
    const BAN_ABIL = new Set(['wonderguard', 'shadowtag', 'magnetpull', 'arenatrap', 'forecast', 'multitype', 'flowergift', 'zenmode',
      'stancechange', 'shieldsdown', 'schooling', 'disguise', 'battlebond', 'powerconstruct', 'rkssystem', 'cacophony',
      'gulpmissile', 'iceface', 'hungerswitch', 'zerotohero', 'commander', 'terashift', 'teraformzero',
      'vitalspirit', 'whitesmoke', 'purepower', 'shellarmor', 'airlock', 'solidrock', 'ironbarbs', 'turboblaze', 'teravolt',
      'emergencyexit', 'dazzling', 'tanglinghair', 'powerofalchemy', 'fullmetalbody', 'shadowshield', 'prismarmor', 'libero', 'stalwart']);
    const VARIANTS = { insomnia: ['vitalspirit'], clearbody: ['whitesmoke', 'fullmetalbody'], hugepower: ['purepower'], battlearmor: ['shellarmor'],
      cloudnine: ['airlock'], filter: ['solidrock', 'prismarmor'], roughskin: ['ironbarbs'], moldbreaker: ['turboblaze', 'teravolt'],
      wimpout: ['emergencyexit'], queenlymajesty: ['dazzling'], gooey: ['tanglinghair'], receiver: ['powerofalchemy'], multiscale: ['shadowshield'],
      protean: ['libero'], propellertail: ['stalwart'] };
    // (species store abilities in one byte, so only the first 255 can be given)
    const abilId = new Map(); for (let a = 1; a < Math.min(D.abilCount, 256); a++) if (!abilId.has(norm(D.abilName(a)))) abilId.set(norm(D.abilName(a)), a);
    // Which abilities work. MaxDex v1.1 gives real descriptions to abilities 1-195; later ones only repeat their name.
    // Reading the battle code (the ability handler's jump table and every comparison against a battler's ability)
    // found working code for the newer abilities below, so they're in the pool and get a description. Newer
    // abilities whose code couldn't be found are left out. (Species store abilities in one byte, so only the first
    // 255 can be given at all.)
    const DESC = {
      gluttony: 'Eats pinch Berries early.', unburden: 'Ups Speed after using its item.', pickpocket: 'Steals an item on contact.',
      cursedbody: 'May disable a move that hits.', healer: 'May heal an ally\'s status.', friendguard: 'Lowers damage to allies.',
      regenerator: 'Restores HP when switched out.', illusion: 'Disguises as the last ally.', mummy: 'Contact spreads Mummy.',
      turboblaze: 'Moves ignore abilities.', teravolt: 'Moves ignore abilities.', cheekpouch: 'Berries also restore HP.',
      protean: 'Becomes the type of its move.', magician: 'Steals the target\'s item.', parentalbond: 'Attacks twice in a turn.',
      primordialsea: 'Summons heavy rain.', desolateland: 'Summons extreme sunlight.', merciless: 'Always crits poisoned foes.',
      waterbubble: 'Ups Water moves, halves Fire.', steelworker: 'Powers up Steel moves.', liquidvoice: 'Sound moves become Water.',
      triage: 'Healing moves go first.', surgesurfer: 'Faster on Electric Terrain.', corrosion: 'Can poison any type.',
      queenlymajesty: 'Blocks priority moves.', innardsout: 'Hurts the foe when it faints.', dancer: 'Copies dance moves.',
      dazzling: 'Blocks priority moves.', electricsurge: 'Sets Electric Terrain.', psychicsurge: 'Sets Psychic Terrain.',
      grassysurge: 'Sets Grassy Terrain.', shadowshield: 'Halves damage at full HP.', neuroforce: 'Ups super effective hits.',
      intrepidsword: 'Raises Attack on entry.', dauntlessshield: 'Raises Defense on entry.', libero: 'Becomes the type of its move.',
      cottondown: 'Lowers foes\' Speed when hit.', sandspit: 'Whips up a sandstorm when hit.', icescales: 'Halves special damage.',
      ripen: 'Doubles Berry effects.', powerspot: 'Powers up allies\' moves.',
    };
    const placeholderDesc = (a) => norm(D.abilDescText(a)) === norm(D.abilName(a));
    const works = (a) => D.abilDesc === undefined || !placeholderDesc(a) || !!DESC[norm(D.abilName(a))];
    for (let a = 1; a < Math.min(D.abilCount, 256); a++) {
      const d = DESC[norm(D.abilName(a))];
      if (d && placeholderDesc(a) && D.abilDesc !== undefined) { const t = enc(d); R.set(t, free); R[free + t.length] = 0xFF; w32(D.abilDesc + a * 4, free + 0x08000000); free += t.length + 1; }
    }
    const abilPool = []; for (let a = 1; a < Math.min(D.abilCount, 256); a++) if (works(a) && !BAN_ABIL.has(norm(D.abilName(a))) && !/^-+$/.test(D.abilName(a))) abilPool.push(a);
    const pickAbility = (...not) => {
      for (;;) {
        let a = rnd.pick(abilPool);
        if (not.includes(a)) continue;
        const v = VARIANTS[norm(D.abilName(a))];
        if (v) { const opts2 = [a, ...v.map((x) => abilId.get(x)).filter((x) => x && x < 256 && works(x))]; a = rnd.pick(opts2); }
        return a;
      }
    };
    const wonderGuard = abilId.get('wonderguard');
    if (opts.abilities && abilPool.length > 20) {
      for (const s of allSpecies) {
        const o = D.stats + s * D.statSize;
        if (wonderGuard && (u16(o + 22) === wonderGuard || u16(o + 24) === wonderGuard)) continue;
        const a1 = pickAbility();
        const a2 = rnd.next() < 0.5 ? pickAbility(a1) : 0;
        w16(o + 22, a1); w16(o + 24, a2);
      }
    }
    // ---- level-up moves, the way Universal Pokémon Randomizer does it ("completely random", 4 guaranteed moves) ----
    // Valid moves: everything with battle data except Struggle and HMs. The last level-1 move is always a good damaging
    // move whose category (physical/special) follows the Pokémon's Attack vs Sp. Atk; if a Pokémon learns fewer than 4
    // moves at level 1, extra level-1 slots are added. Lists are rebuilt in free space, since they can grow.
    const HMS = new Set(['cut', 'fly', 'surf', 'strength', 'flash', 'rocksmash', 'waterfall', 'dive']);
    const NOT_DAMAGING = new Set(['selfdestruct', 'dreameater', 'explosion', 'snore', 'falseswipe', 'futuresight', 'fakeout', 'focuspunch',
      'doomdesire', 'feint', 'lastresort', 'suckerpunch', 'constrict', 'rage', 'rollout', 'iceball', 'synchronoise', 'shelltrap', 'foulplay',
      'spitup', 'sonicboom', 'dragonrage', 'horndrill', 'guillotine', 'fissure', 'sheercold']);
    const MULTI2 = new Set(['bonemerang', 'doublehit', 'doubleironbash', 'doublekick', 'dragondarts', 'dualchop', 'geargrind', 'twineedle', 'dualwingbeat', 'twinbeam']);
    const MULTI5 = new Set(['armthrust', 'barrage', 'bonerush', 'bulletseed', 'cometpunch', 'doubleslap', 'furyattack', 'furyswipes', 'iciclespear', 'pinmissile', 'rockblast', 'spikecannon', 'tailslap', 'watershuriken', 'scaleshot']);
    const md = (m, k) => R[D.moveData + m * 12 + k];
    const validMoves = [], damaging = [];
    for (let m = 1; m < D.moveCount; m++) {
      const nm = norm(D.moveName(m));
      if (!D.movePP(m) || nm === 'struggle' || HMS.has(nm)) continue;
      validMoves.push(m);
      const pow = md(m, 2) * (MULTI2.has(nm) ? 2 : MULTI5.has(nm) ? 3 : 1), acc = md(m, 5);
      if (!NOT_DAMAGING.has(nm) && md(m, 4) !== 2 && (pow >= 100 || (pow >= 50 && (acc >= 90 || acc === 0)))) damaging.push(m);
    }
    const readList = (s) => D.learnEntries(s).map((e) => ({ move: u16(e), level: R[e + 2] }));
    const writeList = (s, list) => {
      const at = free; free += list.length * 3 + 3;
      list.forEach((x, k) => { w16(at + k * 3, x.move); R[at + k * 3 + 2] = x.level; });
      w16(at + list.length * 3, 0); R[at + list.length * 3 + 2] = 0xFF;
      w32(D.learn + s * 4, at + 0x08000000);
    };
    for (const s of allSpecies) {
      const list = readList(s); if (!list.length) continue;
      if (opts.moves) {
        // 4 starting moves: add level-1 slots after any evolution (level 0) moves
        const lv1count = list.filter((x) => x.level === 1).length;
        let firstReal = 0; while (firstReal < list.length && list[firstReal].level === 0) firstReal++;
        for (let k = lv1count; k < 4; k++) list.splice(firstReal, 0, { move: 0, level: 1 });
        // last level-1 move
        let lv1index = firstReal; while (lv1index < list.length && list[lv1index].level === 1) lv1index++;
        if (lv1index > 0) lv1index--;
        const o = D.stats + s * D.statSize, ratio = R[o + 1] / ((R[o + 1] + R[o + 4]) || 1);
        const learnt = []; let lv1Attack = 0;
        for (let i = 0; i < list.length; i++) {
          let pickList = validMoves;
          if (i === lv1index) {
            pickList = damaging.some((m) => !learnt.includes(m)) ? damaging : validMoves;
            const cat = rnd.next() < ratio ? 0 : 1, filt = pickList.filter((m) => md(m, 4) === cat);
            if (filt.some((m) => !learnt.includes(m))) pickList = filt;
          }
          let m = rnd.pick(pickList); while (learnt.includes(m)) m = rnd.pick(pickList);
          if (i === lv1index) lv1Attack = m;
          learnt.push(m);
        }
        // shuffle, keeping the damaging move in the last level-1 slot
        for (let i = learnt.length - 1; i > 0; i--) { const j = rnd.int(i + 1); [learnt[i], learnt[j]] = [learnt[j], learnt[i]]; }
        const at = learnt.indexOf(lv1Attack); [learnt[at], learnt[lv1index]] = [learnt[lv1index], learnt[at]];
        learnt.forEach((m, i) => { list[i].move = m; });
        list[lv1index].level = 1;
        writeList(s, list);
      } else {
        // Casual keeps MaxDex's moves but fills its blank entries (the game stops reading a list at a blank one)
        const used = new Set(list.map((x) => x.move));
        let changed = false;
        for (const x of list) if (!x.move) { let m; do { m = rnd.pick(validMoves); } while (used.has(m)); used.add(m); x.move = m; changed = true; }
        if (changed) writeList(s, list);
      }
    }

    // ---- starters ----
    const order = [1, 4, 7]; // Bulbasaur, Charmander, Squirtle
    const newStarters = [];
    while (newStarters.length < 3) { const s = rnd.pick(all); if (!newStarters.includes(s)) newStarters.push(s); }
    const starterFor = (orig) => newStarters[order.indexOf(orig)];
    for (const st of D.starters) { w16(st.off, starterFor(u16(st.off))); w16(st.rivalOff, starterFor(u16(st.rivalOff))); }
    // FireRed's starter table (Bulbasaur, Squirtle, Charmander, by the slot you picked): the game looks up "your
    // starter" there, so it must hold the new starters too.
    for (let k = D.starterTable === undefined ? -1 : 0; k >= 0 && k < 3; k++) w16(D.starterTable + 2 * k, starterFor(u16(D.starterTable + 2 * k)));
    // Oak's "I see! BULBASAUR is your choice. ... the GRASS POKéMON BULBASAUR?" lines
    for (let k = 0; k < 3; k++) {
      const orig = ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE'][k];
      const hit = find(R, Uint8Array.of(...enc(' ' + orig + ' is your choice')), D.scriptLo, D.scriptHi); if (hit < 0) continue;
      let at = hit; while (at > 0 && R[at - 1] !== 0xFF) at--;
      let end = hit; while (R[end] !== 0xFF) end++;
      const s = newStarters[k], tn = TYPE_NAMES[D.types(s)[0]] || 'NORMAL', nm = (N(s).length <= 12 ? N(s) : D.name(s)).toUpperCase();
      const msg = [...enc('I see! ' + nm + ' is your choice.'), 0xFB, ...enc('So, '), 0xFD, 0x01, ...enc(', you want'), 0xFE,
        ...enc('the ' + tn + ' POK\u00e9MON ' + nm + '?')];
      if (msg.length <= end - at) { R.set(msg, at); R.fill(0xFF, at + msg.length, end); }
    }
    const describe = (s) => {
      const o = D.stats + s * D.statSize, st = [...R.slice(o, o + 6)];
      const ab = [u16(o + 22), u16(o + 24)].filter(Boolean).map(abilTitle).join(' / ');
      return N(s) + ': HP ' + st[0] + ', Atk ' + st[1] + ', Def ' + st[2] + ', Spe ' + st[3] + ', SpA ' + st[4] + ', SpD ' + st[5] + ' | ' + ab;
    };
    const learnTxt = (s) => D.learnEntries(s).map((e) => D.moveName(u16(e)) + ' ' + (R[e + 2] || 'Evo')).join(', ');
    // Starters hold a random item (the presets' "random starter held items", bad items banned): the lab's
    // givemon 0x4002, 5, item. Held items: Berries and hold items, minus the useless ones.
    const HOLD_BAN = new Set([175, 176, 177, 178, 181, 184, 186, 191, 197, 199, 202, 205, 206, 214, 215, 218, 219, 220, 221, 222, 223, 224, 225]);
    const holdItems = []; for (let k = 133; k <= 225; k++) if (!HOLD_BAN.has(k) && !/^\?/.test(D.itemName(k)) && D.itemPocket(k) !== 2) holdItems.push(k);
    const starterItems = [];
    for (let k = D.starters[0].off - 0x400; k < D.starters[0].off + 0x800; k++) {
      if (R[k] === 0x79 && R[k + 1] === 0x02 && R[k + 2] === 0x40 && R[k + 3] === 5 && u16(k + 4) === 0 && u32(k + 6) === 0) { const it = rnd.pick(holdItems); w16(k + 4, it); starterItems.push(it); }
    }
    log.push('--Starters--');
    if (starterItems.length) log.push('Starter held item: ' + starterItems.map((i) => D.itemName(i)).join(', '));
    ['Bulbasaur', 'Charmander', 'Squirtle'].forEach((o, k) => log.push(o + ' -> ' + describe(newStarters[k]), '  Moves: ' + learnTxt(newStarters[k])));
    log.push('');

    // ---- wild Pokémon: each species in an area maps to its own random species; levels scaled ----
    const lvl = (l) => Math.max(1, Math.min(100, Math.round(l * opts.levels)));
    log.push('--Wild Pokémon--');
    const KIND = ['Grass/Cave', 'Surfing', 'Rock Smash', 'Fishing'];
    const SLOTS = [12, 5, 5, 10];
    const doneTables = new Set();
    for (let h = 0; h < D.wildCount; h++) {
      const o = D.wild + h * 20, g = R[o], m = R[o + 1];
      for (let k = 0; k < 4; k++) {
        const p = u32(o + 4 + k * 4); if (!p) continue;
        const info = p - 0x08000000, arr = u32(info + 4) - 0x08000000;
        if (doneTables.has(arr)) continue; doneTables.add(arr);
        const map = new Map(), used = new Set();
        const parts = [];
        for (let sl = 0; sl < SLOTS[k]; sl++) {
          const e = arr + sl * 4, sp = u16(e + 2);
          if (!map.has(sp)) { let r; let tries = 0; do { r = rnd.pick(nonLegend); } while (used.has(r) && tries++ < 50); used.add(r); map.set(sp, r); }
          R[e] = lvl(R[e]); R[e + 1] = Math.max(R[e], lvl(R[e + 1])); w16(e + 2, map.get(sp));
        }
        for (const [a, b] of map) parts.push(N(a) + ' -> ' + N(b));
        log.push(D.mapName(g, m) + ' (' + KIND[k] + '): ' + parts.join(', '));
      }
    }
    log.push('');

    // ---- trainers ----
    const RIVAL_CLASSES = new Set([81, 89, 90]), BOSS_CLASSES = new Set([84, 87, 90]);
    const rivalMap = new Map();
    const starterLine = (sp) => (sp >= 1 && sp <= 9 ? { line: Math.floor((sp - 1) / 3), stage: (sp - 1) % 3 } : null);
    // legendaries only on the rival and bosses' teams
    const fullyEvolvedNL = fullyEvolved.filter((s) => !isLegend(s));
    const pickTrainerMon = (level, boss) => {
      const late = opts.evolvedAt ? level >= opts.evolvedAt : level >= 30;
      const pool = opts.evolvedAt && late ? (boss ? fullyEvolved : fullyEvolvedNL) : (boss && late ? all : nonLegend);
      for (;;) { const s = rnd.pick(pool); if (level < 20 && D.name(s) === 'Shedinja') continue; return s; }
    };
    // held items trainers may get in Super Kaizo: consumable battle items
    const TRAINER_ITEMS = [133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 168, 169, 170, 171, 172, 173, 174, 175, 179, 183, 186, 187, 191, 196, 197, 198, 200, 204, 207, 209, 210, 211, 212, 214, 215, 216, 217, 218, 219, 220, 221];
    log.push('--Trainers--');
    for (let t = 0; t < D.trainerCount; t++) {
      const o = D.trainers + t * 40, flags = R[o], cls = R[o + 1], size = R[o + 32];
      const party = u32(o + 36) - 0x08000000, es = flags & 1 ? 16 : 8;
      if (!size) continue;
      const mons = [];
      for (let k = 0; k < size; k++) {
        const e = party + k * es;
        mons.push({ iv: u16(e), level: u16(e + 2), species: u16(e + 4), item: flags & 2 ? u16(e + 6) : 0 });
      }
      const tname = (() => { let s = ''; for (let k = 4; k < 16 && R[o + k] !== 0xFF; k++) s += DEC[R[o + k]] || ''; return s; })();
      const isRival = RIVAL_CLASSES.has(cls) && mons.some((x) => starterLine(x.species));
      const before = mons.map((x) => N(x.species) + ' Lv' + x.level).join(', ');
      for (const x of mons) {
        x.level = lvl(x.level);
        const sl = isRival && starterLine(x.species);
        if (sl) x.species = evolveTimes(newStarters[sl.line], sl.stage);
        else if (isRival) { if (!rivalMap.has(x.species)) rivalMap.set(x.species, pickTrainerMon(x.level, true)); x.species = rivalMap.get(x.species); }
        else x.species = pickTrainerMon(x.level, BOSS_CLASSES.has(cls));
        if (opts.trainerItems && BOSS_CLASSES.has(cls)) x.item = rnd.pick(TRAINER_ITEMS);
      }
      if (opts.bossExtra && BOSS_CLASSES.has(cls) && tname !== '' && mons.length < 6 && mons[0].level > 5) {
        const top = Math.max(...mons.map((x) => x.level));
        for (let k = 0; k < opts.bossExtra && mons.length < 6; k++) mons.unshift({ iv: mons[0].iv, level: Math.max(1, top - 2 - k), species: pickTrainerMon(top - 2 - k, true), item: 0 });
      }
      // rebuild as 8-byte entries without custom moves, so each Pokémon uses its own level-up moves
      const nf = (flags & 2) | (opts.trainerItems && BOSS_CLASSES.has(cls) ? 2 : 0);
      // written to free space: some trainers share one party list, so the original stays readable
      const dst = free; free += mons.length * 8;
      mons.forEach((x, k) => { const e = dst + k * 8; w16(e, x.iv); w16(e + 2, x.level); w16(e + 4, x.species); w16(e + 6, nf & 2 ? x.item : 0); });
      R[o] = nf; R[o + 32] = mons.length; w32(o + 36, dst + 0x08000000);
      if (tname && !(mons.length === 1 && before === 'Ekans Lv5')) log.push('#' + t + ' ' + tname + ' (' + before + ') -> ' + mons.map((x) => N(x.species) + ' Lv' + x.level).join(', '));
    }
    if (free > R.length) throw new Error('Not enough free space in the game for the trainer teams.');
    log.push('');

    // ---- static encounters and gifts ----
    log.push('--Static Pokémon--');
    const anchors = [];
    for (let k = D.scriptLo; k + 16 < D.scriptHi; k++) {
      const op = R[k];
      if (op === 0xB6) { // setwildbattle species, level, item
        const s = u16(k + 1), l = R[k + 3], it = u16(k + 4);
        // followed by dowildbattle, a cry or the legendary-battle special
        let next = false; for (let j = k + 6; j < k + 18; j++) if (R[j] === 0xB7 || R[j] === 0xA1 || R[j] === 0x25) next = true;
        if (next && valid.has(s) && l >= 1 && l <= 100 && it < 400 && D.name(s) !== 'Marowak') anchors.push({ at: k, s, lvAt: k + 3 });
      } else if (op === 0x79) { // givemon species, level, item, 0, 0, 0
        const s = u16(k + 1), l = R[k + 3], it = u16(k + 4);
        if (valid.has(s) && l >= 1 && l <= 100 && it < 400 && u32(k + 6) === 0 && u32(k + 10) === 0) anchors.push({ at: k, s, lvAt: k + 3 });
      } else if (op === 0x16 && R[k + 1] === 4 && R[k + 2] === 0x80 && R[k + 5] === 0x16 && R[k + 6] === 5 && R[k + 7] === 0x80) {
        // legendary battles: setvar 0x8004, species; setvar 0x8005, level; ... special
        // (0x8004/0x8005 are used for lots of other things, so it must follow a cry of the same species)
        const s = u16(k + 3), l = u16(k + 8);
        let cry = false; for (let j = k - 0x60; j < k; j++) if (R[j] === 0xA1 && u16(j + 1) === s) cry = true;
        if (cry && valid.has(s) && l >= 1 && l <= 100) anchors.push({ at: k, s, lvAt: -1 });
      }
    }
    const staticMap = new Map();
    for (const a of anchors) {
      if (!staticMap.has(a.s)) staticMap.set(a.s, rnd.pick(all));
      const ns = staticMap.get(a.s);
      // the same species in this script: cries, pictures, name buffers, checks
      const lo = Math.max(D.scriptLo, a.at - 0x100), hi = Math.min(D.scriptHi - 4, a.at + 0x100);
      for (let k = lo; k < hi; k++) {
        const op = R[k];
        let off = -1;
        if (op === 0xA1 || op === 0x75 || op === 0xB6 || op === 0x79) off = k + 1;
        else if (op === 0x7D && R[k + 1] < 4) off = k + 2;
        else if ((op === 0x16 || op === 0x21) && R[k + 1] === 4 && R[k + 2] === 0x80) off = k + 3;
        if (off >= 0 && u16(off) === a.s) w16(off, ns);
      }
    }
    for (const [a, b] of staticMap) log.push(N(a) + ' -> ' + N(b));
    log.push('');

    // ---- field items: TMs stay TMs, other items come from the usable ones ----
    const banned = new Set([0, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 72, 82, 87, 88, 89, 90, 91, 92, 99, 100, 101, 102, 105,
      112, 113, 114, 115, 116, 117, 118, 119, 120, 176, 177, 178, 267, 347, 348, 46, 47, 48, 49, 50, 51, 191, 202, 139]);
    const isTM = (k) => k >= 289 && k <= 338;
    const goodItems = [], tms = [];
    for (let k = 1; k < Math.min(D.itemCount, 375); k++) {
      if (isTM(k)) { tms.push(k); continue; }
      if (banned.has(k) || (k >= 121 && k <= 132) || (k >= 143 && k <= 175) || (k >= 222 && k <= 225) || (k >= 254 && k <= 258)
        || (k >= 226 && k <= 253 && D.itemName(k).startsWith('?')) || k >= 259) continue;
      if (D.itemPocket(k) === 2 || /^\?/.test(D.itemName(k))) continue;
      goodItems.push(k);
    }
    log.push('--Field Items--');
    let changedItems = 0;
    for (const off of [...D.itemBalls, ...D.hidden]) {
      const it = u16(off); if (!it || it >= 375) continue;
      if (D.itemPocket(it) === 2 || (it >= 339 && it <= 346)) continue; // key items and HMs stay
      const ni = isTM(it) ? rnd.pick(tms) : rnd.pick(goodItems);
      w16(off, ni); changedItems++;
    }
    log.push(changedItems + ' items randomized (' + D.itemBalls.length + ' item balls, ' + D.hidden.length + ' hidden items).', '');

    if (opts.stats || opts.abilities || opts.moves) {
      log.push('--Pok\u00e9mon (stats, abilities, level-up moves)--');
      for (const s of all) log.push(describe(s), '  ' + learnTxt(s));
      log.push('');
    }
    const head = ['Randomized FireRed MaxDex', 'Preset: ' + (PRESETS[presetName] ? presetName : 'Kaizo'), 'Seed: ' + seed, ''];
    return { rom: R, log: head.concat(log).join('\n'), seed, starters: newStarters.map(N) };
  }

  return { randomize, locate, PRESETS: Object.keys(PRESETS) };
})();
if (typeof module !== 'undefined') module.exports = KPMaxDex;
