// التخطيط الموحد V2 — هوية دار العلف
// الوظيفة: ترقية أي صفحة قديمة تلقائياً للهوية الجديدة بدون كسر المنطق
// الاستخدام: <script src="../shared/utils/layout.js" data-title=".." data-sub=".."></script>
(function () {
  function basePrefix() {
    // حساب العمق من المسار ليعمل مع: /index.html و /قسم/index.html و /قسم/ و /
    try {
      const p = location.pathname.replace(/\\/g, '/');
      const segs = p.split('/').filter(Boolean);
      if (segs.length && /\.[a-z0-9]+$/i.test(segs[segs.length - 1])) segs.pop(); // إسقاط اسم الملف
      if (!segs.length) return './';
      return '../'.repeat(segs.length);
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
    // P1 — هوية المتصفح والجوال: theme-color + وصف + manifest + خط Cairo (مرة واحدة، بدون كسر)
    try {
      if (!document.querySelector('meta[name="theme-color"]')) {
        const m = document.createElement('meta');
        m.name = 'theme-color'; m.content = '#123524';
        head.appendChild(m);
      }
      if (!document.querySelector('meta[name="description"]')) {
        const d = document.createElement('meta');
        d.name = 'description';
        d.content = 'دار العلف — نظام إدارة مصنع الأعلاف: مخزون FEFO، إنتاج، مبيعات، مالية وتتبع باللوتات';
        head.appendChild(d);
      }
      if (!document.querySelector('link[rel="manifest"]')) {
        const mf = document.createElement('link');
        mf.rel = 'manifest'; mf.href = base + 'manifest.webmanifest';
        head.appendChild(mf);
      }
      if (!document.querySelector('link[rel="apple-touch-icon"]')) {
        const at = document.createElement('link');
        at.rel = 'apple-touch-icon'; at.href = base + 'assets/logo/logo.svg';
        head.appendChild(at);
      }
      // خط Cairo مع fallback تلقائي — يعمل offline بالخط البديل عند انقطاع الإنترنت
      if (!document.querySelector('link[data-cairo]')) {
        const pre1 = document.createElement('link');
        pre1.rel = 'preconnect'; pre1.href = 'https://fonts.googleapis.com';
        head.appendChild(pre1);
        const pre2 = document.createElement('link');
        pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com';
        pre2.crossOrigin = 'anonymous';
        head.appendChild(pre2);
        const cf = document.createElement('link');
        cf.rel = 'stylesheet';
        cf.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap';
        cf.setAttribute('data-cairo', '1');
        head.appendChild(cf);
      }
      // P3 — مشاركة SEO/OG (مرة واحدة)
      if (!document.querySelector('meta[property="og:title"]')) {
        const og = [
          ['og:title', document.title || 'دار العلف — إدارة مصنع الأعلاف'],
          ['og:description', 'نظام إدارة مصنع الأعلاف: مخزون FEFO، إنتاج، مبيعات، مالية وتتبع باللوتات'],
          ['og:type', 'website'],
          ['og:locale', 'ar_DZ']
        ];
        for (const [p, c] of og) {
          const m = document.createElement('meta');
          m.setAttribute('property', p); m.content = c;
          head.appendChild(m);
        }
      }
    } catch {}
  }

  // P1 — كروم التنقل للجوال: زر ☰ + طبقة تعتيم + شريط سفلي (5 أقسام سريعة)
  function ensureNavChrome() {
    try {
      const sb = document.querySelector('.sidebar');
      if (!sb) return; // صفحة الدخول بلا تنقل
      if (/login\.html$/.test(location.pathname)) return;
      // 1) زر الهامبرغر في رأس الصفحة
      const main = document.querySelector('main.content');
      let anchor = null;
      if (main) {
        const head = main.querySelector('.page-head');
        anchor = (head && (head.querySelector('.actions') || head)) || main.querySelector('.topbar');
      }
      if (anchor && !anchor.querySelector('.nav-toggle')) {
        const btn = document.createElement('button');
        btn.className = 'nav-toggle';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'فتح قائمة التنقل');
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = '☰';
        btn.addEventListener('click', function () {
          const open = document.body.classList.toggle('nav-open');
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          btn.setAttribute('aria-label', open ? 'إغلاق قائمة التنقل' : 'فتح قائمة التنقل');
        });
        anchor.insertBefore(btn, anchor.firstChild);
      }
      // 2) طبقة التعتيم (مرة واحدة)
      if (!document.querySelector('.nav-scrim')) {
        const scrim = document.createElement('div');
        scrim.className = 'nav-scrim';
        scrim.setAttribute('aria-hidden', 'true');
        scrim.addEventListener('click', closeNav);
        document.body.appendChild(scrim);
      }
      // 3) الشريط السفلي (مرة واحدة) — يعمل من أي عمق عبر base + أيقونات SVG
      if (!document.querySelector('.bottom-nav')) {
        const items = [
          { seg: 'dashboard', href: base + 'dashboard/index.html', icon: 'dash', label: 'القيادة' },
          { seg: 'inventory', href: base + 'inventory/index.html', icon: 'box', label: 'المخزون' },
          { seg: 'home', href: base + 'index.html', icon: 'home', label: 'الرئيسية', home: true },
          { seg: 'production', href: base + 'production/index.html', icon: 'prod', label: 'الإنتاج' },
          { seg: 'sales', href: base + 'sales/index.html', icon: 'sales', label: 'المبيعات' }
        ];
        const nav = document.createElement('nav');
        nav.className = 'bottom-nav';
        nav.setAttribute('aria-label', 'تنقل سريع');
        const path = String(location.pathname || '');
        nav.innerHTML = items.map(function (it) {
          let active = '';
          try {
            if (it.home) {
              active = (/(^|\/)index\.html$/.test(path) && !/\/(dashboard|inventory|production|sales|master-data|procurement|quality-control|lots|formulas|finance|employees|reports|users|system)\//.test(path)) ? ' active' : '';
            } else if (path.includes('/' + it.seg + '/')) active = ' active';
          } catch (e) {}
          return '<a href="' + it.href + '" class="' + active.trim() + '"><svg class="ico-svg" aria-hidden="true"><use href="' + base + 'assets/icons/icons.svg#i-' + it.icon + '"></use></svg><span>' + it.label + '</span></a>';
        }).join('');
        document.body.appendChild(nav);
      }
      // 4) إغلاق الدرج عند اختيار رابط + زر ESC
      if (!document.body.hasAttribute('data-nav-bound')) {
        document.body.setAttribute('data-nav-bound', '1');
        sb.addEventListener('click', function (e) {
          if (e.target && e.target.closest && e.target.closest('nav a')) closeNav();
        });
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') closeNav();
        });
      }
      function closeNav() {
        document.body.classList.remove('nav-open');
        const t = document.querySelector('.nav-toggle');
        if (t) { t.setAttribute('aria-expanded', 'false'); t.setAttribute('aria-label', 'فتح قائمة التنقل'); }
      }
      window.closeNav = window.closeNav || closeNav;
    } catch {}
  }

  // P1 — الجداول كبطاقات: ننسخ عناوين thead إلى data-label تلقائياً (بدون تعديل الـ15 صفحة)
  function enhanceTables() {
    try {
      document.querySelectorAll('table.app-table').forEach(function (tbl) {
        const ths = Array.prototype.map.call(tbl.querySelectorAll('thead th'), function (th) {
          return (th.textContent || '').trim();
        });
        if (!ths.length) return;
        tbl.querySelectorAll('tbody tr').forEach(function (tr) {
          Array.prototype.forEach.call(tr.children, function (td, i) {
            if (td && !td.hasAttribute('data-label') && ths[i]) td.setAttribute('data-label', ths[i]);
          });
        });
        const wrap = tbl.closest ? tbl.closest('.table-wrap') : null;
        if (wrap) wrap.classList.add('table-cards');
      });
      // مراقبة الجداول المحقونة ديناميكياً (تقارير/داشبورد) — مرة واحدة
      if (!window.__tableObs && typeof MutationObserver !== 'undefined') {
        window.__tableObs = true;
        const obs = new MutationObserver(function () {
          try {
            document.querySelectorAll('table.app-table:not([data-enhanced])').forEach(function (tbl) {
              tbl.setAttribute('data-enhanced', '1');
              const ths = Array.prototype.map.call(tbl.querySelectorAll('thead th'), function (th) { return (th.textContent || '').trim(); });
              tbl.querySelectorAll('tbody tr').forEach(function (tr) {
                Array.prototype.forEach.call(tr.children, function (td, i) {
                  if (td && !td.hasAttribute('data-label') && ths[i]) td.setAttribute('data-label', ths[i]);
                });
              });
              const w = tbl.closest ? tbl.closest('.table-wrap') : null;
              if (w) w.classList.add('table-cards');
            });
          } catch (e) {}
        });
        obs.observe(document.body, { childList: true, subtree: true });
      }
    } catch {}
  }

  function upgradeSidebar() {
    const sb = document.querySelector('.sidebar');
    if (!sb) return;
    // P1 — وصولية الدرج
    try {
      if (!sb.hasAttribute('role')) sb.setAttribute('role', 'navigation');
      if (!sb.hasAttribute('aria-label')) sb.setAttribute('aria-label', 'التنقل الرئيسي');
      const nav = sb.querySelector('nav');
      if (nav && !nav.hasAttribute('aria-label')) nav.setAttribute('aria-label', 'أقسام النظام');
    } catch {}
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
    // 2) إضافة الأرقام تلقائياً للروابط التي لا تحتوي على data-number
    const sectionNumbers = {
      'index.html': '1',
      'dashboard/index.html': '2',
      'analytics/index.html': '14',
      'master-data/index.html': '3',
      'procurement/index.html': '4',
      'quality-control/index.html': '5',
      'inventory/index.html': '6',
      'lots/index.html': '7',
      'formulas/index.html': '8',
      'production/index.html': '9',
      'sales/index.html': '10',
      'finance/index.html': '11',
      'employees/index.html': '12',
      'reports/index.html': '13',
      'users/index.html': '15',
      'system/index.html': '16'
    };
    sb.querySelectorAll('nav a').forEach(a => {
      const href = (a.getAttribute('href') || '').replace(/^(\.\/|\.\.\/)+/, '');
      // إزالة الرقم من النص إذا كان موجوداً
      const text = a.textContent.replace(/^\d+\.\s*/, '');
      a.textContent = text;
      // إضافة data-number إذا لم يكن موجوداً
      if (!a.hasAttribute('data-number') && sectionNumbers[href]) {
        a.setAttribute('data-number', sectionNumbers[href]);
      }
    });
    // 3) تفعيل الرابط النشط تلقائياً حسب المسار (يحمي من نسيان active)
    try {
      const path = location.pathname.replace(/\\/g, '/');
      sb.querySelectorAll('nav a').forEach(a => {
        const href = (a.getAttribute('href') || '').replace(/^(\.\/|\.\.\/)+/, '');
        const seg = href.split('/')[0];
        if (seg && path.includes('/' + seg + '/')) {
          sb.querySelectorAll('nav a').forEach(x => x.classList.remove('active'));
          a.classList.add('active');
        }
      });
    } catch {}
    // 4) تسلسل التحليلات أسفل التقارير (13): نقل رابط analytics ليكون بعد reports مباشرة + توحيد رقمه 14
    try {
      const nav = sb.querySelector('nav');
      if (nav) {
        const links = Array.from(nav.querySelectorAll('a'));
        const find = (seg) => links.find(a => String(a.getAttribute('href') || '').replace(/^(\.\/|\.\.\/)+/, '').split('/')[0] === seg);
        const rep = find('reports'), ana = find('analytics');
        if (rep && ana && ana.previousElementSibling !== rep) {
          rep.after(ana);
        }
        if (ana) ana.setAttribute('data-number', '14');
      }
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
      + '<button class="btn btn-danger btn-sm" onclick="confirmLogout()">تسجيل الخروج</button>';
    main.prepend(bar);
  }

  // ساعة رأس الصفحة + التاريخ الهجري — سطر صغير أسفل الأزرار (زر الخروج) في كل الأقسام
  function hijriStr(d) {
    var locs = ['ar-DZ-u-ca-islamic', 'ar-SA-u-ca-islamic-umalqura', 'ar-u-ca-islamic'];
    for (var i = 0; i < locs.length; i++) {
      try {
        return new Intl.DateTimeFormat(locs[i], { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
      } catch (e) {}
    }
    try { return d.toLocaleDateString('ar-DZ'); } catch (e2) { return ''; }
  }
  function tickClock() {
    try {
      var el = document.getElementById('headClock');
      if (!el) return;
      var now = new Date();
      var t = el.querySelector('.hc-time'), h = el.querySelector('.hc-hijri');
      if (t) {
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        t.textContent = p(now.getHours()) + ':' + p(now.getMinutes()) + ':' + p(now.getSeconds());
      }
      if (h) {
        var key = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
        if (el.dataset.day !== key) { el.dataset.day = key; h.textContent = hijriStr(now); }
      }
    } catch (e) {}
  }
  function ensureClock() {
    try {
      var main = document.querySelector('main.content');
      if (!main) return;
      var head = main.querySelector('.page-head');
      var actions = head ? head.querySelector('.actions') : null;
      if (!actions) return;
      if (!document.getElementById('headClock')) {
        var d = document.createElement('div');
        d.className = 'head-clock';
        d.id = 'headClock';
        d.innerHTML = '<span>🕐</span><span class="hc-time">--:--:--</span><span class="hc-sep">|</span><span>🌙</span><span class="hc-hijri">…</span>';
        actions.appendChild(d);
      }
      tickClock();
      if (!window.__clockTimer) window.__clockTimer = setInterval(tickClock, 1000);
    } catch (e) {}
  }

  function injectFooter() {    if (document.querySelector('.footer-note')) return;
    const main = document.querySelector('main.content');
    if (!main) return;
    const f = document.createElement('div');
    f.className = 'footer-note';
    f.textContent = 'دار العلف — الهوية V2 · FEFO · التتبع باللوتات · النسخ اليومي';
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
      // الفشل يرمي صراحة (بدل الصمت) حتى يميز ensureLogin بين عارض الشبكة والجلسة الميتة
      if (typeof api !== 'function') throw new Error('تعذر الاتصال بالخادم');
      try {
        this.data = (await api('/auth/permissions')).data;
      } catch (e) {
        this.data = null;
        throw e;
      }
    },
    can(sec, act) {
      return !!(this.data && this.data.perms && this.data.perms[sec] && this.data.perms[sec][act]);
    }
  };
  // سجل البطاقات المركزي (تبويب النظام 7): القسم ← الاسم الأصلي + الأيقونة الأصلية
  // المطابقة بالاسم الأصلي — أي قسم جديد يضيف بطاقاته هنا فقط
  const CARD_CATALOG = {
    'dashboard': [
      { label: 'الرصيد (صندوق+بنك)', icon: '💰' }, { label: 'صافي ربح الشهر', icon: '📈' },
      { label: 'المصاريف العامة', icon: '💸' }, { label: 'ديون علينا', icon: '📤' },
      { label: 'ديون لنا', icon: '📥' }, { label: 'مخزون (خام)', icon: '📦' },
      { label: 'مخزون (تام)', icon: '🏭' }, { label: 'إنتاج (أسبوع/شهر)', icon: '📅' },
      { label: 'مبيعات الشهر', icon: '💵' }, { label: 'تنبيهات نشطة', icon: '🔔' },
      { label: 'بانتظار الموافقة', icon: '⏳' }, { label: 'بانتظار الوصول', icon: '📤' },
      { label: 'جزئية مفتوحة', icon: '◐' },
      { label: 'تكلفة الطن التقديرية', icon: '⚖️' }, { label: 'التدفق النقدي (صافي آخر شهر)', icon: '💸' },
      { label: 'إنتاج اليوم', icon: '☀️' }, { label: 'قيد التنفيذ', icon: '🏭' },
      { label: 'الهدر % (الشهر)', icon: '📉' }, { label: 'مسودة / مكتملة / ملغاة', icon: '📋' },
      { label: 'قيمة المخزون', icon: '💰' }, { label: 'مواد تحت الحد', icon: '🔻' },
      { label: 'قريبة الانتهاء (60 يوم)', icon: '⏳' }, { label: 'موافقات متأخرة (>7 أيام)', icon: '🚨' },
      { label: 'فحص بانتظار القرار', icon: '⏳' }, { label: 'مقبولة (جودة)', icon: '✅' },
      { label: 'مرفوضة (جودة)', icon: '⛔' }, { label: 'مبيعات اليوم', icon: '💰' },
      { label: 'تحصيل الشهر', icon: '🧾' }, { label: 'فواتير متأخرة (>30 يوم)', icon: '🧷' },
      { label: 'مرتجعات الشهر', icon: '↩️' }
    ],
    'master-data': [
      { label: 'آخر مورد', icon: '🏭' }, { label: 'آخر زبون', icon: '🤝' },
      { label: 'آخر مادة أولية', icon: '🌾' }, { label: 'آخر تعديل بالقسم', icon: '🕒' },
      { label: 'النشطون', icon: '📦' }, { label: 'الحالة', icon: '⚠️' }
    ],
    'procurement': [
      { label: 'بانتظار الموافقة', icon: '⏳' }, { label: 'معتمدة تنتظر الوصول', icon: '📤' },
      { label: 'عرابين هذا الشهر', icon: '💵' }, { label: 'آخر طلبية مؤكدة', icon: '✅' },
      { label: 'مؤكدة جزئياً مفتوحة', icon: '◐' }
    ],
    'quality-control': [
      { label: 'بانتظار المراجعة', icon: '⏳' }, { label: 'مقبولة', icon: '✅' },
      { label: 'مرفوضة', icon: '⛔' }, { label: 'نسبة الرفض', icon: '📊' },
      { label: 'آخر قرار', icon: '🕒' }
    ],
    'inventory': [
      { label: 'عند الحد الأدنى أو أقل', icon: '🔻' }, { label: 'قريبة الانتهاء (60 يوم)', icon: '⏳' },
      { label: 'آخر جرد', icon: '📋' }, { label: 'القيمة التقديرية', icon: '💰' },
      { label: 'آخر تلف مسجل', icon: '🗑️' }
    ],
    'lots': [
      { label: 'الدفعات النشطة', icon: '📦' }, { label: 'المحجوبة', icon: '⛔' },
      { label: 'قريبة الانتهاء', icon: '⏳' }, { label: 'قيمة اللوتات', icon: '💰' },
      { label: 'آخر حركة', icon: '⚡' }
    ],
    'formulas': [
      { label: 'التركيبات النشطة', icon: '📋' }, { label: 'أرخص قنطار', icon: '🥇' },
      { label: 'أغلى قنطار', icon: '⚠️' }, { label: 'متوسط القنطار', icon: '📊' },
      { label: 'آخر سعر تغير', icon: '🔔' }
    ],
    'production': [
      { label: 'إنتاج اليوم', icon: '☀️' }, { label: 'إنتاج الأسبوع', icon: '📅' },
      { label: 'إنتاج الشهر', icon: '🗓️' }, { label: 'قيد التنفيذ', icon: '🏭' },
      { label: 'الهدر % (الشهر)', icon: '📉' }
    ],
    'sales': [
      { label: 'مبيعات اليوم', icon: '💰' }, { label: 'مبيعات الشهر', icon: '📈' },
      { label: 'المستحق لنا', icon: '🧾' }, { label: 'آخر فاتورة', icon: '🧷' },
      { label: 'مرتجعات الشهر', icon: '↩️' }
    ],
    'finance': [
      { label: 'الرصيد (صندوق+بنك)', icon: '💰' }, { label: 'ديون علينا (موردون)', icon: '📤' },
      { label: 'ديون لنا (زبائن)', icon: '📥' }, { label: 'مصاريف الشهر', icon: '🧾' },
      { label: 'صافي الربح التقديري', icon: '📈' }
    ],
    'employees': [
      { label: 'النشطون', icon: '👷' }, { label: 'رواتب مستحقة', icon: '💵' },
      { label: 'السلف الحالية', icon: '🤝' }, { label: 'غيابات الشهر', icon: '🚫' },
      { label: 'آخر راتب مدفوع', icon: '✅' }
    ],
    'users': [
      { label: 'النشطون', icon: '👥' }, { label: 'محاولات فاشلة اليوم', icon: '🚫' },
      { label: 'آخر دخول', icon: '🕒' }, { label: 'الأدوار', icon: '🎭' },
      { label: 'آخر تعديل صلاحية', icon: '✏️' }
    ],
    'analytics': [
      { label: 'خام (كمية)', icon: '📦' }, { label: 'تام (كمية)', icon: '🏭' },
      { label: 'القيمة الإجمالية', icon: '💰' }
    ]
  };
  const CARD_SECTION_NAMES = {
    'dashboard': 'لوحة القيادة', 'analytics': 'التحليلات', 'master-data': 'البيانات الأساسية', 'procurement': 'المشتريات',
    'quality-control': 'مراقبة الجودة', 'inventory': 'المخزون', 'lots': 'الدفعات والتتبع',
    'formulas': 'تركيبات الأعلاف', 'production': 'الإنتاج', 'sales': 'المبيعات',
    'finance': 'المالية والمحاسبة', 'employees': 'الموظفون والعمال',
    'reports': 'التقارير والمراقبة', 'users': 'المستخدمون والصلاحيات', 'system': 'النظام'
  };
  // القسم الحالي من المسار: /sales/ ← sales — يُستخدم لمطابقة البطاقة بقسمها (يحل تشابه الأسماء)
  function currentSection() {
    try {
      const segs = String(location.pathname || '').replace(/\\/g, '/').split('/').filter(Boolean);
      if (!segs.length) return 'home';
      if (segs.length === 1 && /\.[a-z0-9]+$/i.test(segs[0])) return 'home';
      return segs[0];
    } catch { return 'home'; }
  }

  window.Layout = {
    dzd: function (n) { return fmtDZD(n); },
    // P3 — أيقونة SVG موحدة: Layout.icon('sales') أو Layout.icon('💰') (إيموجي يُحوّل تلقائياً)
    _iconMap: {
      '📊': 'dash', '📦': 'box', '🛒': 'cart', '✅': 'check', '💰': 'money', '💵': 'money',
      '💸': 'money', '👷': 'users', '👥': 'users', '⚙️': 'gear', '⚙': 'gear',
      '🏠': 'home', '🗂️': 'master', '🔬': 'quality', '🔍': 'trace', '⚗️': 'formula',
      '🏭': 'prod', '🧾': 'sales', '💵🏦': 'finance', '📈': 'report', '🔐': 'lock',
      '🔔': 'bell', '📤': 'truck', '📥': 'truck', '🌾': 'wheat', '⏳': 'bell', '◐': 'dash',
      '📅': 'prod', '⚖️': 'finance', '☀️': 'dash', '📉': 'report', '📋': 'master',
      '🔻': 'bell', '🚨': 'bell', '⛔': 'lock', '🧷': 'sales', '↩️': 'truck',
      '🤝': 'users', '🚫': 'lock', '🥇': 'money', '⚠️': 'bell', '🗑️': 'box',
      '⚡': 'dash', '🕒': 'dash', '🗓️': 'prod', '🎭': 'users', '✏️': 'master'
    },
    icon: function (name, cls) {
      let id = String(name || '').trim();
      if (!id) return '•';
      if (id.indexOf('svg:') === 0) id = id.slice(4);
      else if (this._iconMap[id]) id = this._iconMap[id];
      else if (/^[a-z-]+$/.test(id)) { /* اسم مباشر */ }
      else return id; // إيموجي غير معروف: أبقه كما هو (توافق رجعي)
      return '<svg class="ico-svg ' + (cls || '') + '" aria-hidden="true"><use href="' + base + 'assets/icons/icons.svg#i-' + id + '"></use></svg>';
    },
    kpi(c) {
      // تبويب البطاقات (النظام 7): طبّق الاسم/الأيقونة/الإخفاء المخصص لهذا القسم — مطابقة بالاسم الأصلي
      try {
        const sec = currentSection();
        const cat = CARD_CATALOG[sec];
        if (cat && c && c.label) {
          const known = cat.some(function (e) { return e.label === c.label; });
          if (known) {
            const ov = (window.Layout.cards || {})[sec + '||' + c.label];
            if (ov) {
              if (ov.hidden) return '';
              if (ov.label) c = Object.assign({}, c, { label: ov.label });
              if (ov.icon) c = Object.assign({}, c, { icon: ov.icon });
            }
          }
        }
      } catch {}
      const t = c.trend === 'up' ? 'trend-up' : c.trend === 'down' ? 'trend-down' : 'trend-flat';
      const arrow = c.trend === 'up' ? '▲' : c.trend === 'down' ? '▼' : '•';
      const linkAttr = c.link ? ' data-link="' + c.link + '"' : '';
      const nameAttr = c.name ? ' data-name="' + c.name + '"' : '';
      const cursorStyle = c.link ? ' style="cursor: pointer;"' : '';
      // P3: حوّل إيموجي الـ KPI لـ SVG تلقائياً بدون تعديل الصفحات
      let ico = c.icon || '•';
      try {
        if (window.Layout && typeof window.Layout.icon === 'function' && ico && ico !== '•') {
          const mapped = window.Layout._iconMap[ico];
          if (mapped || (typeof ico === 'string' && (/^[a-z-]+$/.test(ico) || ico.indexOf('svg:') === 0))) ico = window.Layout.icon(ico);
        }
      } catch {}
      return '<div class="kpi-card"' + linkAttr + nameAttr + cursorStyle + '><div class="kpi-ico">' + ico + '</div>'
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
          var raw = el.value;
          if (el.hasAttribute('data-neg') && raw === '-') return;
          var neg = el.hasAttribute('data-neg') && raw.charAt(0) === '-';
          var clean = ar2lat(raw).replace(/[^0-9]/g, '');
          if (neg && clean !== '') clean = '-' + clean;
          if (clean !== raw) el.value = clean;
        });
      });
      document.querySelectorAll('[data-dec]').forEach(function (el) {
        if (el.dataset.locked) return; el.dataset.locked = '1';
        el.addEventListener('input', function () {
          var raw = el.value;
          if (el.hasAttribute('data-neg') && raw === '-') return;
          var neg = el.hasAttribute('data-neg') && raw.charAt(0) === '-';
          var s = ar2lat(raw).replace(/[٫,]/g, '.').replace(/[^0-9.]/g, '');
          var parts = s.split('.');
          if (parts.length > 2) s = parts.shift() + '.' + parts.join('');
          if (neg && s !== '') s = '-' + s;
          if (s !== raw) el.value = s;
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

  // إعدادات النظام العامة: العملة والهوية والتنبيهات والبطاقات (افتراضيات آمنة عند التعذر)
  window.Layout.currency = window.Layout.currency || 'دج';
  window.Layout.notifications = window.Layout.notifications || null;
  window.Layout.cards = window.Layout.cards || {};
  window.Layout.CARD_CATALOG = CARD_CATALOG;
  window.Layout.CARD_SECTION_NAMES = CARD_SECTION_NAMES;
  async function loadConfig() {
    try {
      // يفضّل api() المركزي (يحترم window.__API_URL__ والـ proxy)، مع بديل يحترم __API_URL__ أيضاً
      let c = null;
      if (typeof api === 'function') {
        c = ((await api('/system/public')).data) || {};
      } else {
        const g = (typeof window !== 'undefined' && window.__API_URL__) || '';
        const r = await fetch((g ? String(g).replace(/\/$/, '') : '') + '/api/system/public');
        if (!r.ok) return;
        c = ((await r.json()).data) || {};
      }
      if (c.currency) window.Layout.currency = c.currency;
      if (c.factory && c.factory.name) {
        document.querySelectorAll('.brand-name').forEach(function (e) { e.textContent = c.factory.name; });
        try { document.title = document.title.replace(/^[^-–—]+/, c.factory.name + ' '); } catch (e2) {}
      }
      if (c.notifications) window.Layout.notifications = c.notifications;
      if (c.cards && typeof c.cards === 'object') window.Layout.cards = c.cards;
      try { if (window.Layout.applyBranding) window.Layout.applyBranding(c.branding || null); } catch (e) {}
      // بطاقات المساعدة: تطبيق التخصيص كمتغيرات CSS (تبويب النظام 9)
      try {
        var hc = (c.helpCards && typeof c.helpCards === 'object') ? c.helpCards : null;
        window.Layout.helpCards = hc;
        var r2 = document.documentElement;
        var rm2 = function (n) { try { r2.style.removeProperty(n); } catch (e) {} };
        if (hc) {
          if (hc.fontSize) r2.style.setProperty('--nc-font-size', Number(hc.fontSize) + 'px'); else rm2('--nc-font-size');
          var hfonts = { cairo: 'Cairo,Tajawal,"Segoe UI",Arial,sans-serif', tajawal: 'Tajawal,Cairo,"Segoe UI",Arial,sans-serif', system: '"Segoe UI",Tahoma,Arial,sans-serif' };
          if (hc.fontFamily && hfonts[hc.fontFamily]) r2.style.setProperty('--nc-font', hfonts[hc.fontFamily]); else rm2('--nc-font');
          var hmaxw = { s: '300px', m: '380px', l: '460px' };
          if (hc.cardSize && hmaxw[hc.cardSize]) r2.style.setProperty('--nc-maxw', hmaxw[hc.cardSize]); else rm2('--nc-maxw');
          if (hc.textColor) r2.style.setProperty('--nc-text', String(hc.textColor)); else rm2('--nc-text');
          if (hc.bg) r2.style.setProperty('--nc-bg', String(hc.bg)); else rm2('--nc-bg');
          if (hc.opacity) r2.style.setProperty('--nc-opacity', String(Number(hc.opacity) / 100)); else rm2('--nc-opacity');
          var hsh = ['none', '0 1px 3px rgba(0,0,0,.12)', '0 6px 20px rgba(0,0,0,.14)', '0 12px 34px rgba(0,0,0,.20)'];
          r2.style.setProperty('--nc-shadow', hsh[hc.elevation] !== undefined ? hsh[hc.elevation] : hsh[2]);
          var hlv = hc.levels || {};
          ['info', 'warning', 'error', 'critical'].forEach(function (k) {
            if (hlv[k]) r2.style.setProperty('--nc-' + k, String(hlv[k])); else rm2('--nc-' + k);
          });
        } else {
          ['--nc-font-size', '--nc-font', '--nc-maxw', '--nc-text', '--nc-bg', '--nc-opacity', '--nc-info', '--nc-warning', '--nc-error', '--nc-critical'].forEach(rm2);
          r2.style.setProperty('--nc-shadow', '0 6px 20px rgba(0,0,0,.14)');
        }
      } catch (e) {}
    } catch (e) {}
  }
  function notifyOn(kind) {
    const n = window.Layout.notifications;
    if (!n) return true;
    return n[kind] !== false;
  }
  window.Layout.notifyOn = notifyOn;
  // محرك الهوية البصرية: يطبق إعدادات النظام ← الهوية كمتغيرات CSS (تبويب النظام 8)
  // في الداكن: لوحة داكنة منسقة + إعدادات dark.* فقط، وتُتجاهل ألوان الفاتح النصية لضمان القراءة
  function shade(hex, pct) {
    try {
      var h = String(hex || '').trim().replace('#', '');
      if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
      if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
      var n = function (i) { return parseInt(h.substr(i, 2), 16); };
      var f = function (v) { return Math.max(0, Math.min(255, Math.round(pct < 0 ? v * (1 + pct / 100) : v + (255 - v) * (pct / 100)))); };
      var s = function (v) { var x = v.toString(16); return x.length < 2 ? '0' + x : x; };
      return '#' + s(f(n(0))) + s(f(n(2))) + s(f(n(4)));
    } catch (e) { return null; }
  }
  window.Layout.applyBranding = function (cfg) {
    try {
      var root = document.documentElement;
      var set = function (k, v) { try { root.style.setProperty(k, v); } catch (e) {} };
      var rm = function (k) { try { root.style.removeProperty(k); } catch (e) {} };
      var ALL = ['--font-main', '--font-size', '--font-weight', '--primary', '--primary-dark', '--primary-ink', '--accent', '--bg', '--card', '--surface', '--text', '--sidebar-bg', '--sidebar-bg2', '--tbl-bg', '--th-bg', '--th-text', '--tbl-text', '--tbl-border', '--tbl-zebra', '--tbl-hover', '--tbl-selected', '--card-border', '--card-opacity', '--btn-bg', '--btn-text', '--btn-border', '--btn-scale', '--info', '--warning', '--error', '--danger', '--radius', '--radius-sm', '--shadow', '--shadow-lg', '--fn-add', '--fn-save', '--fn-edit', '--fn-view', '--fn-export', '--fn-import', '--fn-delete', '--fn-cancel', '--fn-close', '--fn-search', '--fn-print', '--fn-copy', '--fn-refresh', '--fn-pin', '--fn-settings', '--fn-stock', '--fn-pay', '--fn-invoice', '--fn-ship'];
      if (!cfg || typeof cfg !== 'object') {
        ALL.forEach(rm);
        try { delete root.dataset.theme; delete root.dataset.btnfx; delete root.dataset.density; } catch (e) {}
        return;
      }
      var shadows = {
        0: ['none', 'none'],
        1: null,
        2: ['0 4px 14px rgba(18,53,36,.12), 0 10px 30px rgba(18,53,36,.10)', '0 12px 36px rgba(18,53,36,.18)'],
        3: ['0 6px 20px rgba(18,53,36,.16), 0 16px 44px rgba(18,53,36,.14)', '0 18px 50px rgba(18,53,36,.24)']
      };
      var darkOn = !!(cfg.dark && cfg.dark.enabled);
      try {
        if (darkOn) root.dataset.theme = 'dark';
        else delete root.dataset.theme;
      } catch (e) {}
      var fonts = { cairo: '"Cairo", "Tajawal", "Segoe UI", Arial, sans-serif', tajawal: '"Tajawal", "Cairo", "Segoe UI", Arial, sans-serif', system: '"Segoe UI", Tahoma, Arial, sans-serif' };
      var F = cfg.font || {};
      if (F.family && fonts[F.family]) set('--font-main', fonts[F.family]);
      if (F.size) set('--font-size', Number(F.size) + 'px');
      if (F.weight) set('--font-weight', String(F.weight));
      if (F.color && !darkOn) set('--text', String(F.color));
      var C = cfg.colors || {};
      if (C.primary) {
        set('--primary', String(C.primary));
        var pd = shade(C.primary, -18), pi = shade(C.primary, -45);
        if (pd) set('--primary-dark', pd);
        if (pi) set('--primary-ink', pi);
        var sb = shade(C.primary, -55), sb2 = shade(C.primary, -70);
        if (!darkOn) { if (sb) set('--sidebar-bg', sb); if (sb2) set('--sidebar-bg2', sb2); }
      }
      if (C.secondary) set('--accent', String(C.secondary));
      if (!darkOn) {
        // الخلفية التلقائية: نسخة فاتحة جداً (أقل تركيزاً) من اللون الرئيسي — داكن مع فاتح
        if (C.autoBg === true && C.primary) {
          var tint = shade(C.primary, 93);
          if (tint) set('--bg', tint);
          else if (C.background) set('--bg', String(C.background));
        }
        else if (C.background) set('--bg', String(C.background));
        if (C.surface) { set('--card', String(C.surface)); set('--surface', String(C.surface)); }
        if (C.text) set('--text', String(C.text));
      } else {
        var D = cfg.dark || {};
        if (D.background) set('--bg', String(D.background));
        if (D.surface) { set('--card', String(D.surface)); set('--surface', String(D.surface)); }
        if (D.text) set('--text', String(D.text));
        // السايدبار يُضبط مباشرة (لا يعتمد على كتلة CSS قد تكون مخزنة قديمة)
        set('--sidebar-bg', '#0b1220');
        set('--sidebar-bg2', '#060b16');
      }
      var T = cfg.tables || {};
      if (!darkOn) {
        if (T.bg) set('--tbl-bg', String(T.bg));
        if (T.headerBg) set('--th-bg', String(T.headerBg));
        if (T.headerText) set('--th-text', String(T.headerText));
        if (T.text) set('--tbl-text', String(T.text));
        if (T.border) set('--tbl-border', String(T.border));
        if (T.selected) set('--tbl-selected', String(T.selected));
      }
      var K = cfg.cards || {};
      if (!darkOn) {
        if (K.bg) set('--card', String(K.bg));
        if (K.border) set('--card-border', String(K.border));
      }
      if (K.opacity !== undefined && K.opacity !== null) set('--card-opacity', String(Number(K.opacity) / 100));
      else rm('--card-opacity');
      var sh = shadows[K.shadow];
      if (sh) { set('--shadow', sh[0]); set('--shadow-lg', sh[1]); }
      else { rm('--shadow'); rm('--shadow-lg'); }
      var B = cfg.buttons || {};
      if (B.bg) set('--btn-bg', String(B.bg));
      if (B.text) set('--btn-text', String(B.text));
      if (B.border !== undefined) set('--btn-border', String(B.border || 'transparent'));
      var scales = { s: 0.9, m: 1, l: 1.12 };
      if (B.size && scales[B.size]) set('--btn-scale', String(scales[B.size]));
      try {
        if (B.fx && B.fx !== 'none') root.dataset.btnfx = B.fx;
        else delete root.dataset.btnfx;
      } catch (e) {}
      var A = cfg.alerts || {};
      if (A.info) set('--info', String(A.info));
      if (A.warning) set('--warning', String(A.warning));
      if (A.error) set('--error', String(A.error));
      if (A.critical) set('--danger', String(A.critical));
      if (cfg.radius !== undefined && cfg.radius !== null) {
        set('--radius', Number(cfg.radius) + 'px');
        set('--radius-sm', Math.max(2, Number(cfg.radius) - 4) + 'px');
      }
      // ألوان الوظائف الثابتة + الكثافة (النظام ← الهوية)
      var FN = cfg.func || {};
      ['add', 'save', 'edit', 'view', 'export', 'import', 'delete', 'cancel', 'close', 'search', 'print', 'copy', 'refresh', 'pin', 'settings', 'stock', 'pay', 'invoice', 'ship'].forEach(function (k) {
        if (FN[k]) set('--fn-' + k, String(FN[k]));
      });
      var LY = cfg.layout || {};
      try {
        if (LY.density && LY.density !== 'm') root.dataset.density = LY.density;
        else delete root.dataset.density;
      } catch (e) {}
      window.Layout.branding = cfg;
    } catch (e) {}
  };
  // طباعة موحدة بهوية الشاشة: theme.css + print.css + خط Cairo (بدل Arial المنعزل في كل صفحة)
  window.Layout.printDoc = window.Layout.printDoc || function (title, bodyHtml) {
    try {
      const w = window.open('', '_blank');
      if (!w) { alert('اسمح بالنوافذ المنبثقة للطباعة'); return; }
      w.document.write('<html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>' + String(title || 'طباعة') + '</title>'
        + '<link rel="preconnect" href="https://fonts.googleapis.com">'
        + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap">'
        + '<link rel="stylesheet" href="' + base + 'assets/styles/theme.css">'
        + '<link rel="stylesheet" href="' + base + 'assets/styles/print.css">'
        + '<style>body{font-family:Cairo,Arial,sans-serif;background:#fff}main.content{margin:0;max-width:100%}h2{text-align:center}</style>'
        + '</head><body><main class="content"><h2>' + String(title || '') + '</h2>' + String(bodyHtml || '')
        + '</main><script>window.onload=function(){window.focus();window.print()}<\/script></body></html>');
      w.document.close();
    } catch (e) { try { alert('تعذر فتح نافذة الطباعة'); } catch (_) {} }
  };

  // جرس التنبيهات الموحد: يُحمّل مرة واحدة ويُحقن في كل رأس صفحة لكل الأقسام
  // المكون: shared/utils/notifications.js — المصدر: GET /api/notifications
  function ensureNotifBell() {
    try {
      if (/login\.html$/.test(location.pathname)) return; // صفحة الدخول بلا جرس
      if (!localStorage.getItem('daralef_token')) return; // زائر بلا جلسة
    } catch (e) { return; }
    if (window.NotifBell && typeof window.NotifBell.init === 'function') {
      try { window.NotifBell.init(); } catch (e) {}
      return;
    }
    if (document.querySelector('script[data-notif-bell]')) return;
    // النسبي أولاً (يعمل تحت أي مسار نشر)، ثم المطلق كاحتياط
    var s = document.createElement('script');
    s.src = base + 'shared/utils/notifications.js?v=3';
    s.setAttribute('data-notif-bell', '1');
    s.defer = true;
    s.onload = function () {
      try { if (window.NotifBell) window.NotifBell.init(); } catch (e) {}
    };
    s.onerror = function () {
      try {
        if (window.NotifBell) { window.NotifBell.init(); return; }
        var f = document.createElement('script');
        f.src = '/shared/utils/notifications.js?v=3';
        f.setAttribute('data-notif-bell', '1');
        f.defer = true;
        f.onload = function () {
          try { if (window.NotifBell) window.NotifBell.init(); } catch (e2) {}
        };
        document.body.appendChild(f);
      } catch (e3) {}
    };
    document.body.appendChild(s);
  }

  // زر الخروج العام: يفوض لنافذة التأكيد في user-switch.js، مع بديل أصلي عند التعثر
  window.confirmLogout = window.confirmLogout || function () {
    try {
      if (window.UserSwitch && typeof window.UserSwitch.confirm === 'function') {
        window.UserSwitch.confirm();
        return;
      }
    } catch (e) {}
    if (!confirm('تأكيد تسجيل الخروج؟ سيتم إنهاء الجلسة الحالية والعودة لصفحة الدخول.')) return;
    try {
      var t = '';
      try { t = localStorage.getItem('daralef_token') || ''; } catch (e2) {}
      if (typeof api === 'function') { api('/logout', { method: 'POST' }).catch(function () {}); }
      else {
        var g = (typeof window !== 'undefined' && window.__API_URL__) || '';
        fetch((g ? String(g).replace(/\/$/, '') : '') + '/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: t ? 'Bearer ' + t : '' } }).catch(function () {});
      }
    } catch (e3) {}
    try { localStorage.removeItem('daralef_token'); localStorage.removeItem('daralef_notif_seen'); } catch (e4) {}
    alert('في أمان الله وحفظه، السلام عليكم ورحمة الله وبركاته');
    var base = './';
    try {
      var p = location.pathname.replace(/\\/g, '/');
      var segs = p.split('/').filter(Boolean);
      if (segs.length && /\.[a-z0-9]+$/i.test(segs[segs.length - 1])) segs.pop();
      base = segs.length ? new Array(segs.length + 1).join('../') : './';
    } catch (e5) {}
    location.href = base + 'login.html';
  };

  // تبديل المستخدم الموحد: زر في رأس كل صفحة + نافذة آمنة بكلمة مرور
  // المكون: shared/utils/user-switch.js — الدخول عبر POST /api/login المعتاد
  function ensureUserSwitch() {
    try {
      if (/login\.html$/.test(location.pathname)) return; // صفحة الدخول هي المبدّل نفسه
      if (!localStorage.getItem('daralef_token')) return; // زائر بلا جلسة
    } catch (e) { return; }
    if (window.UserSwitch && typeof window.UserSwitch.init === 'function') {
      try { window.UserSwitch.init(); } catch (e) {}
      return;
    }
    if (document.querySelector('script[data-user-switch]')) return;
    var s = document.createElement('script');
    s.src = base + 'shared/utils/user-switch.js?v=3';
    s.setAttribute('data-user-switch', '1');
    s.defer = true;
    s.onload = function () {
      try { if (window.UserSwitch) window.UserSwitch.init(); } catch (e) {}
    };
    s.onerror = function () {
      try {
        if (window.UserSwitch) { window.UserSwitch.init(); return; }
        var f = document.createElement('script');
        f.src = '/shared/utils/user-switch.js?v=3';
        f.setAttribute('data-user-switch', '1');
        f.defer = true;
        f.onload = function () {
          try { if (window.UserSwitch) window.UserSwitch.init(); } catch (e2) {}
        };
        document.body.appendChild(f);
      } catch (e3) {}
    };
    document.body.appendChild(s);
  }

  // P3 — ترقية إيموجي البطاقات الثابتة إلى SVG (توافق رجعي: يبقي النص عند فشل SVG)
  function ensureIcons() {
    try {
      const map = (window.Layout && window.Layout._iconMap) || {};
      const svgFor = (txt) => {
        const t = String(txt || '').trim();
        if (!t || !map[t]) return null;
        return '<svg class="ico-svg" aria-hidden="true"><use href="' + base + 'assets/icons/icons.svg#i-' + map[t] + '"></use></svg>';
      };
      // بطاقات البوابة .nav-card .ico (نص إيموجي واحد فقط)
      document.querySelectorAll('.nav-card .ico').forEach(function (el) {
        if (el.hasAttribute('data-svg')) return;
        const svg = svgFor(el.textContent);
        if (svg) {
          el.setAttribute('data-emoji', el.textContent.trim());
          el.innerHTML = svg;
          el.setAttribute('data-svg', '1');
        }
      });
      // أي kpi-ico ثابت في HTML (الديناميكي يُحوّل في Layout.kpi نفسه)
      document.querySelectorAll('.kpi-ico').forEach(function (el) {
        if (el.hasAttribute('data-svg')) return;
        if (el.querySelector('svg')) { el.setAttribute('data-svg', '1'); return; }
        const svg = svgFor(el.textContent);
        if (svg && el.textContent.trim().length <= 4) {
          el.setAttribute('data-emoji', el.textContent.trim());
          el.innerHTML = svg;
          el.setAttribute('data-svg', '1');
        }
      });
    } catch {}
  }

  // P3 — تنبيهات محمصة مركزية: Layout.toast('تم الحفظ', 'success')
  function ensureToast() {
    try {
      if (!document.querySelector('.toast-stack')) {
        const st = document.createElement('div');
        st.className = 'toast-stack';
        st.setAttribute('aria-live', 'polite');
        document.body.appendChild(st);
      }
      if (window.Layout && !window.Layout.toast) {
        window.Layout.toast = function (msg, type) {
          try {
            const stack = document.querySelector('.toast-stack');
            if (!stack) { alert(String(msg)); return; }
            const t = document.createElement('div');
            t.className = 'toast toast-' + (type || 'info');
            t.textContent = String(msg);
            stack.appendChild(t);
            setTimeout(function () {
              try { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 250); }
              catch (e) { t.remove(); }
            }, 3200);
            while (stack.children.length > 4) stack.firstChild.remove();
          } catch (e) { try { alert(String(msg)); } catch {} }
        };
      }
    } catch {}
  }

  // P3 — شريط عدم الاتصال + حالة body.is-offline
  function ensureOffline() {
    try {
      if (!document.querySelector('.offline-bar')) {
        const bar = document.createElement('div');
        bar.className = 'offline-bar';
        bar.textContent = 'لا يوجد اتصال بالإنترنت — بعض البيانات قد تكون قديمة';
        document.body.prepend(bar);
      }
      const sync = () => document.body.classList.toggle('is-offline', !navigator.onLine);
      window.addEventListener('online', () => { sync(); try { window.Layout.toast('عاد الاتصال', 'success'); } catch {} });
      window.addEventListener('offline', sync);
      sync();
    } catch {}
  }

  // P3 — Service Worker: كاش الأصول + offline للأقسام (يتخطى file://)
  function ensureSW() {
    try {
      if (!('serviceWorker' in navigator)) return;
      if (String(location.protocol || '') === 'file:') return;
      const swUrl = '/sw.js';
      navigator.serviceWorker.register(swUrl).catch(function () {});
    } catch {}
  }

  // P4 — وحدة UI المشتركة: تحميل تلقائي + ترقية التبويبات (ARIA/أسهم/رابط عميق) بدون لمس الصفحات
  function ensureUI() {
    try {
      if (window.UI && window.UI.Tabs) {
        try { window.UI.Tabs.enhanceAll(); } catch {}
        try { window.UI.Actions.bind(document); } catch {}
        return;
      }
    } catch {}
    if (document.querySelector('script[data-ui-lib]')) return;
    const s = document.createElement('script');
    s.src = base + 'shared/utils/ui.js?v=1';
    s.setAttribute('data-ui-lib', '1');
    s.defer = true;
    s.onload = function () {
      try { if (window.UI && window.UI.Tabs) window.UI.Tabs.enhanceAll(); } catch {}
      try { if (window.UI && window.UI.Actions) window.UI.Actions.bind(document); } catch {}
    };
    document.body.appendChild(s);
    // ترقية فورية احتياطية حتى قبل تحميل المكتبة: ARIA أساسية
    try {
      document.querySelectorAll('.tabs:not([data-ui-tabs])').forEach(function (el) {
        el.setAttribute('role', 'tablist');
      });
    } catch {}
  }

  // مصنف الأزرار الوظيفي: لون ثابت لكل وظيفة في كل الأقسام (btn-f-*) — يعمل على الموجود والديناميكي
  // الأولوية للأخص (فاتورة/شحن/دفع قبل عامة إضافة/حفظ) — يُستثنى nc-cards وبطاقات التنبيه
  var FN_RULES = [
    ['invoice', /فاتورة/],
    ['ship', /توصيل|شحن|تسليم/],
    ['pay', /تسجيل دفعة|تسجيل تحصيل|تحصيل|عربون|دفع لمورد|دفع زبون|قبض/],
    ['pay', /(^|[^\u0600-\u06FF])دفع([^\u0600-\u06FF]|$)/],
    ['view', /تفاصيل|عرض الكشف|عرض/],
    ['print', /طباعة/],
    ['export', /تصدير|إكسيل/],
    ['import', /استيراد/],
    ['copy', /نسخة|نسخ|استعادة|استرجاع/],
    ['refresh', /تحديث/],
    ['search', /بحث/],
    ['settings', /إعدادات|الإعدادات/],
    ['pin', /📌|تثبيت/],
    ['save', /حفظ|دخول|تأكيد|اعتماد|موافقة/],
    ['close', /✕|إغلاق/],
    ['cancel', /إلغاء/],
    ['delete', /حذف/],
    ['edit', /تعديل/],
    ['add', /إضافة|أضف|إنشاء|جديد/]
  ];
  function fnHasClass(el) {
    try {
      for (var i = 0; i < el.classList.length; i++) {
        if (el.classList[i].indexOf('btn-f-') === 0) return true;
      }
    } catch (e) {}
    return false;
  }
  function classifyBtn(el) {
    try {
      var t = String((el.textContent || '')).replace(/\s+/g, ' ').trim();
      if (!t) return null;
      if (t === '×') return 'delete';
      for (var i = 0; i < FN_RULES.length; i++) {
        if (FN_RULES[i][1].test(t)) return FN_RULES[i][0];
      }
    } catch (e) {}
    return null;
  }
  function paintFuncButtons(scope) {
    try {
      var els = (scope || document).querySelectorAll('button.btn, a.btn');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (fnHasClass(el)) continue;
        try {
          if (el.closest && el.closest('[data-nc],[data-hhint],.nc-tabs,.nc-float,.toast-stack')) continue;
        } catch (e) {}
        var fn = classifyBtn(el);
        if (fn) el.classList.add('btn-f-' + fn);
      }
    } catch (e) {}
  }
  window.Layout.fnRules = FN_RULES;
  window.Layout.classifyBtn = classifyBtn;
  window.Layout.paintFuncButtons = paintFuncButtons;
  // مراقبة خفيفة للعناصر المحقونة ديناميكياً (جداول/نوافذ) — مرة واحدة
  function ensureFuncWatch() {
    try {
      if (window.__fnObs || typeof MutationObserver === 'undefined') return;
      window.__fnObs = true;
      var pend = false;
      var obs = new MutationObserver(function () {
        if (pend) return;
        pend = true;
        setTimeout(function () { pend = false; try { paintFuncButtons(document); } catch (e) {} }, 120);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', function () {
    ensureHead(); upgradeSidebar(); injectTopbar(); ensureNavChrome(); ensureIcons(); enhanceTables(); ensureToast(); ensureOffline(); ensureUI(); injectFooter(); ensureClock(); loadConfig(); ensureNotifBell(); ensureUserSwitch(); ensureSW(); paintFuncButtons(document); ensureFuncWatch();
  });
})();
