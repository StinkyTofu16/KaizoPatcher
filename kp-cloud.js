// Accounts, run stats, save backup and leaderboard on Firebase (Auth + Firestore), modular SDK.
// Sign-in is kept in localStorage (not IndexedDB, which can hang on iPhone Safari), and nothing here can block
// the page: every wait has a time limit. Needs kp-config.js to define window.KP_FIREBASE.
const KPCloud = (() => {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  let ready = null, A = null, F = null, auth = null, db = null;
  const listeners = new Set();
  let current = null; // {uid, email, username}
  const status = { state: 'idle', at: 0, error: '' }; // last leaderboard/stat sync
  const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms))]);

  async function loadUsername(uid) {
    try { const d = await withTimeout(F.getDoc(F.doc(db, 'users', uid)), 8000, 'Profile'); return (d.exists() && d.data().username) || ''; } catch (e) { return ''; }
  }
  function remembered() { try { return localStorage.getItem('kp:remember') !== '0'; } catch (e) { return true; } }
  async function applyRemember(remember) {
    try { localStorage.setItem('kp:remember', remember === false ? '0' : '1'); } catch (e) {}
    try { await A.setPersistence(auth, remember === false ? A.browserSessionPersistence : A.browserLocalPersistence); } catch (e) { console.warn(e); }
  }
  function init() {
    if (ready) return ready;
    if (!window.KP_FIREBASE || !window.KP_FIREBASE.apiKey) { ready = Promise.resolve(false); return ready; }
    ready = (async () => {
      const [appM, authM, fsM] = await withTimeout(Promise.all([
        import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]), 20000, 'Loading accounts');
      A = authM; F = fsM;
      const app = appM.initializeApp(window.KP_FIREBASE);
      // "Remember me" (the default) keeps the sign-in in localStorage, so it lasts until the player signs out.
      // Without it, the sign-in lives in sessionStorage and ends when the app or tab is closed.
      const local = A.browserLocalPersistence, session = A.browserSessionPersistence;
      auth = A.initializeAuth(app, { persistence: remembered() ? [local, session] : [session, local] });
      db = F.getFirestore(app);
      await withTimeout(new Promise((res) => {
        let first = true;
        A.onAuthStateChanged(auth, async (u) => {
          current = u ? { uid: u.uid, email: u.email, username: await loadUsername(u.uid) } : null;
          listeners.forEach((fn) => { try { fn(current); } catch (e) {} });
          if (first) { first = false; res(); }
        });
      }), 10000, 'Checking sign-in').catch(() => {});
      return true;
    })().catch((e) => { console.warn('Accounts unavailable:', e); status.state = 'error'; status.error = e.message; return false; });
    return ready;
  }
  const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const user = () => current;

  const friendly = (e) => {
    const c = (e && e.code) || '';
    return ({
      'auth/email-already-in-use': 'There’s already an account with that email. Sign in instead.',
      'auth/invalid-email': 'That email address doesn’t look right.',
      'auth/weak-password': 'Use a password with at least 6 characters.',
      'auth/invalid-credential': 'Wrong email or password.',
      'auth/wrong-password': 'Wrong email or password.',
      'auth/user-not-found': 'No account with that email. Create one instead.',
      'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
      'auth/network-request-failed': 'No connection. Check your internet and try again.',
      'permission-denied': 'The account service refused this. Check that the Firestore rules are published.',
    })[c] || (e && e.message) || 'Something went wrong.';
  };

  async function signUp(email, password, username, remember = true) {
    if (!(await init())) throw new Error('The account service didn’t load. Check your connection.');
    await applyRemember(remember);
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Usernames are 3–16 letters, numbers or underscores.');
    const key = name.toLowerCase();
    let taken;
    try { taken = await F.getDoc(F.doc(db, 'usernames', key)); } catch (e) { throw new Error(friendly(e)); }
    if (taken.exists()) throw new Error('That username is taken. Try another.');
    let cred;
    try { cred = await A.createUserWithEmailAndPassword(auth, email, password); } catch (e) { throw new Error(friendly(e)); }
    const uid = cred.user.uid;
    try {
      await F.setDoc(F.doc(db, 'usernames', key), { uid });
      await F.setDoc(F.doc(db, 'users', uid), { username: name, createdAt: F.serverTimestamp(), runsTotal: 0 });
    } catch (e) {
      try { await A.deleteUser(cred.user); } catch (x) {}
      throw new Error(e && e.code === 'permission-denied' ? friendly(e) : 'That username was just taken. Try another.');
    }
    current = { uid, email, username: name };
    listeners.forEach((fn) => fn(current));
    return current;
  }
  async function signIn(email, password, remember = true) {
    if (!(await init())) throw new Error('The account service didn’t load. Check your connection.');
    await applyRemember(remember);
    try { await A.signInWithEmailAndPassword(auth, email, password); } catch (e) { throw new Error(friendly(e)); }
  }
  async function signOut() { if (await init()) await A.signOut(auth); }
  async function resetPassword(email) { if (!(await init())) throw new Error('The account service didn’t load.'); try { await A.sendPasswordResetEmail(auth, email); } catch (e) { throw new Error(friendly(e)); } }

  // ---- Runs and stats ----
  const runRef = (runKey) => F.doc(db, 'users', current.uid, 'runs', runKey);
  async function startRun(info) { // {runKey, game, label, preset, runNo}
    if (!(await init()) || !current) return;
    const ts = F.serverTimestamp();
    await F.setDoc(runRef(info.runKey), { ...info, startedAt: ts, updatedAt: ts }, { merge: true });
    await F.setDoc(F.doc(db, 'users', current.uid), { runsTotal: F.increment(1), lastRunAt: ts }, { merge: true });
  }
  let lastSig = '';
  async function recordProgress(info, progress) { // progress from KPGen3.read
    if (!(await init())) return;
    if (!current) { status.state = 'signedout'; return; }
    if (!progress) return;
    const party = progress.party.map((p) => ({ name: p.name, dex: p.dex, level: p.level }));
    const score = Math.round(KPGen3.score(progress));
    const sig = info.runKey + '|' + score + '|' + JSON.stringify(party) + '|' + progress.playMinutes;
    if (sig === lastSig) return;
    try {
      const ts = F.serverTimestamp();
      await F.setDoc(runRef(info.runKey), { ...info, badges: progress.badges, champion: progress.champion, party, score, playMinutes: progress.playMinutes, trainer: progress.trainer, updatedAt: ts }, { merge: true });
      const lbRef = F.doc(db, 'leaderboard', current.uid);
      const lb = await F.getDoc(lbRef), d = lb.exists() ? lb.data() : null;
      if (!d || score > (d.score || 0) || (d.runKey === info.runKey && score >= (d.score || 0))) {
        await F.setDoc(lbRef, { username: (current.username || 'Player').slice(0, 16), score, badges: progress.badges, champion: progress.champion, party,
          game: String(info.label || '').slice(0, 60), preset: String(info.preset || '').slice(0, 40), runNo: info.runNo, runKey: info.runKey, updatedAt: ts });
      }
      lastSig = sig;
      status.state = 'ok'; status.at = Date.now(); status.error = '';
    } catch (e) {
      status.state = 'error'; status.error = friendly(e);
      throw e;
    }
  }
  async function endRun(runKey) { if (!(await init()) || !current) return; await F.setDoc(runRef(runKey), { endedAt: F.serverTimestamp() }, { merge: true }); }
  async function stats() {
    if (!(await init()) || !current) return null;
    const u = await F.getDoc(F.doc(db, 'users', current.uid));
    const runs = await F.getDocs(F.query(F.collection(db, 'users', current.uid, 'runs'), F.orderBy('updatedAt', 'desc'), F.limit(50)));
    return { user: u.exists() ? u.data() : {}, runs: runs.docs.map((d) => ({ id: d.id, ...d.data() })) };
  }
  async function leaderboard(n = 50) {
    if (!(await init())) return null;
    const q = await F.getDocs(F.query(F.collection(db, 'leaderboard'), F.orderBy('score', 'desc'), F.limit(n)));
    return q.docs.map((d) => ({ uid: d.id, ...d.data() }));
  }

  // ---- Save backup (private to the player) ----
  const savesRef = () => F.doc(db, 'users', current.uid, 'private', 'saves');
  async function backupSaves({ startSave, current: cur }) {
    if (!(await init()) || !current) return;
    const out = { updatedAt: F.serverTimestamp() };
    if (startSave) out.startSave = F.Bytes.fromUint8Array(new Uint8Array(startSave));
    if (cur && cur.data) out.current = { runKey: cur.runKey, data: F.Bytes.fromUint8Array(cur.data) };
    await F.setDoc(savesRef(), out, { merge: true });
  }
  async function fetchSaves() {
    if (!(await init()) || !current) return null;
    const d = await F.getDoc(savesRef()); if (!d.exists()) return null;
    const v = d.data();
    return { startSave: v.startSave ? v.startSave.toUint8Array() : null, current: v.current ? { runKey: v.current.runKey, data: v.current.data.toUint8Array() } : null };
  }

  return { init, onChange, user, status, remembered, signUp, signIn, signOut, resetPassword, startRun, recordProgress, endRun, stats, leaderboard, backupSaves, fetchSaves };
})();
