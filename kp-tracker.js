// IronMON-style tracker data for Gen 3 games (Emerald, FireRed/LeafGreen, Ruby/Sapphire).
// Game data (names, types, base stats, moves) comes from the randomized game file itself, so it matches the run;
// the lead Pokémon, bag and opponent come from live memory in an emulator save state (via KPGen3's state reader).
//   const t = KPTracker.load(romArrayBuffer)   -> tracker or null if the game isn't supported
//   t.read(stateBytes) -> { mon, foe } (either may be null)
const KPTracker = (() => {
  const TYPES = ['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', '???', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark'];
  // Gen 3 type chart: attacking type -> {defending type: multiplier}, only the entries that aren't ×1.
  const CHART = {
    Normal: { Rock: .5, Steel: .5, Ghost: 0 },
    Fire: { Fire: .5, Water: .5, Grass: 2, Ice: 2, Bug: 2, Rock: .5, Dragon: .5, Steel: 2 },
    Water: { Fire: 2, Water: .5, Grass: .5, Ground: 2, Rock: 2, Dragon: .5 },
    Electric: { Water: 2, Electric: .5, Grass: .5, Ground: 0, Flying: 2, Dragon: .5 },
    Grass: { Fire: .5, Water: 2, Grass: .5, Poison: .5, Ground: 2, Flying: .5, Bug: .5, Rock: 2, Dragon: .5, Steel: .5 },
    Ice: { Fire: .5, Water: .5, Grass: 2, Ice: .5, Ground: 2, Flying: 2, Dragon: 2, Steel: .5 },
    Fighting: { Normal: 2, Ice: 2, Poison: .5, Flying: .5, Psychic: .5, Bug: .5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2 },
    Poison: { Grass: 2, Poison: .5, Ground: .5, Rock: .5, Ghost: .5, Steel: 0 },
    Ground: { Fire: 2, Electric: 2, Grass: .5, Poison: 2, Flying: 0, Bug: .5, Rock: 2, Steel: 2 },
    Flying: { Electric: .5, Grass: 2, Fighting: 2, Bug: 2, Rock: .5, Steel: .5 },
    Psychic: { Fighting: 2, Poison: 2, Psychic: .5, Dark: 0, Steel: .5 },
    Bug: { Fire: .5, Grass: 2, Fighting: .5, Poison: .5, Flying: .5, Psychic: 2, Ghost: .5, Dark: 2, Steel: .5 },
    Rock: { Fire: 2, Ice: 2, Fighting: .5, Ground: .5, Flying: 2, Bug: 2, Steel: .5 },
    Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: .5, Steel: .5 },
    Dragon: { Dragon: 2, Steel: .5 },
    Dark: { Fighting: .5, Psychic: 2, Ghost: 2, Dark: .5, Steel: .5 },
    Steel: { Fire: .5, Water: .5, Electric: .5, Ice: 2, Rock: 2, Steel: .5 },
  };
  const effectiveness = (moveType, defTypes) => defTypes.reduce((m, d) => m * ((CHART[moveType] || {})[d] ?? 1), 1);
  const NATURE_STATS = ['ATK', 'DEF', 'SPE', 'SPA', 'SPD'];
  // HP restored by healing items (item id -> HP; Infinity = full heal). Gen 3 item ids.
  const HEALS = { 13: 20, 19: Infinity, 20: Infinity, 21: 200, 22: 50, 26: 50, 27: 60, 28: 80, 29: 100, 30: 50, 31: 200, 44: 20, 139: 10, 142: 30 };
  const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
    'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];

  // Live-memory addresses per game family. inBattle is gMain + 0x439, bit 1 (gMain's first word must be a ROM pointer).
  const LIVE = {
    E:    { party: 0x020244EC, partyCount: 0x020244E9, enemy: 0x02024744, gMain: 0x030022C0, sb1Ptr: 0x03005D8C, sb2Ptr: 0x03005D90,
            items: [0x560, 30], berries: [0x790, 46], keyOff: 0xAC },
    FRLG: { party: 0x02024284, partyCount: 0x02024029, enemy: 0x0202402C, gMain: 0x030030F0, sb1Ptr: 0x03005008, sb2Ptr: 0x0300500C,
            items: [0x310, 42], berries: [0x54C, 43], keyOff: 0xF20 },
    RS:   { party: 0x03004360, partyCount: 0x03004350, enemy: 0x030045C0, gMain: null, sb1: 0x02025734, sb2: 0x02024EA4,
            items: [0x560, 20], berries: [0x740, 46], keyOff: null },
  };
  const FAMILY = { BPEE: 'E', AXVE: 'RS', AXPE: 'RS', BPRE: 'FRLG', BPGE: 'FRLG' };
  // Known table offsets (US 1.0); each is checked, and found by searching the file if the check fails.
  const KNOWN = {
    BPEE: { species: 0x3185C8, moveNames: 0x31977C, abilities: 0x31B6DB, moves: 0x31C898, stats: 0x3203CC, items: 0x5839A0, learnsets: 0x32937C },
  };

  // Gen 3 text encoding for the names we need.
  const enc = (s) => Array.from(s, (ch) => {
    if (ch >= 'A' && ch <= 'Z') return 0xBB + ch.charCodeAt(0) - 65;
    if (ch >= 'a' && ch <= 'z') return 0xD5 + ch.charCodeAt(0) - 97;
    if (ch >= '0' && ch <= '9') return 0xA1 + ch.charCodeAt(0) - 48;
    return ({ ' ': 0x00, '-': 0xAE, '?': 0xAC, '.': 0xAD })[ch];
  });
  function decode(u8, off, len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      const c = u8[off + i];
      if (c === 0xFF) break;
      if (c >= 0xBB && c <= 0xD4) s += String.fromCharCode(65 + c - 0xBB);
      else if (c >= 0xD5 && c <= 0xEE) s += String.fromCharCode(97 + c - 0xD5);
      else if (c >= 0xA1 && c <= 0xAA) s += String.fromCharCode(48 + c - 0xA1);
      else if (c === 0x00) s += ' ';
      else s += ({ 0xAB: '!', 0xAC: '?', 0xAD: '.', 0xAE: '-', 0xB0: '…', 0xB4: '’', 0xB5: '♂', 0xB6: '♀', 0xB8: ',', 0xBA: '/' })[c] || '';
    }
    return s.trim();
  }
  // Title case for ROM names in capitals ("POISON STING" -> "Poison Sting"), keeping names like "PP" readable.
  const nice = (s) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  function find(rom, bytes, from = 0) {
    const first = bytes[0], n = bytes.length;
    outer: for (let i = rom.indexOf(first, from); i !== -1 && i + n <= rom.length; i = rom.indexOf(first, i + 1)) {
      for (let k = 1; k < n; k++) if (rom[i + k] !== bytes[k]) continue outer;
      return i;
    }
    return -1;
  }
  const nameAt = (rom, base, stride, i, len) => decode(rom, base + stride * i, len);

  // ---- Locate and check the game data tables ----
  function locate(rom, code) {
    const k = KNOWN[code] || {};
    const out = {};
    const check = {
      species: (o) => nameAt(rom, o, 11, 1, 11) === 'BULBASAUR' && nameAt(rom, o, 11, 4, 11) === 'CHARMANDER',
      moveNames: (o) => nameAt(rom, o, 13, 1, 13) === 'POUND' && nameAt(rom, o, 13, 33, 13) === 'TACKLE',
      abilities: (o) => nameAt(rom, o, 13, 1, 13) === 'STENCH' && nameAt(rom, o, 13, 2, 13) === 'DRIZZLE',
      items: (o) => nameAt(rom, o, 44, 1, 14) === 'MASTER BALL' && nameAt(rom, o, 44, 13, 14) === 'POTION',
      // Base stats: entry 0 is empty; real entries have valid types and abilities.
      stats: (o) => {
        if (o < 0 || o + 28 * 412 > rom.length) return false;
        for (let b = 0; b < 28; b++) if (rom[o + b]) return false;
        for (let i = 1; i <= 386; i += 17) { const e = o + 28 * i; if (rom[e + 6] > 17 || rom[e + 7] > 17 || rom[e + 22] > 77 || rom[e + 23] > 77 || !rom[e]) return false; }
        return true;
      },
      // Moves: entry 0 is empty; real entries have a valid type, accuracy up to 100 and PP up to 40.
      moves: (o) => {
        if (o < 0 || o + 12 * 355 > rom.length) return false;
        for (let b = 0; b < 12; b++) if (rom[o + b]) return false;
        for (let i = 1; i <= 354; i++) { const e = o + 12 * i; if (rom[e + 2] > 17 || rom[e + 3] > 100 || !rom[e + 4] || rom[e + 4] > 64) return false; }
        return true;
      },
    };
    // Level-up moves: a table of 412 ROM pointers, each to a list of (level << 9 | move) ending in 0xFFFF.
    const ptr = (o) => (rom[o] | (rom[o + 1] << 8) | (rom[o + 2] << 16) | (rom[o + 3] << 24)) >>> 0;
    check.learnsets = (o) => {
      if (o < 0 || o + 4 * 412 > rom.length) return false;
      for (let i = 0; i < 412; i++) { const p = ptr(o + 4 * i); if (p < 0x08000000 || p >= 0x08000000 + rom.length) return false; }
      for (const i of [1, 4, 7, 152, 277, 300]) {
        let p = ptr(o + 4 * i) - 0x08000000, ok = false;
        for (let k = 0; k < 40; k++, p += 2) { const w = rom[p] | (rom[p + 1] << 8); if (w === 0xFFFF) { ok = k > 0; break; } if ((w >> 9) > 100 || !(w & 0x1FF) || (w & 0x1FF) > 354) return false; }
        if (!ok) return false;
      }
      return true;
    };
    const search = {
      learnsets: () => { for (let o = 0; o + 4 * 412 <= rom.length; o += 4) if (rom[o + 3] === 0x08 && rom[o + 7] === 0x08 && rom[o + 4 * 411 + 3] === 0x08 && check.learnsets(o)) return o; return -1; },
      species: () => { const p = find(rom, [...enc('BULBASAUR'), 0xFF]); return p - 11; },
      moveNames: () => { const p = find(rom, [...enc('POUND'), 0xFF]); return p - 13; },
      abilities: () => { const p = find(rom, [...enc('STENCH'), 0xFF]); return p - 13; },
      items: () => { const p = find(rom, [...enc('MASTER BALL'), 0xFF]); return p - 44; },
      stats: () => { for (let o = 0; o + 28 * 412 <= rom.length; o += 4) if (rom[o + 28] && check.stats(o)) return o; return -1; },
      moves: () => { for (let o = 0; o + 12 * 355 <= rom.length; o += 4) if (rom[o + 12 + 4] === 35 && check.moves(o)) return o; return -1; },
    };
    for (const key of Object.keys(check)) {
      let o = k[key];
      if (o === undefined || !check[key](o)) { o = search[key](); if (!check[key](o)) o = -1; }
      out[key] = o;
    }
    return out;
  }

  function load(romBuf) {
    const rom = romBuf instanceof Uint8Array ? romBuf : new Uint8Array(romBuf);
    const code = String.fromCharCode(...rom.subarray(0xAC, 0xB0));
    const fam = FAMILY[code];
    if (!fam || typeof KPGen3 === 'undefined') return null;
    const T = locate(rom, code);
    if (T.species < 0 || T.moveNames < 0 || T.stats < 0 || T.moves < 0) return null;
    const cache = {};
    const species = (i) => {
      if (!(i > 0 && i < 412)) return null;
      if (cache[i]) return cache[i];
      const e = T.stats + 28 * i;
      const s = { name: nice(nameAt(rom, T.species, 11, i, 11)), base: [rom[e], rom[e + 1], rom[e + 2], rom[e + 3], rom[e + 4], rom[e + 5]],
        types: [...new Set([TYPES[rom[e + 6]], TYPES[rom[e + 7]]])], abilities: [rom[e + 22], rom[e + 23]] };
      s.bst = s.base.reduce((a, b) => a + b, 0);
      return (cache[i] = s);
    };
    const move = (i) => {
      if (!(i > 0 && i < 355)) return null;
      const e = T.moves + 12 * i;
      return { id: i, name: nice(nameAt(rom, T.moveNames, 13, i, 13)), power: rom[e + 1], type: TYPES[rom[e + 2]], acc: rom[e + 3], pp: rom[e + 4] };
    };
    // Levels at which a species learns moves, from the (randomized) level-up lists.
    const learnLevels = (sp) => {
      if (T.learnsets < 0 || !(sp > 0 && sp < 412)) return [];
      let p = ((rom[T.learnsets + 4 * sp] | (rom[T.learnsets + 4 * sp + 1] << 8) | (rom[T.learnsets + 4 * sp + 2] << 16)) >>> 0);
      const out = [];
      for (let k = 0; k < 40 && p + 1 < rom.length; k++, p += 2) { const w = rom[p] | (rom[p + 1] << 8); if (w === 0xFFFF) break; out.push(w >> 9); }
      return out;
    };
    const ability = (i) => (T.abilities >= 0 && i > 0 ? nice(nameAt(rom, T.abilities, 13, i, 13)) : '');
    const item = (i) => (T.items >= 0 && i > 0 && i < 377 ? nice(nameAt(rom, T.items, 44, i, 14)) : '');
    const A = LIVE[fam];

    function read(state) {
      const mem = KPGen3.stateMemory(state); if (!mem) return null;
      const view = (addr, len) => {
        const reg = addr >= 0x03000000 ? mem.iwram : mem.ewram, off = addr & (addr >= 0x03000000 ? 0x7FFF : 0x3FFFF);
        return off + len <= reg.length ? reg.subarray(off, off + len) : null;
      };
      const dvOf = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
      const u32 = (addr) => { const b = view(addr, 4); return b ? dvOf(b).getUint32(0, true) : 0; };

      // One 100-byte party Pokémon, decrypted and checked.
      function mon(addr) {
        const b = view(addr, 100); if (!b) return null;
        const dv = dvOf(b), pid = dv.getUint32(0, true), otid = dv.getUint32(4, true), key = (pid ^ otid) >>> 0;
        if (!pid && !otid) return null;
        const w = []; let sum = 0;
        for (let i = 0; i < 12; i++) { const v = (dv.getUint32(0x20 + i * 4, true) ^ key) >>> 0; w.push(v); sum = (sum + (v & 0xFFFF) + (v >>> 16)) & 0xFFFF; }
        if (sum !== dv.getUint16(0x1C, true)) return null;
        const o = ORDERS[pid % 24], G = o.indexOf('G') * 3, At = o.indexOf('A') * 3, M = o.indexOf('M') * 3;
        const sp = w[G] & 0xFFFF, info = species(sp), level = b[0x54];
        if (!info || level < 1 || level > 100) return null;
        const ppBonus = w[G + 2] & 0xFF;
        const ids = [w[At] & 0xFFFF, w[At] >>> 16, w[At + 1] & 0xFFFF, w[At + 1] >>> 16];
        const pps = [w[At + 2] & 0xFF, (w[At + 2] >>> 8) & 0xFF, (w[At + 2] >>> 16) & 0xFF, w[At + 2] >>> 24];
        const moves = ids.map((id, i) => { const m = move(id); if (!m) return null; const bonus = (ppBonus >> (2 * i)) & 3; return { ...m, ppLeft: pps[i], ppMax: m.pp + Math.floor(m.pp * bonus / 5) }; }).filter(Boolean);
        const n = pid % 25, up = Math.floor(n / 5), down = n % 5;
        const st = b[0x50];
        const status = st & 7 ? 'SLP' : st & 8 ? 'PSN' : st & 16 ? 'BRN' : st & 32 ? 'FRZ' : st & 64 ? 'PAR' : st & 128 ? 'TOX' : '';
        return {
          pid, species: sp, name: info.name, level, types: info.types, bst: info.bst, status,
          hp: [dv.getUint16(0x56, true), dv.getUint16(0x58, true)],
          stats: { HP: dv.getUint16(0x58, true), ATK: dv.getUint16(0x5A, true), DEF: dv.getUint16(0x5C, true), SPA: dv.getUint16(0x60, true), SPD: dv.getUint16(0x62, true), SPE: dv.getUint16(0x5E, true) },
          up: up === down ? '' : NATURE_STATS[up], down: up === down ? '' : NATURE_STATS[down],
          ability: ability(info.abilities[(w[M + 1] >>> 31) && info.abilities[1] ? 1 : 0]),
          item: item(w[G] >>> 16), moves,
          nextMove: (() => { const lv = learnLevels(sp).find((x) => x > level); return lv ? { level: lv, in: lv - level } : null; })(),
        };
      }

      // The player's party at its known address. A party count of 0 means no Pokémon yet: memory can then hold
      // other Pokémon data (e.g. from the intro), which must never be shown as yours, so memory isn't searched.
      // Only the real party slots count, and only if every slot the count claims holds a valid Pokémon.
      let party = [];
      const cnt = view(A.partyCount, 1);
      if (cnt && cnt[0] >= 1 && cnt[0] <= 6) {
        for (let k = 0; k < cnt[0]; k++) { const m = mon(A.party + 100 * k); if (!m) { party = []; break; } party.push(m); }
      }
      let lead = party[0] || null;

      // In battle: find the Pokémon actually sent out on each side. Gen 3 keeps the party order during battle and keeps
      // the active Pokémon in separate battle records (0x58 bytes: species at 0, stats 2-0x0B, PP 0x24, HP 0x28, level 0x2A,
      // max HP 0x2C, personality 0x48, status 0x4C). Those are found by matching personality, species and level.
      let foe = null, inBattle = false;
      if (A.gMain) {
        const cb = u32(A.gMain), flags = view(A.gMain + 0x439, 1);
        inBattle = !!(cb >= 0x08000000 && cb < 0x0A000000 && flags && (flags[0] & 2));
      }
      if (inBattle) {
        const enemy = []; for (let k = 0; k < 6; k++) { const m = mon(A.enemy + 100 * k); if (!m) break; enemy.push(m); }
        const byPid = new Map(); party.forEach((m) => byPid.set(m.pid, ['p', m])); enemy.forEach((m) => byPid.set(m.pid, ['e', m]));
        const ew = mem.ewram, edv = dvOf(ew);
        let mine = null, theirs = null;
        for (let off = 0; off + 0x58 <= ew.length && !(mine && theirs); off += 4) {
          const hit = byPid.get(edv.getUint32(off + 0x48, true)); if (!hit) continue;
          const [side, m] = hit;
          if (edv.getUint16(off, true) !== m.species || ew[off + 0x2A] !== m.level) continue;
          const live = { m, off };
          if (side === 'p' && !mine) mine = live; else if (side === 'e' && !theirs) theirs = live;
        }
        const applyLive = ({ m, off }) => {
          if (!edv.getUint16(off + 0x2C, true) || !edv.getUint16(off + 2, true)) return m;
          m.hp = [edv.getUint16(off + 0x28, true), edv.getUint16(off + 0x2C, true)];
          m.stats = { HP: m.hp[1], ATK: edv.getUint16(off + 2, true), DEF: edv.getUint16(off + 4, true), SPA: edv.getUint16(off + 8, true), SPD: edv.getUint16(off + 10, true), SPE: edv.getUint16(off + 6, true) };
          m.moves.forEach((mv, i) => { mv.ppLeft = ew[off + 0x24 + i]; });
          // Stat stages (6 = no change): HP, ATK, DEF, SPE, SPA, SPD, ACC, EVA.
          // At the very start of a battle the record isn't filled in yet; the HP stage is always 6 once it is.
          const stg = (i) => ew[off + 0x18 + i] - 6, stages = {};
          if (ew[off + 0x18] === 6) [['ATK', 1], ['DEF', 2], ['SPE', 3], ['SPA', 4], ['SPD', 5], ['ACC', 6], ['EVA', 7]].forEach(([k, i]) => { const v = stg(i); if (v && Math.abs(v) <= 6) stages[k] = v; });
          m.stages = stages;
          const st = ew[off + 0x4C];
          m.status = st & 7 ? 'SLP' : st & 8 ? 'PSN' : st & 16 ? 'BRN' : st & 32 ? 'FRZ' : st & 64 ? 'PAR' : st & 128 ? 'TOX' : '';
          return m;
        };
        if (mine) lead = applyLive(mine);
        const f = theirs ? applyLive(theirs) : enemy[0];
        if (f) foe = { name: f.name, level: f.level, types: f.types, bst: f.bst, hpPct: f.hp[1] ? Math.round(f.hp[0] / f.hp[1] * 100) : 0 };
      }

      // Healing items in the bag.
      let heals = null;
      const sb1 = A.sb1 || u32(A.sb1Ptr), sb2 = A.sb2 || u32(A.sb2Ptr);
      if (lead && sb1 >= 0x02000000 && sb1 < 0x02040000) {
        const keyB = A.keyOff != null && sb2 >= 0x02000000 && sb2 < 0x02040000 ? view(sb2 + A.keyOff, 4) : null;
        const key = keyB ? dvOf(keyB).getUint32(0, true) & 0xFFFF : 0;
        let count = 0, hp = 0, ok = true;
        for (const [off, slots] of [A.items, A.berries]) {
          const b = view(sb1 + off, slots * 4); if (!b) { ok = false; break; }
          const dv = dvOf(b);
          for (let i = 0; i < slots; i++) {
            const id = dv.getUint16(i * 4, true), qty = (dv.getUint16(i * 4 + 2, true) ^ key) & 0xFFFF;
            if (!id) continue;
            if (id > 376 || qty > 999) { ok = false; break; }
            if (HEALS[id]) { count += qty; hp += qty * Math.min(HEALS[id], lead.hp[1]); }
          }
        }
        if (ok) heals = { count, pct: lead.hp[1] ? Math.round(hp / lead.hp[1] * 100) : 0 };
      }
      if (lead) lead.heals = heals;

      if (lead && foe) lead.moves.forEach((m) => { m.eff = m.power ? effectiveness(m.type, foe.types) : null; });
      return { mon: lead, foe };
    }
    return { code, tables: T, read, species, move };
  }
  return { load, effectiveness, TYPES };
})();
if (typeof module !== 'undefined') module.exports = KPTracker;
