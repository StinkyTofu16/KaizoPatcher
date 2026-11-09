// Reads progress from a Gen 3 (Ruby/Sapphire/Emerald/FireRed/LeafGreen) save file.
// KPGen3.read(saveBytes, gameCode, speciesTable) -> {trainer, playMinutes, badges, champion, party:[{species, dex, name, level}]} or null
const KPGen3 = (() => {
  const SECTOR = 0x1000, DATA = 0xF80, SIG = 0x08012025;
  // Per-game layout inside SaveBlock1 (party count/offset) and the badge flags.
  const LAYOUT = {
    E:  { party: 0x234, flags: 0x1270, badge0: 0x867, champ: 0x864 },
    RS: { party: 0x234, flags: 0x1220, badge0: 0x807, champ: 0x804 },
    FRLG: { party: 0x034, flags: 0x0EE0, badge0: 0x820, champ: 0x82C },
  };
  const FAMILY = { BPEE: 'E', AXVE: 'RS', AXPE: 'RS', BPRE: 'FRLG', BPGE: 'FRLG' };
  const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
    'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];

  function decodeText(u8, off, len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      const c = u8[off + i];
      if (c === 0xFF) break;
      if (c >= 0xBB && c <= 0xD4) s += String.fromCharCode(65 + c - 0xBB);
      else if (c >= 0xD5 && c <= 0xEE) s += String.fromCharCode(97 + c - 0xD5);
      else if (c >= 0xA1 && c <= 0xAA) s += String.fromCharCode(48 + c - 0xA1);
      else if (c === 0x00) s += ' ';
      else s += ({ 0xAB: '!', 0xAC: '?', 0xAD: '.', 0xAE: '-', 0xB0: '…', 0xB5: '♂', 0xB6: '♀', 0xB8: ',', 0xBA: '/' })[c] || '';
    }
    return s.trim();
  }

  // Returns {sections: {id: offset}} for the newer valid save copy.
  function pickSlot(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let best = null;
    for (const base of [0, 14 * SECTOR]) {
      if (base + 14 * SECTOR > u8.length) continue;
      const sections = {}; let index = -1, valid = 0;
      for (let s = 0; s < 14; s++) {
        const o = base + s * SECTOR;
        if (dv.getUint32(o + 0xFF8, true) !== SIG) continue;
        sections[dv.getUint16(o + 0xFF4, true)] = o;
        index = dv.getUint32(o + 0xFFC, true); valid++;
      }
      if (valid >= 5 && (best === null || index > best.index)) best = { sections, index };
    }
    return best;
  }

  function read(save, gameCode, species) {
    const u8 = save instanceof Uint8Array ? save : new Uint8Array(save);
    const L = LAYOUT[FAMILY[gameCode]];
    if (!L || u8.length < 0x10000) return null;
    const slot = pickSlot(u8);
    if (!slot || slot.sections[0] === undefined || slot.sections[1] === undefined) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const sb1 = (off) => { const sec = slot.sections[1 + Math.floor(off / DATA)]; return sec === undefined ? -1 : sec + (off % DATA); };

    const s0 = slot.sections[0];
    const trainer = decodeText(u8, s0, 7);
    const playMinutes = dv.getUint16(s0 + 0x0E, true) * 60 + u8[s0 + 0x10];

    const flag = (id) => { const o = sb1(L.flags + (id >> 3)); return o >= 0 && !!(u8[o] & (1 << (id & 7))); };
    let badges = 0;
    for (let i = 0; i < 8; i++) if (flag(L.badge0 + i)) badges++;
    const champion = flag(L.champ);

    // SaveBlock1 as one contiguous buffer (sections 1-4), so the party can be found wherever a romhack put it.
    const blk = new Uint8Array(DATA * 4);
    for (let k = 0; k < 4; k++) { const sec = slot.sections[1 + k]; if (sec !== undefined) blk.set(u8.subarray(sec, sec + DATA), k * DATA); }
    const bdv = new DataView(blk.buffer);
    // Decrypts one 100-byte party Pokémon; returns null unless its checksum and values are valid.
    function readMon(m) {
      if (m + 100 > blk.length) return null;
      const pid = bdv.getUint32(m, true), otid = bdv.getUint32(m + 4, true), key = (pid ^ otid) >>> 0;
      if (!pid && !otid) return null;
      let sum = 0; const words = [];
      for (let w = 0; w < 12; w++) { const v = (bdv.getUint32(m + 0x20 + w * 4, true) ^ key) >>> 0; words.push(v); sum = (sum + (v & 0xFFFF) + (v >>> 16)) & 0xFFFF; }
      if (sum !== bdv.getUint16(m + 0x1C, true)) return null;
      const g = ORDERS[pid % 24].indexOf('G');
      const sp = words[g * 3] & 0xFFFF, level = blk[m + 0x54];
      if (!sp || sp > 411 || level < 1 || level > 100) return null;
      const info = species && species[sp];
      return { species: sp, dex: info ? info[1] : 0, name: info ? info[0] : '#' + sp, nickname: decodeText(blk, m + 8, 10), level };
    }
    function partyAt(off) {
      const count = blk[off];
      if (count < 1 || count > 6 || blk[off + 1] || blk[off + 2] || blk[off + 3]) return null;
      const out = [];
      for (let i = 0; i < count; i++) { const mon = readMon(off + 4 + i * 100); if (!mon) return null; out.push(mon); }
      return out;
    }
    let party = partyAt(L.party);
    if (!party) {
      // Not at the usual spot: search SaveBlock1 for a checksum-valid party.
      for (let off = 0; off + 104 <= blk.length && !party; off += 4) party = partyAt(off);
    }
    return { trainer, playMinutes, badges, champion, party: party || [] };
  }

  // ---------- Live game memory (from an emulator save state) ----------
  // Addresses used by the IronMON Tracker. SaveBlock pointers live in IWRAM; RS keeps its blocks at fixed spots.
  const LIVE = {
    E:    { partyCount: 0x020244E9, party: 0x020244EC, sb1Ptr: 0x03005D8C, sb2Ptr: 0x03005D90 },
    FRLG: { partyCount: 0x02024029, party: 0x02024284, sb1Ptr: 0x03005008, sb2Ptr: 0x0300500C },
    RS:   { partyCount: 0x03004350, party: 0x03004360, sb1: 0x02025734, sb2: 0x02024EA4 },
  };
  // mGBA's serialized state: IWRAM at 0x19000 (32 KB), EWRAM at 0x21000 (256 KB). RetroArch may wrap it in "RASTATE" chunks.
  function stateMemory(state) {
    let u8 = state instanceof Uint8Array ? state : new Uint8Array(state);
    if (u8.length > 16 && String.fromCharCode(...u8.subarray(0, 7)) === 'RASTATE') {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      let o = 8;
      while (o + 8 <= u8.length) {
        const id = String.fromCharCode(...u8.subarray(o, o + 4)), size = dv.getUint32(o + 4, true);
        if (id === 'MEM ') { u8 = u8.subarray(o + 8, o + 8 + size); break; }
        o += 8 + size + ((8 - (size % 8)) % 8);
      }
    }
    if (u8.length < 0x61000) return null;
    return { iwram: u8.subarray(0x19000, 0x21000), ewram: u8.subarray(0x21000, 0x61000) };
  }
  function readLive(state, gameCode, species, fallbackSave) {
    const fam = FAMILY[gameCode], A = LIVE[fam], L = LAYOUT[fam];
    if (!A) return null;
    const mem = stateMemory(state); if (!mem) return null;
    const view = (addr, len) => {
      const reg = addr >= 0x03000000 ? mem.iwram : mem.ewram, off = addr & (addr >= 0x03000000 ? 0x7FFF : 0x3FFFF);
      return off + len <= reg.length ? reg.subarray(off, off + len) : null;
    };
    const u32 = (addr) => { const b = view(addr, 4); return b ? (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0 : 0; };
    const ew = mem.ewram, edv = new DataView(ew.buffer, ew.byteOffset, ew.byteLength);
    function monAt(buf, dv, m) {
      if (m + 100 > buf.length) return null;
      const pid = dv.getUint32(m, true), otid = dv.getUint32(m + 4, true), key = (pid ^ otid) >>> 0;
      if (!pid && !otid) return null;
      let sum = 0; const words = [];
      for (let w = 0; w < 12; w++) { const v = (dv.getUint32(m + 0x20 + w * 4, true) ^ key) >>> 0; words.push(v); sum = (sum + (v & 0xFFFF) + (v >>> 16)) & 0xFFFF; }
      if (sum !== dv.getUint16(m + 0x1C, true)) return null;
      const sp = words[ORDERS[pid % 24].indexOf('G') * 3] & 0xFFFF, level = buf[m + 0x54];
      if (!sp || sp > 411 || level < 1 || level > 100) return null;
      const info = species && species[sp];
      return { species: sp, dex: info ? info[1] : 0, name: info ? info[0] : '#' + sp, nickname: decodeText(buf, m + 8, 10), level };
    }
    // Party at the known address; otherwise the first run of checksum-valid 100-byte Pokémon in EWRAM.
    let party = [];
    const countB = view(A.partyCount, 1), pb = view(A.party, 600);
    if (countB && pb && countB[0] >= 1 && countB[0] <= 6) {
      const pdv = new DataView(pb.buffer, pb.byteOffset, pb.byteLength);
      for (let i = 0; i < countB[0]; i++) { const m = monAt(pb, pdv, i * 100); if (!m) { party = []; break; } party.push(m); }
    }
    // A count of 0 means no Pokémon yet: don't search memory, which can hold unrelated Pokémon (e.g. from the intro).
    // Search only when the count is impossible, i.e. the address doesn't fit this ROM.
    if (!party.length && (!countB || countB[0] > 6)) {
      for (let off = 0; off + 100 <= ew.length && !party.length; off += 4) {
        const first = monAt(ew, edv, off); if (!first) continue;
        const run = [first];
        for (let i = 1; i < 6; i++) { const m = monAt(ew, edv, off + i * 100); if (!m) break; run.push(m); }
        party = run;
      }
    }
    // Badges and Champion from the live flags in SaveBlock1.
    const sb1 = A.sb1 || u32(A.sb1Ptr), sb2 = A.sb2 || u32(A.sb2Ptr);
    let badges = 0, champion = false, flagsOk = false;
    if (sb1 >= 0x02000000 && sb1 < 0x02040000) {
      const flags = view(sb1 + L.flags, 0x140);
      if (flags) {
        flagsOk = true;
        const flag = (id) => !!(flags[id >> 3] & (1 << (id & 7)));
        for (let i = 0; i < 8; i++) if (flag(L.badge0 + i)) badges++;
        champion = flag(L.champ);
      }
    }
    let trainer = '';
    if (sb2 >= 0x02000000 && sb2 < 0x02040000) { const n = view(sb2, 8); if (n) trainer = decodeText(n, 0, 7); }
    let playMinutes = 0;
    if (sb2 >= 0x02000000 && sb2 < 0x02040000) { const t = view(sb2 + 0x0E, 3); if (t) playMinutes = (t[0] | (t[1] << 8)) * 60 + t[2]; }
    if (!flagsOk && fallbackSave) { const f = read(fallbackSave, gameCode, species); if (f) { badges = f.badges; champion = f.champion; trainer = trainer || f.trainer; } }
    if (!party.length && !flagsOk) return null;
    return { trainer, playMinutes, badges, champion, party, live: true };
  }

  // Ranking score: Champion counts as a 9th badge; highest party level breaks ties.
  function score(p) { if (!p) return 0; const top = Math.max(0, ...p.party.map((x) => x.level)); return (p.champion ? 9 : p.badges) * 1000 + top; }
  return { read, readLive, score, decodeText, stateMemory };
})();
if (typeof module !== 'undefined') module.exports = KPGen3;
