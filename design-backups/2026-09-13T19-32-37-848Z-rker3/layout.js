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

  function injectTopbar() {
    if (document.querySelector('.topbar')) return;
    const main = document.querySelector('main.content');
    if (!main) return;
    const s = document.currentScript;
    const title = (s && s.getAttribute('data-title')) || document.querySelector('main h1')?.textContent?.trim() || 'دار العلف';
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

  // تنسيق الأسعار الافتراضي: الرقم كما هو + دج (بدون تجميع ولا أصفار عشرية)
  // مثال: 4250 -> "4250 دج" — معيار كل الأقسام
  function fmtDZD(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    x = Math.round(x * 100) / 100;
    return String(x) + ' دج';
  }

  // مكون KPI جاهز لكل الصفحات: Layout.kpi({icon,label,value,trend,trendText})
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
      if (/معتمد|مقبول|رابح|سليم|نشط|مدفوع/i.test(s)) return this.badge(s, 'success');
      if (/قيد|فحص|انتظار|مسودة/i.test(s)) return this.badge(s, 'warning');
      if (/مرفوض|خاسر|ناقص|منتهي|متجاوز/i.test(s)) return this.badge(s, 'danger');
      if (/معلومة|مالي|إنتاج/i.test(s)) return this.badge(s, 'info');
      return this.badge(s, 'neutral');
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    ensureHead(); upgradeSidebar(); injectTopbar(); injectFooter();
  });
})();
