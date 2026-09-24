// تبديل المستخدم الموحد — زر في رأس كل صفحة لكل الأقسام
// يُحمّل ويُحقن تلقائياً عبر layout.js — لا حاجة لأي تعديل في صفحات الأقسام
// أمان: التبديل يتطلب كلمة مرور الحساب الهدف دائماً (يُطبق قفل المحاولات من الخادم)،
// وقائمة المستخدمين تظهر فقط لمن يملك صلاحية عرض المستخدمين، وإلا يُكتب الاسم يدوياً
(function () {
  function basePrefix() {
    // يعمل مع: /index.html و /قسم/index.html و /قسم/ و /
    try {
      var p = location.pathname.replace(/\\/g, '/');
      var segs = p.split('/').filter(Boolean);
      if (segs.length && /\.[a-z0-9]+$/i.test(segs[segs.length - 1])) segs.pop();
      if (!segs.length) return './';
      return new Array(segs.length + 1).join('../');
    } catch (e) { return '../'; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function hasToken() {
    try { return !!localStorage.getItem('daralef_token'); } catch (e) { return false; }
  }

  function isLoginPage() {
    try { return /login\.html$/.test(location.pathname); } catch (e) { return false; }
  }

  function curUser() {
    try { return localStorage.getItem('daralef_user') || ''; } catch (e) { return ''; }
  }

  function uswMsg(t, ok) {
    var m = document.getElementById('uswMsg');
    if (m) m.innerHTML = t ? '<div class="alert alert-' + (ok ? 'success' : 'danger') + '">' + esc(t) + '</div>' : '';
  }

  function openModal() {
    var o = document.getElementById('uswOverlay');
    if (!o) return;
    var c = document.getElementById('uswCur');
    if (c) c.textContent = curUser() || '—';
    uswMsg('', 1);
    var p = document.getElementById('uswPass');
    if (p) p.value = '';
    o.hidden = false;
    loadUserList();
    setTimeout(function () {
      var u = document.getElementById('uswUser');
      var ut = document.getElementById('uswUserText');
      if (u && !u.hidden) { if (p) p.focus(); }
      else if (ut) ut.focus();
    }, 50);
  }

  function closeModal() {
    var o = document.getElementById('uswOverlay');
    if (o) o.hidden = true;
  }

  async function loadUserList() {
    var sel = document.getElementById('uswUser');
    var txt = document.getElementById('uswUserText');
    if (!sel || !txt) return;
    sel.innerHTML = '<option value="">جارٍ التحميل…</option>';
    try {
      if (typeof api !== 'function') throw new Error('no api');
      var d = (await api('/users')).data || [];
      var act = d.filter(function (u) { return u.active !== false; });
      if (!act.length) throw new Error('empty');
      var me = curUser();
      sel.innerHTML = act.map(function (u) {
        return '<option value="' + esc(u.username) + '"' + (u.username === me ? ' selected' : '') + '>'
          + esc(u.username) + ' — ' + esc(u.role_label || u.role || '') + '</option>';
      }).join('');
      sel.hidden = false;
      txt.hidden = true;
    } catch (e) {
      // بلا صلاحية عرض المستخدمين: إدخال يدوي لاسم الحساب
      sel.hidden = true;
      txt.hidden = false;
      if (!txt.value) txt.value = curUser();
    }
  }

  async function doSwitch() {
    var sel = document.getElementById('uswUser');
    var txt = document.getElementById('uswUserText');
    var p = document.getElementById('uswPass');
    var go = document.getElementById('uswGo');
    var username = (sel && !sel.hidden ? sel.value : (txt ? txt.value : ''));
    username = String(username || '').trim();
    var password = p ? p.value : '';
    if (!username) { uswMsg('اختر المستخدم أو اكتب اسم الدخول', 0); return; }
    if (!password) { uswMsg('كلمة المرور مطلوبة للتبديل', 0); if (p) p.focus(); return; }
    if (go) go.disabled = true;
    uswMsg('', 1);
    try {
      var u;
      if (typeof apiLogin === 'function') {
        u = await apiLogin(username, password);
      } else {
        var r = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username, password: password })
        });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error((j && j.error) || ('خطأ ' + r.status));
        try {
          localStorage.setItem('daralef_token', j.token);
          localStorage.setItem('daralef_role', (j.user && j.user.role) || '');
          localStorage.setItem('daralef_user', (j.user && j.user.username) || '');
          localStorage.setItem('daralef_me', JSON.stringify(j.user || {}));
        } catch (e2) {}
        u = j.user;
      }
      try { localStorage.removeItem('daralef_notif_seen'); } catch (e3) {}
      if (u && u.must_change) {
        uswMsg('تم الدخول بكلمة مؤقتة — غيّرها من قسم المستخدمين (تبويب كلمة مروري)', 1);
        setTimeout(function () { location.reload(); }, 1600);
      } else {
        uswMsg('تم التبديل إلى ' + username + ' — جارٍ التحديث…', 1);
        setTimeout(function () { location.reload(); }, 500);
      }
    } catch (e) {
      uswMsg((e && e.message) || 'تعذر التبديل', 0);
    }
    if (go) go.disabled = false;
  }

  async function doLogout() {
    try {
      if (typeof api === 'function') await api('/logout', { method: 'POST' });
      else await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    } catch (e) {}
    try {
      localStorage.removeItem('daralef_token');
      localStorage.removeItem('daralef_notif_seen');
    } catch (e2) {}
    location.href = basePrefix() + 'login.html';
  }

  function ensureMount() {
    if (isLoginPage() || !hasToken()) return null;
    if (document.getElementById('userSwitchBtn')) return document.getElementById('userSwitchBtn');
    var actions = document.querySelector('.page-head .actions') || document.querySelector('.topbar');
    if (!actions) return null;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'userSwitchBtn';
    btn.className = 'btn btn-ghost btn-sm';
    btn.title = 'تبديل المستخدم الحالي';
    btn.textContent = '⇄ تبديل';
    btn.addEventListener('click', openModal);
    var chip = actions.querySelector('.user-chip');
    if (chip && chip.parentNode === actions) actions.insertBefore(btn, chip.nextSibling);
    else actions.insertBefore(btn, actions.firstChild);

    if (!document.getElementById('uswOverlay')) {
      var o = document.createElement('div');
      o.className = 'usw-overlay';
      o.id = 'uswOverlay';
      o.hidden = true;
      o.innerHTML = '<div class="usw-modal" role="dialog" aria-modal="true" aria-label="تبديل المستخدم">'
        + '<div class="usw-head"><b>⇄ تبديل المستخدم</b>'
        + '<button type="button" class="notif-close" id="uswClose" title="إغلاق" aria-label="إغلاق">✕</button></div>'
        + '<div class="usw-cur"><span>الجلسة الحالية: <b id="uswCur">—</b></span>'
        + '<button type="button" class="btn btn-ghost btn-sm" id="uswLogout">تسجيل الخروج</button></div>'
        + '<div id="uswMsg"></div>'
        + '<label>المستخدم<select id="uswUser"></select>'
        + '<input id="uswUserText" dir="ltr" autocomplete="username" placeholder="اسم الدخول" hidden></label>'
        + '<label>كلمة مرور الحساب المختار<input id="uswPass" type="password" autocomplete="current-password" placeholder="مطلوبة للتبديل"></label>'
        + '<button type="button" class="btn btn-primary" id="uswGo" style="width:100%;justify-content:center">دخول بالحساب المختار</button>'
        + '<p class="field-hint">التبديل يتطلب كلمة المرور — 5 محاولات خاطئة تقفل الحساب مؤقتاً.</p>'
        + '</div>';
      document.body.appendChild(o);
      document.getElementById('uswClose').addEventListener('click', closeModal);
      document.getElementById('uswLogout').addEventListener('click', doLogout);
      document.getElementById('uswGo').addEventListener('click', doSwitch);
      document.getElementById('uswPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSwitch(); });
      o.addEventListener('click', function (e) { if (e.target === o) closeModal(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    }
    return btn;
  }

  function init() {
    if (isLoginPage() || !hasToken()) return;
    ensureMount();
  }

  window.UserSwitch = { init: init, open: openModal, close: closeModal, logout: doLogout };
  document.addEventListener('DOMContentLoaded', init);
})();
