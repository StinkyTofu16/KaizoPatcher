// Display names for FireRed MaxDex. The game stores names in at most 10 letters ("RoarinMoon"), marks regional
// forms and Megas with a letter ("WeezingG", "VenusaurM"), and writes newer ability names in capitals.
// KPMaxNames.species(rawNames) -> display names (same indexes); KPMaxNames.title("GRASSY SURGE") -> "Grassy Surge"
const KPMaxNames = (() => {
  const FULL = {
    Flechinder: 'Fletchinder', Crabminble: 'Crabominable', Blacphalon: 'Blacephalon', Corvsquire: 'Corvisquire', Corvknight: 'Corviknight',
    Centskorch: 'Centiskorch', Poltegeist: 'Polteageist', Stonjorner: 'Stonjourner', Basclegion: 'Basculegion', Meowscrada: 'Meowscarada',
    Squawkbily: 'Squawkabilly', Kilowattrl: 'Kilowattrel', Bramblgast: 'Brambleghast', Dudunsprce: 'Dudunsparce', ScreamTail: 'Scream Tail',
    BruteBonet: 'Brute Bonnet', FluttrMane: 'Flutter Mane', SlithrWing: 'Slither Wing', SandyShock: 'Sandy Shocks', IronTreads: 'Iron Treads',
    IronBundle: 'Iron Bundle', IronJuglis: 'Iron Jugulis', IronThorns: 'Iron Thorns', RoarinMoon: 'Roaring Moon', IronValian: 'Iron Valiant',
    WalkinWake: 'Walking Wake', IronLeaves: 'Iron Leaves', Polchgeist: 'Poltchageist', GouginFire: 'Gouging Fire', RagingBolt: 'Raging Bolt',
    IronBouldr: 'Iron Boulder', 'Type? Null': 'Type: Null', 'Type Null': 'Type: Null', 'Nidoran?': 'Nidoran', DarmanitZG: 'Galarian Darmanitan (Zen)',
  };
  const REGION = { A: 'Alolan', G: 'Galarian', H: 'Hisuian', P: 'Paldean' };
  const title = (s) => (/[a-z]/.test(s) ? s : s.toLowerCase().replace(/(^|[\s\-.])([a-z])/g, (m, a, b) => a + b.toUpperCase()));
  function species(raw) {
    const out = raw.map((n) => FULL[n] || n);
    let last = raw.indexOf('Pecharunt'); if (last < 0) last = raw.length - 1;
    const bases = out.slice(1, last + 1);
    // a form's base: the species whose (full) name starts with the form name minus its letter(s)
    const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
    const baseOf = (stem) => { const t = norm(stem); if (t.length < 3) return null; return bases.find((b) => norm(b) === t) || (t.length >= 5 ? bases.find((b) => norm(b).startsWith(t)) : null); };
    // MaxDex's order after Pecharunt: Megas and Primals, regional forms (up to Partner Eevee), other forms, then the
    // newer Megas (from Mega Dragonite). Letters only mean region/Mega in those blocks.
    const formEnd = raw.indexOf('EeveeP'), mega2 = raw.indexOf('DragoniteM');
    for (let i = last + 1; i < raw.length; i++) {
      const n = raw[i]; if (!n || FULL[n]) continue;
      const inForms = formEnd < 0 || i <= formEnd, inMega2 = mega2 >= 0 && i >= mega2;
      if (!inForms && !inMega2) continue;
      const one = baseOf(n.slice(0, -1)), suf = n.slice(-1);
      if (inMega2) { if (one) out[i] = 'Mega ' + one + (suf === 'M' ? '' : ' ' + suf); continue; }
      if (one && suf === 'P' && /^(Pikachu|Eevee)$/.test(one)) out[i] = 'Partner ' + one;
      else if (one && REGION[suf] && !/^(Kyogre|Groudon)$/.test(one)) out[i] = REGION[suf] + ' ' + one;
      else if (one && suf === 'P') out[i] = 'Primal ' + one;
      else if (one && suf === 'M') out[i] = 'Mega ' + one;
      else if (one && (suf === 'X' || suf === 'Y')) out[i] = 'Mega ' + one + ' ' + suf;
    }
    return out;
  }
  return { species, title };
})();
if (typeof module !== 'undefined') module.exports = KPMaxNames;
