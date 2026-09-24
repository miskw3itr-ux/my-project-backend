// جرس التنبيهات الموحد - دار العلف
(function() {
  if (window.Notifications) return; // منع التحميل المتكرر

  window.Notifications = {
    data: [],
    loaded: false,
    loading: false,
    timer: null,

    // تحميل التنبيهات من الخادم
    async load() {
      if (this.loading) return;
      this.loading = true;
      try {
        const res = await fetch('/api/notifications', {
          headers: { 'Authorization': 'Bearer ' + localStorage.getItem('daralef_token') }
        });
        if (!res.ok) throw new Error('فشل تحميل التنبيهات');
        const json = await res.json();
        this.data = json.data || [];
        this.loaded = true;
        this.render();
      } catch (e) {
        console.error('Notifications error:', e);
        this.renderError();
      } finally {
        this.loading = false;
      }
    },

    // تحديث العداد
    updateCount() {
      const btn = document.querySelector('.notif-btn');
      if (!btn) return;

      const redCount = this.data.filter(n => n.type === 'danger').length;
      const yellowCount = this.data.filter(n => n.type === 'warning').length;
      const total = redCount + yellowCount;

      const countEl = btn.querySelector('.notif-count');
      if (countEl) {
        countEl.textContent = total || '';
        countEl.className = 'notif-count ' + (redCount > 0 ? 'is-red' : yellowCount > 0 ? 'is-yellow' : '');
        countEl.style.display = total > 0 ? 'inline-flex' : 'none';
      }

      const totalEl = document.querySelector('.notif-total');
      if (totalEl) totalEl.textContent = total;

      const lastUpdEl = document.getElementById('notifLastUpd');
      if (lastUpdEl) {
        const now = new Date();
        lastUpdEl.textContent = now.toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });
      }

      btn.classList.toggle('has-red', redCount > 0);
      btn.classList.toggle('has-new', total > 0);
    },

    // عرض التنبيهات
    render() {
      const panel = document.querySelector('.notif-panel');
      const body = panel?.querySelector('.notif-body');
      if (!panel || !body) return;

      this.updateCount();

      if (this.data.length === 0) {
        body.innerHTML = '<div class="notif-empty">لا توجد تنبيهات جديدة</div>';
        return;
      }

      // تجميع التنبيهات حسب النوع
      const groups = {
        danger: this.data.filter(n => n.type === 'danger'),
        warning: this.data.filter(n => n.type === 'warning'),
        info: this.data.filter(n => n.type === 'info')
      };

      let html = '';
      if (groups.danger.length > 0) {
        html += '<div class="notif-group">🔴 هام (' + groups.danger.length + ')</div>';
        html += groups.danger.map(n => this.renderItem(n, 'is-red')).join('');
      }
      if (groups.warning.length > 0) {
        html += '<div class="notif-group">🟡 تنبيه (' + groups.warning.length + ')</div>';
        html += groups.warning.map(n => this.renderItem(n, 'is-yellow')).join('');
      }
      if (groups.info.length > 0) {
        html += '<div class="notif-group">🔵 معلومات (' + groups.info.length + ')</div>';
        html += groups.info.map(n => this.renderItem(n, '')).join('');
      }

      body.innerHTML = html;
    },

    // عرض عنصر تنبيه واحد
    renderItem(n, extraClass) {
      const dot = n.type === 'danger' ? '🔴' : n.type === 'warning' ? '🟡' : '🔵';
      const sectionNames = {
        'proc': 'المشتريات',
        'sales': 'المبيعات',
        'inventory': 'المخزون',
        'production': 'الإنتاج',
        'finance': 'المالية',
        'quality': 'الجودة'
      };
      const sectionName = sectionNames[n.section] || n.section || 'عام';

      return '<a href="' + (n.link || '#') + '" class="notif-item ' + extraClass + '">' +
        '<span class="notif-dot">' + dot + '</span>' +
        '<span class="notif-text">' + n.message + '</span>' +
        '<span class="notif-sec">' + sectionName + '</span>' +
        '</a>';
    },

    // عرض حالة التحميل
    renderLoading() {
      const body = document.querySelector('.notif-body');
      if (body) body.innerHTML = '<div class="notif-loading">جاري التحميل...</div>';
    },

    // عرض الخطأ
    renderError() {
      const body = document.querySelector('.notif-body');
      if (body) {
        body.innerHTML = '<div class="notif-error">تعذر تحميل التنبيهات<br><button class="btn btn-primary btn-sm" onclick="Notifications.load()">إعادة المحاولة</button></div>';
      }
    },

    // تبديل القائمة
    toggle() {
      const panel = document.querySelector('.notif-panel');
      if (!panel) return;

      const isHidden = panel.hasAttribute('hidden');
      if (isHidden) {
        panel.removeAttribute('hidden');
        if (!this.loaded) {
          this.renderLoading();
          this.load();
        }
      } else {
        panel.setAttribute('hidden', '');
      }
    },

    // إغلاق القائمة
    close() {
      const panel = document.querySelector('.notif-panel');
      if (panel) panel.setAttribute('hidden', '');
    },

    // بدء التحديث التلقائي
    startAutoRefresh() {
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => this.load(), 60000); // تحديث كل دقيقة
    },

    // إيقاف التحديث التلقائي
    stopAutoRefresh() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  };

  // تهيئة عند تحميل الصفحة
  document.addEventListener('DOMContentLoaded', function() {
    const btn = document.querySelector('.notif-btn');
    if (btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        window.Notifications.toggle();
      });
    }

    const closeBtn = document.querySelector('.notif-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        window.Notifications.close();
      });
    }

    const refreshBtn = document.querySelector('.notif-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        window.Notifications.load();
      });
    }

    // إغلاق عند النقر خارج القائمة
    document.addEventListener('click', function() {
      window.Notifications.close();
    });

    // منع الإغلاق عند النقر داخل القائمة
    const panel = document.querySelector('.notif-panel');
    if (panel) {
      panel.addEventListener('click', function(e) {
        e.stopPropagation();
      });
    }

    // تحميل أولي وبدء التحديث التلقائي
    window.Notifications.load();
    window.Notifications.startAutoRefresh();
  });
})();
