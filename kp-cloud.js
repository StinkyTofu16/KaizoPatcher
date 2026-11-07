// Accounts, run stats, save backup and leaderboard on Firebase (Auth + Firestore).
// Needs kp-config.js to define window.KP_FIREBASE = {apiKey, authDomain, projectId, ...}.
// Everything is optional: if Firebase isn't configured or can't load, the site works signed-out as before.
const KPCloud = (() => {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  let ready = null, auth = null, db = null, FB = null;
  const listeners = new Set();
  let current = null; // {uid, email, username}

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Couldn’t reach the account service.')); document.head.append(s); });
  }
  function init() {
    if (ready) return ready;
    if (!window.KP_FIREBASE || !window.KP_FIREBASE.apiKey) { ready = Promise.resolve(false); return ready; }
    ready = (async () => {
      await loadScript(SDK + 'firebase-app-compat.js');
      await Promise.all([loadScript(SDK + 'firebase-auth-compat.js'), loadScript(SDK + 'firebase-firestore-compat.js')]);
      FB = window.firebase;
      FB.initializeApp(window.KP_FIREBASE);
      auth = FB.auth(); db = FB.firestore();
      await auth.setPersistence(FB.auth.Auth.Persistence.LOCAL);
      await new Promise((res) => {
        let first = true;
        auth.onAuthStateChanged(async (u) => {
          if (u) {
            let username = '';
            try { const d = await db.doc('users/' + u.uid).get(); username = (d.exists && d.data().username) || ''; } catch (e) {}
            current = { uid: u.uid, email: u.email, username };
          } else current = null;
          listeners.forEach((fn) => { try { fn(current); } catch (e) {} });
          if (first) { first = false; res(); }
        });
      });
      return true;
    })().catch((e) => { console.warn('Accounts unavailable:', e); return false; });
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
    })[c] || (e && e.message) || 'Something went wrong.';
  };

  async function signUp(email, password, username) {
    await init();
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Usernames are 3–16 letters, numbers or underscores.');
    const key = name.toLowerCase();
    const taken = await db.doc('usernames/' + key).get();
    if (taken.exists) throw new Error('That username is taken. Try another.');
    let cred;
    try { cred = await auth.createUserWithEmailAndPassword(email, password); } catch (e) { throw new Error(friendly(e)); }
    const uid = cred.user.uid;
    try {
      await db.doc('usernames/' + key).set({ uid });
      await db.doc('users/' + uid).set({ username: name, createdAt: FB.firestore.FieldValue.serverTimestamp(), runsTotal: 0 });
    } catch (e) {
      try { await cred.user.delete(); } catch (x) {}
      throw new Error('That username was just taken. Try another.');
    }
    current = { uid, email, username: name };
    listeners.forEach((fn) => fn(current));
    return current;
  }
  async function signIn(email, password) { await init(); try { await auth.signInWithEmailAndPassword(email, password); } catch (e) { throw new Error(friendly(e)); } }
  async function signOut() { await init(); await auth.signOut(); }
  async function resetPassword(email) { await init(); try { await auth.sendPasswordResetEmail(email); } catch (e) { throw new Error(friendly(e)); } }

  // ---- Runs and stats ----
  const runRef = (runKey) => db.doc('users/' + current.uid + '/runs/' + runKey);
  async function startRun(info) { // {runKey, game, label, preset, runNo}
    if (!(await init()) || !current) return;
    const ts = FB.firestore.FieldValue.serverTimestamp();
    await runRef(info.runKey).set({ ...info, startedAt: ts, updatedAt: ts, badges: 0, champion: false, party: [], score: 0, playMinutes: 0 }, { merge: true });
    await db.doc('users/' + current.uid).set({ runsTotal: FB.firestore.FieldValue.increment(1), lastRunAt: ts }, { merge: true });
  }
  let lastSig = '';
  async function recordProgress(info, progress) { // info: {runKey, game, label, preset, runNo}; progress from KPGen3.read
    if (!(await init()) || !current || !progress) return;
    const party = progress.party.map((p) => ({ name: p.name, dex: p.dex, level: p.level }));
    const score = KPGen3.score(progress);
    const sig = info.runKey + '|' + score + '|' + JSON.stringify(party) + '|' + progress.playMinutes;
    if (sig === lastSig) return;
    lastSig = sig;
    const ts = FB.firestore.FieldValue.serverTimestamp();
    await runRef(info.runKey).set({ ...info, badges: progress.badges, champion: progress.champion, party, score, playMinutes: progress.playMinutes, trainer: progress.trainer, updatedAt: ts }, { merge: true });
    const lbRef = db.doc('leaderboard/' + current.uid);
    const lb = await lbRef.get(), d = lb.exists ? lb.data() : null;
    if (!d || score > (d.score || 0) || (d.runKey === info.runKey && score >= (d.score || 0))) {
      await lbRef.set({ username: current.username || 'Player', score, badges: progress.badges, champion: progress.champion, party, game: info.label, preset: info.preset, runNo: info.runNo, runKey: info.runKey, updatedAt: ts });
    }
  }
  async function endRun(runKey) { if (!(await init()) || !current) return; await runRef(runKey).set({ endedAt: FB.firestore.FieldValue.serverTimestamp() }, { merge: true }); }
  async function stats() {
    if (!(await init()) || !current) return null;
    const u = await db.doc('users/' + current.uid).get();
    const runs = await db.collection('users/' + current.uid + '/runs').orderBy('startedAt', 'desc').limit(50).get();
    return { user: u.exists ? u.data() : {}, runs: runs.docs.map((d) => ({ id: d.id, ...d.data() })) };
  }
  async function leaderboard(limit = 50) {
    if (!(await init())) return null;
    const q = await db.collection('leaderboard').orderBy('score', 'desc').limit(limit).get();
    return q.docs.map((d) => ({ uid: d.id, ...d.data() }));
  }

  // ---- Save backup (private to the player) ----
  const savesRef = () => db.doc('users/' + current.uid + '/private/saves');
  async function backupSaves({ startSave, current: cur }) { // cur: {runKey, data: Uint8Array}
    if (!(await init()) || !current) return;
    const out = { updatedAt: FB.firestore.FieldValue.serverTimestamp() };
    if (startSave) out.startSave = FB.firestore.Blob.fromUint8Array(new Uint8Array(startSave));
    if (cur && cur.data) out.current = { runKey: cur.runKey, data: FB.firestore.Blob.fromUint8Array(cur.data) };
    await savesRef().set(out, { merge: true });
  }
  async function fetchSaves() {
    if (!(await init()) || !current) return null;
    const d = await savesRef().get(); if (!d.exists) return null;
    const v = d.data();
    return { startSave: v.startSave ? v.startSave.toUint8Array() : null, current: v.current ? { runKey: v.current.runKey, data: v.current.data.toUint8Array() } : null };
  }

  return { init, onChange, user, signUp, signIn, signOut, resetPassword, startRun, recordProgress, endRun, stats, leaderboard, backupSaves, fetchSaves };
})();
