// التخطيط الموحد V2 — هوية دار العلف
// الوظيفة: ترقية أي صفحة قديمة تلقائياً للهوية الجديدة بدون كسر المنطق
// الاستخدام: <script src="../shared/utils/layout.js" data-title=".." data-sub=".."></script>
(function () {
  function basePrefix() {
    // من داخل قسم: ../ ومن الرئيسية: ./
    try {
      const p = location.pathname.replace(/\\/g, '/');
      if (p.endsWith('/index.html')) {
        const parts = p.split('/').filter(Boolean);
        // .../frontend/<section>/index.html => عمق قسم واحد
        return parts.length >= 2 && parts[parts.length - 2] !== 'frontend' ? '../' : './';
      }
      return './';
    } catch { return '../'; }
  }
  const base = basePrefix();

  function ensureHead() {
    const head = document.head;
    if (!document.querySelector('link[data-print]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = base + 'assets/styles/print.css'; l.setAttribute('data-print', '1');
      head.appendChild(l);
    }
    if (!document.querySelector('link[rel="icon"]')) {
      const f = document.createElement('link');
      f.rel = 'icon'; f.type = 'image/svg+xml'; f.href = base + 'assets/logo/favicon.svg';
      head.appendChild(f);
    }
  }

  function upgradeSidebar() {
    const sb = document.querySelector('.sidebar');
    if (!sb) return;
    // 1) استبدال العنوان الإيموجي القديم بكتلة العلامة (مرة واحدة)
    const h2 = sb.querySelector('h2');
    if (h2 && !sb.querySelector('.brand')) {
      const brand = document.createElement('div');
      brand.className = 'brand';
      brand.innerHTML = '<img src="' + base + 'assets/logo/logo.svg" alt="دار العلف">'
        + '<div><div class="brand-name">دار العلف</div><div class="brand-sub">إدارة مصنع الأعلاف</div></div>';
      h2.replaceWith(brand);
    }
    // إصلاح مسار الشعار حسب العمق
    const logo = sb.querySelector('.brand img');
    if (logo) logo.src = base + 'assets/logo/logo.svg';
    // 2) تفعيل الرابط النشط تلقائياً حسب المسار (يحمي من نسيان active)
    try {
      const path = location.pathname.replace(/\\/g, '/');
      sb.querySelectorAll('nav a').forEach(a => {
        const href = (a.getAttribute('href') || '').replace('./', '').replace('../', '');
        const seg = href.split('/')[0];
        if (seg && path.includes('/' + seg + '/')) {
          sb.querySelectorAll('nav a').forEach(x => x.classList.remove('active'));
          a.classList.add('active');
        }
      });
    } catch {}
  }

  // رأس واحد فقط: إن وُجد رأس الصفحة نحقن فيه شارة المتصل بجانب الدور، وإلا ننشئ الشريط (للصفحات القديمة)
  function injectTopbar() {
    const main = document.querySelector('main.content');
    if (!main) return;
    const head = main.querySelector('.page-head');
    if (head) {
      let actions = head.querySelector('.actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'actions';
        head.appendChild(actions);
      }
      if (!actions.querySelector('.user-chip')) {
        const chip = document.createElement('div');
        chip.className = 'user-chip';
        chip.innerHTML = '<span class="dot"></span><span>متصل — ' + (localStorage.getItem('daralef_user') || 'مدير') + '</span>';
        actions.insertBefore(chip, actions.firstChild);
      }
      const stray = main.querySelector('.topbar');
      if (stray) stray.remove();
      return;
    }
    if (document.querySelector('.topbar')) return;
    const s = document.currentScript;
    const title = (s && s.getAttribute('data-title')) || 'دار العلف';
    const sub = (s && s.getAttribute('data-sub')) || 'نظام إدارة مصنع الأعلاف الحيوانية';
    const bar = document.createElement('div');
    bar.className = 'topbar';
    bar.innerHTML = '<div><p class="page-title">' + title + '</p><p class="page-sub">' + sub + '</p></div>'
      + '<div class="spacer"></div>'
      + '<div class="user-chip"><span class="dot"></span><span>متصل — ' + (localStorage.getItem('daralef_user') || 'مدير') + '</span></div>'
      + '<button class="btn btn-ghost btn-sm" onclick="window.print()">طباعة</button>';
    main.prepend(bar);
  }

  function injectFooter() {
    if (document.querySelector('.footer-note')) return;
    const main = document.querySelector('main.content');
    if (!main) return;
    const f = document.createElement('div');
    f.className = 'footer-note';
    f.textContent = 'دار العلف — الهوية V2 · FIFO · التتبع باللوتات · النسخ اليومي';
    main.appendChild(f);
  }

  // تنسيق الأسعار الافتراضي والمعتمد لكل الأقسام: تجميع بالفاصلة + صفرين عشريين + دج
  // مثال: 1035000 -> "1,035,000.00 دج" — أي قسم جديد يستعمل Layout.dzd() فقط
  function fmtDZD(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    var neg = x < 0 ? '-' : '';
    var cents = Math.round(Math.abs(x) * 100);
    var int = String(Math.floor(cents / 100));
    var dec = String(cents % 100).padStart(2, '0');
    int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return neg + int + '.' + dec + ' ' + (window.Layout.currency || 'دج');
  }

  // مساعد الصلاحيات الموحد لكل الصفحات: Perms.can('procurement','approve')
  window.Perms = window.Perms || {
    data: null,
    async load() {
      try {
        if (typeof api !== 'function') return;
        this.data = (await api('/auth/permissions')).data;
      } catch (e) { this.data = null; }
    },
    can(sec, act) {
      return !!(this.data && this.data.perms && this.data.perms[sec] && this.data.perms[sec][act]);
    }
  };
  window.Layout = {
    dzd: function (n) { return fmtDZD(n); },
    kpi(c) {
      const t = c.trend === 'up' ? 'trend-up' : c.trend === 'down' ? 'trend-down' : 'trend-flat';
      const arrow = c.trend === 'up' ? '▲' : c.trend === 'down' ? '▼' : '•';
      return '<div class="kpi-card"><div class="kpi-ico">' + (c.icon || '•') + '</div>'
        + '<div class="kpi-label">' + c.label + '</div>'
        + '<div class="kpi-value">' + c.value + '</div>'
        + '<div class="kpi-trend ' + t + '">' + arrow + ' ' + (c.trendText || '') + '</div></div>';
    },
    badge(text, level) {
      return '<span class="badge badge-' + (level || 'neutral') + '">' + text + '</span>';
    },
    statusBadge(status) {
      const s = String(status || '');
      if (/معتمد|مقبول|رابح|سليم|نشط|مدفوع|مؤكدة بالكامل/i.test(s)) return this.badge(s, 'success');
      if (/قيد|فحص|انتظار|مسودة|مؤكدة جزئياً/i.test(s)) return this.badge(s, 'warning');
      if (/مرفوض|خاسر|ناقص|منتهي|متجاوز/i.test(s)) return this.badge(s, 'danger');
      if (/معلومة|مالي|إنتاج/i.test(s)) return this.badge(s, 'info');
      return this.badge(s, 'neutral');
    },
    // تحليل أرقام متسامح: عربية/فارسية/فواصل/مسافات — يرمي رسالة عربية عند الفشل
    parseNum(s, label) {
      if (s === null || s === undefined) return 0;
      s = String(s).trim();
      if (s === '') return 0;
      s = s.replace(/[٠-٩]/g, function (ch) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(ch); })
           .replace(/[۰-۹]/g, function (ch) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch); })
           .replace(/[\s  ']/g, '').replace(/٬/g, '').replace(/[٫,]/g, '.');
      var parts = s.split('.');
      if (parts.length > 2) s = parts.shift() + '.' + parts.join('');
      var num = Number(s);
      if (!isFinite(num)) throw new Error((label || 'الرقم') + ': أدخل رقماً صحيحاً');
      return num;
    },
    // قفل لحظي: أرقام فقط (صحيح/عشري/هاتف) — يُستدعى بعد بناء أي نموذج ديناميكي
    enforceDigits() {
      function ar2lat(v) {
        return String(v).replace(/[٠-٩]/g, function (ch) { return String(ch.charCodeAt(0) - 0x0660); })
                        .replace(/[۰-۹]/g, function (ch) { return String(ch.charCodeAt(0) - 0x06F0); });
      }
      document.querySelectorAll('[data-int]').forEach(function (el) {
        if (el.dataset.locked) return; el.dataset.locked = '1';
        el.addEventListener('input', function () {
          var clean = ar2lat(el.value).replace(/[^0-9]/g, '');
          if (clean !== el.value) el.value = clean;
        });
      });
      document.querySelectorAll('[data-dec]').forEach(function (el) {
        if (el.dataset.locked) return; el.dataset.locked = '1';
        el.addEventListener('input', function () {
          var s = ar2lat(el.value).replace(/[٫,]/g, '.').replace(/[^0-9.]/g, '');
          var parts = s.split('.');
          if (parts.length > 2) s = parts.shift() + '.' + parts.join('');
          if (s !== el.value) el.value = s;
        });
      });
      document.querySelectorAll('[data-phone]').forEach(function (el) {
        if (el.dataset.locked) return; el.dataset.locked = '1';
        el.addEventListener('input', function () {
          var clean = ar2lat(el.value).replace(/[^0-9]/g, '').slice(0, 15);
          if (clean !== el.value) el.value = clean;
        });
      });
    }
  };

  // إعدادات النظام العامة: العملة والهوية والتنبيهات (افتراضيات آمنة عند التعذر)
  window.Layout.currency = window.Layout.currency || 'دج';
  window.Layout.notifications = window.Layout.notifications || null;
  async function loadConfig() {
    try {
      const r = await fetch('/api/system/public');
      if (!r.ok) return;
      const c = ((await r.json()).data) || {};
      if (c.currency) window.Layout.currency = c.currency;
      if (c.factory && c.factory.name) {
        document.querySelectorAll('.brand-name').forEach(function (e) { e.textContent = c.factory.name; });
        try { document.title = document.title.replace(/^[^-–—]+/, c.factory.name + ' '); } catch (e2) {}
      }
      if (c.notifications) window.Layout.notifications = c.notifications;
    } catch (e) {}
  }
  function notifyOn(kind) {
    const n = window.Layout.notifications;
    if (!n) return true;
    return n[kind] !== false;
  }
  window.Layout.notifyOn = notifyOn;

  document.addEventListener('DOMContentLoaded', function () {
    ensureHead(); upgradeSidebar(); injectTopbar(); injectFooter(); loadConfig();
  });
})();
