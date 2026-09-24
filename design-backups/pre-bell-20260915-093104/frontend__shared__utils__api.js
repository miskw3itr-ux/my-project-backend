// مساعد fetch مركزي للواجهات — يحفظ التوكن ويضيف Bearer تلقائياً
// مع تبديل تلقائي بين localhost و 127.0.0.1 عند تعذر أحدهما
const API_HOSTS = ['http://localhost:3001', 'http://127.0.0.1:3001'];
let API_BASE = localStorage.getItem('daralef_api') || API_HOSTS[0];
function authHeaders() {
  const t = localStorage.getItem('daralef_token');
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) };
}
async function rawFetch(path, opts) {
  const stamp = (ok, err) => { try { (globalThis.__diag = globalThis.__diag || []).push({ url: API_BASE + path, ok: !!ok, err: err ? String(err).slice(0, 120) : null }); } catch {} };
  try {
    const r = await fetch(API_BASE + path, opts);
    stamp(true);
    return r;
  } catch (e) {
    stamp(false, (e && e.message) || e);
    const alt = API_HOSTS.find(h => h !== API_BASE);
    if (alt) {
      try {
        const r = await fetch(alt + path, opts);
        API_BASE = alt;
        try { localStorage.setItem('daralef_api', alt); } catch {}
        stamp(true);
        return r;
      } catch (e2) { stamp(false, (e2 && e2.message) || e2); }
    }
    throw e;
  }
}
function diagReport() {
  const rows = (globalThis.__diag || []).map(d => (d.ok ? 'OK ' : 'FAIL ') + d.url + (d.err ? ' :: ' + d.err : ''));
  return 'proto=' + (location.protocol || '?') + ' host=' + API_BASE + ' online=' + navigator.onLine + '\n' + rows.slice(-12).join('\n');
}
async function api(path, opts = {}) {
  let r;
  try {
    r = await rawFetch('/api' + path, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });
  } catch {
    throw new Error('تعذر الاتصال بالخادم — شغّل الـ Backend أولاً (node server.js داخل مجلد backend) ثم أعد المحاولة');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.endsWith('/login')) {
    localStorage.removeItem('daralef_token');
    throw new Error('انتهت الجلسة — حدّث الصفحة وسيُعاد الدخول تلقائياً');
  }
  if (!r.ok) throw new Error(data.error || ('خطأ ' + r.status));
  return data;
}
async function apiHealth() {
  try {
    const r = await rawFetch('/api/health', {});
    return r.ok;
  } catch { return false; }
}
async function apiLogin(username, password) {
  const r = await api('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  localStorage.setItem('daralef_token', r.token);
  try {
    localStorage.setItem('daralef_role', (r.user && r.user.role) || '');
    localStorage.setItem('daralef_user', (r.user && r.user.username) || '');
    localStorage.setItem('daralef_me', JSON.stringify(r.user || {}));
  } catch {}
  return r.user;
}
