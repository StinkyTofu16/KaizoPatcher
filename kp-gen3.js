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

  // Ranking score: Champion counts as a 9th badge; highest party level breaks ties.
  function score(p) { if (!p) return 0; const top = Math.max(0, ...p.party.map((x) => x.level)); return (p.champion ? 9 : p.badges) * 1000 + top; }
  return { read, score, decodeText };
})();
if (typeof module !== 'undefined') module.exports = KPGen3;
