import { getSettings, setSettings, Api } from './api.js';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const emailEl = $('email') as HTMLInputElement;
const passwordEl = $('password') as HTMLInputElement;
const apiBaseEl = $('apiBase') as HTMLInputElement;
const targetLangEl = $('targetLang') as HTMLSelectElement;
const msgEl = $('msg');

function showMsg(text: string, kind: 'ok' | 'err' | '' = '') {
  msgEl.textContent = text;
  msgEl.className = `msg ${kind}`;
}

async function refresh() {
  const s = await getSettings();
  apiBaseEl.value = s.apiBase;
  targetLangEl.value = s.targetLang;
  if (s.token) {
    $('loggedOut').classList.add('hidden');
    $('loggedIn').classList.remove('hidden');
    $('whoami').textContent = s.email || '';
  } else {
    $('loggedOut').classList.remove('hidden');
    $('loggedIn').classList.add('hidden');
  }
}

async function persistApiBase() {
  const val = apiBaseEl.value.trim().replace(/\/$/, '');
  if (val) await setSettings({ apiBase: val });
}

async function doAuth(mode: 'login' | 'register') {
  await persistApiBase();
  const email = emailEl.value.trim();
  const password = passwordEl.value;
  if (!email || !password) return showMsg('Enter email and password', 'err');
  showMsg('Please wait...');
  try {
    const res = mode === 'login' ? await Api.login(email, password) : await Api.register(email, password);
    await setSettings({ token: res.token, email: res.user.email });
    showMsg(mode === 'login' ? 'Logged in!' : 'Account created!', 'ok');
    await refresh();
  } catch (err) {
    showMsg((err as Error).message, 'err');
  }
}

$('loginBtn').onclick = () => doAuth('login');
$('registerBtn').onclick = () => doAuth('register');
$('logoutBtn').onclick = async () => {
  await setSettings({ token: null, email: null });
  showMsg('Logged out', 'ok');
  await refresh();
};
targetLangEl.onchange = () => setSettings({ targetLang: targetLangEl.value });
apiBaseEl.onchange = persistApiBase;

void refresh();
