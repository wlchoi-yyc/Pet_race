// Shared Teaching games allowlist; access requires a fresh server response.
const gate = document.getElementById('authGate');
const experience = document.getElementById('experience');
const message = document.getElementById('authMessage');
const login = document.getElementById('googleLoginButton');
const logout = document.getElementById('authLogout');
const switchAccount = document.getElementById('switchAccount');
let version = 0, unsubscribe = null, loaded = false;
window.__petRaceAuthorized = false;

function lock(text) {
  window.__petRaceAuthorized = false;
  experience.hidden = true;
  gate.hidden = false;
  message.textContent = text;
  window.dispatchEvent(new Event('pet-auth-lock'));
}
function errorText(error) {
  switch (error?.code) {
    case 'auth/popup-closed-by-user': return '登入已取消，請再試一次。';
    case 'auth/popup-blocked': return '請允許此網站開啟 Google 登入視窗後再試。';
    case 'auth/unauthorized-domain': return '此網址尚未完成登入設定，請稍後再試。';
    default: return '未能確認使用權限，請重新登入或重新整理網頁。';
  }
}

async function boot() {
  // The old public entry must never start the game.
  if (location.hostname === 'wlchoi-yyc.github.io') {
    location.replace('https://pet-race-wlchoi.web.app/');
    return;
  }
  if (!window.firebase) throw new Error('Firebase SDK unavailable');
  const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Configuration unavailable');
  const config = await response.json();
  if (config.projectId !== 'mulan-journey') throw new Error('Unexpected Firebase project');
  firebase.initializeApp(config);
  const auth = firebase.auth(), db = firebase.firestore();
  auth.useDeviceLanguage();
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  login.addEventListener('click', async () => {
    login.disabled = true;
    message.textContent = '正在登入……';
    try { await auth.signInWithPopup(provider); }
    catch (error) { lock(errorText(error)); }
    finally { login.disabled = false; }
  });
  async function signOut() {
    ++version;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    lock('正在登出……');
    try { await auth.signOut(); }
    catch { lock('登出未完成，請再試一次。'); }
  }
  logout.addEventListener('click', signOut);
  switchAccount.addEventListener('click', signOut);

  auth.onAuthStateChanged(async user => {
    const check = ++version;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    lock(user ? '正在檢查使用權限……' : '請使用獲授權的 Google 帳號登入');
    login.disabled = false;
    switchAccount.hidden = !user;
    if (!user) return;
    const uid = user.uid, email = (user.email || '').trim().toLowerCase();
    const current = () => check === version && auth.currentUser?.uid === uid;
    try {
      if (!email || !user.emailVerified) throw new Error('Verified email required');
      const ref = db.collection('authorizedUsers').doc(email);
      const permission = await ref.get({ source: 'server' });
      if (!current()) return;
      if (!permission.exists) {
        lock('此 Google 帳號未獲授權，請改用教學遊戲授權名單內的帳號。');
        return;
      }
      // A new login starts a clean game after an earlier session was locked.
      if (loaded) { location.reload(); return; }
      window.__petRaceAuthorized = true;
      loaded = true;
      await import('./game.js');
      if (!current() || !window.__petRaceAuthorized) return;
      experience.hidden = false;
      gate.hidden = true;
      window.dispatchEvent(new Event('resize'));
      unsubscribe = ref.onSnapshot({ includeMetadataChanges: true }, snapshot => {
        if (!current() || snapshot.metadata.fromCache) return;
        if (!snapshot.exists) {
          ++version;
          lock('此帳號的使用權限已取消。');
        }
      }, () => { if (current()) { ++version; lock('未能確認使用權限，請重新登入。'); } });
    } catch (error) {
      if (current()) lock(errorText(error));
    }
  });
}
boot().catch(() => { lock('登入服務未能載入，請重新整理網頁。'); login.disabled = true; });
