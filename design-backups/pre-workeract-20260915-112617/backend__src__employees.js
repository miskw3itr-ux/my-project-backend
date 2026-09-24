// الموظفون: بطاقة ممتدة + حضور يومي + سلف + جزاءات/مكافآت + كشوف شهرية + دفع مربوط مالياً
// القواعد: شهري=أساسي−سلف−جزاء+مكافأة / يومي=حاضر×أجر−سلف−جزاء+مكافأة / الافتتاحي يُستوعب في أول كشف مدفوع
const jstore = require('./jstore');
const Auth = require('./auth');
const mstore = require('./store');
const Finance = require('./finance');

const db = jstore('employees.json', {
  seq: { profile: 1, att: 1, advance: 1, adj: 1, payroll: 1 },
  profiles: [], attendance: [], advances: [], adjustments: [], payrolls: []
});
const now = () => new Date().toISOString();
const r2 = n => Math.round(Number(n || 0) * 100) / 100;

function err(msg, code) { throw Object.assign(new Error(msg), { code: code || 400 }); }
function toNum(v, field) {
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim();
  if (s === '') return 0;
  s = s.replace(/[٠-٩]/g, ch => '٠١٢٣٤٥٦٧٨٩'.indexOf(ch))
       .replace(/[۰-۹]/g, ch => '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch))
       .replace(/[\s  ']/g, '').replace(/٬/g, '').replace(/[٫,]/g, '.');
  const parts = s.split('.');
  if (parts.length > 2) s = parts.shift() + '.' + parts.join('');
  const n = Number(s);
  if (!Number.isFinite(n)) err((field || 'الرقم') + ': رقم غير صالح');
  return n;
}
function validDate(v, field) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) err((field || 'التاريخ') + ': صيغة غير صحيحة (سنة-شهر-يوم)');
  return s;
}
// حالات الحضور + وزن اليوم (نصف اليوم = 0.5)
const ATT_STATUS = ['حاضر', 'نصف يوم', 'غائب', 'إجازة'];
function attWeight(s) { return s === 'حاضر' ? 1 : s === 'نصف يوم' ? 0.5 : 0; }
function mdata() { return mstore.load(); }
function getWorker(md, id) {
  const w = md.workers.find(x => x.id === Number(id));
  if (!w) err('العامل غير موجود في البيانات الأساسية');
  if (w.active === false) err('العامل موقف');
  return w;
}
function finAccount(name) {
  const accs = Finance.listAccounts().data;
  const a = accs.find(x => x.name === String(name || ''));
  if (!a) err('اختر حساب الدفع (الصندوق/البنك) — عرّفه في المالية أولاً');
  return a;
}

const Emp = {
  kpi(month) {
    const d = db.load();
    const md = mdata();
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : now().slice(0, 7);
    const active = (md.workers || []).filter(w => w.active !== false).length;
    const due = r2(d.payrolls.filter(p => p.month === m && p.status === 'مسودة').reduce((s, p) => s + Number(p.net || 0), 0));
    const adv = r2(d.advances.filter(a => !a.settled_payroll).reduce((s, a) => s + Number(a.amount || 0), 0));
    const abs = r2(d.attendance.filter(a => String(a.date).startsWith(m) && (a.status === 'غائب' || a.status === 'نصف يوم')).reduce((s, a) => s + (a.status === 'غائب' ? 1 : 0.5), 0));
    const last = d.payrolls.filter(p => p.status === 'مدفوعة').sort((a, b) => (String(a.paid_at || '') < String(b.paid_at || '') ? 1 : -1))[0];
    return { data: { month: m, active, due, advances: adv, absences: abs, lastPaid: last ? { worker: last.worker_name, amount: last.net, at: String(last.paid_at).slice(0, 10) } : null } };
  },

  // ---- البطاقات الممتدة ----
  listProfiles() {
    const d = db.load();
    const md = mdata();
    return {
      data: d.profiles.map(p => {
        const w = (md.workers || []).find(x => x.id === p.worker_id) || {};
        return { ...p, name: w.name || '—', phone: w.phone || '', job: w.job || p.job || '' };
      })
    };
  },
  saveProfile(b, ctx) {
    if (!Auth.can(ctx.role, 'employees', 'pay')) err('البطاقات: المدير أو المحاسب فقط', 403);
    const md = mdata();
    const w = getWorker(md, b.worker_id);
    if (b.pay_type !== 'شهري' && b.pay_type !== 'يومي') err('نوع الأجر: شهري أو يومي');
    const amount = toNum(b.pay_amount, 'الأجر');
    if (!(amount > 0)) err('الأجر أكبر من صفر');
    const d = db.load();
    let p = d.profiles.find(x => x.worker_id === w.id);
    if (!p) {
      p = { id: d.seq.profile++, worker_id: w.id };
      d.profiles.push(p);
    }
    p.job = String(b.job || w.job || '').trim();
    p.hire_date = b.hire_date ? validDate(b.hire_date, 'تاريخ التوظيف') : (p.hire_date || '');
    p.pay_type = b.pay_type; p.pay_amount = r2(amount);
    p.updated_at = now();
    db.save(d);
    return { data: p };
  },

  // ---- الحضور ----
  listAttendance(date) {
    const d = db.load();
    const rows = (date ? d.attendance.filter(a => a.date === date) : d.attendance).slice().sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 500);
    return { data: rows };
  },
  mark(b, ctx) {
    if (!Auth.can(ctx.role, 'employees', 'attend')) err('الحضور: المدير أو أمين المخزن فقط', 403);
    const md = mdata();
    getWorker(md, b.worker_id);
    const date = validDate(b.date, 'التاريخ');
    if (!ATT_STATUS.includes(b.status)) err('الحالة: ' + ATT_STATUS.join('/'));
    if (date.slice(0, 7) !== now().slice(0, 7)) err('التعديل في الشهر الجاري فقط');
    const d = db.load();
    let r = d.attendance.find(a => a.worker_id === Number(b.worker_id) && a.date === date);
    if (!r) {
      r = { id: d.seq.att++, worker_id: Number(b.worker_id), date };
      const w = md.workers.find(x => x.id === Number(b.worker_id));
      r.worker_name = w ? w.name : '';
      d.attendance.push(r);
    }
    r.status = b.status; r.by = ctx.user; r.at = now();
    db.save(d);
    return { data: r };
  },
  bulk(b, ctx) {
    if (!Auth.can(ctx.role, 'employees', 'attend')) err('الحضور: المدير أو أمين المخزن فقط', 403);
    const md = mdata();
    const date = validDate(b.date, 'التاريخ');
    if (date.slice(0, 7) !== now().slice(0, 7)) err('التعديل في الشهر الجاري فقط');
    const absent = new Set((b.absent_ids || []).map(Number));
    const d = db.load();
    let n = 0;
    for (const w of (md.workers || []).filter(x => x.active !== false)) {
      const st = absent.has(w.id) ? 'غائب' : 'حاضر';
      let r = d.attendance.find(a => a.worker_id === w.id && a.date === date);
      if (!r) { r = { id: d.seq.att++, worker_id: w.id, date, worker_name: w.name }; d.attendance.push(r); }
      r.status = st; r.by = ctx.user; r.at = now();
      n++;
    }
    db.save(d);
    return { data: { date, marked: n } };
  },

  // ---- السلف (خروج نقدي فوري + خصم لاحق) ----
  listAdvances() {
    const d = db.load();
    return { data: d.advances.slice().sort((a, b) => (a.id < b.id ? 1 : -1)) };
  },
  addAdvance(b, ctx) {
    if (!Auth.can(ctx.role, 'employees', 'pay')) err('السلف: المدير أو المحاسب فقط', 403);
    const md = mdata();
    const w = getWorker(md, b.worker_id);
    const amount = toNum(b.amount, 'المبلغ');
    if (!(amount > 0)) err('المبلغ أكبر من صفر');
    const acc = finAccount(b.account);
    const d = db.load();
    const row = {
      id: d.seq.advance++, worker_id: w.id, worker_name: w.name,
      date: validDate(b.date || now().slice(0, 10), 'التاريخ'),
      amount: r2(amount), account: acc.name, reason: String(b.reason || '').trim(),
      settled_payroll: null, by: ctx.user, created_at: now()
    };
    d.advances.push(row);
    const Fin = Finance;
    const exp = Fin.addExpense({ category: 'سلف', date: row.date, amount: row.amount, account: acc.name, note: 'سلفة #' + row.id + ' — ' + w.name + (row.reason ? ' — ' + row.reason : '') }, ctx);
    try { row.expense_id = exp && exp.data ? exp.data.id : (exp && exp.id ? exp.id : null); } catch (e) {}
    db.save(d);
    return { data: row };
  },
  deleteAdvance(id, ctx) {
    if (ctx.role !== 'admin') err('حذف السلفة للمدير فقط', 403);
    const d = db.load();
    const i = d.advances.findIndex(x => x.id === Number(id));
    if (i < 0) err('غير موجود', 404);
    if (d.advances[i].settled_payroll) err('مسددة في كشف — لا حذف');
    const gone = d.advances[i];
    // عكس مالي: حذف قيد المصروف المرتبط (أو قيد استرداد تعويضي للبيانات القديمة)
    try {
      const Fin = require('./finance');
      let reversed = false;
      if (gone.expense_id != null) {
        try { Fin.deleteExpense(Number(gone.expense_id), ctx); reversed = true; } catch (e) {}
      }
      if (!reversed) {
        try {
          const list = Fin.listExpenses().data || [];
          const hit = list.find(x => x.category === 'سلف' && String(x.note || '').includes('سلفة #' + gone.id));
          if (hit) { try { Fin.deleteExpense(hit.id, ctx); reversed = true; } catch (e) {} }
        } catch (e) {}
      }
      if (!reversed) {
        try { Fin.addIncome({ date: gone.date, amount: gone.amount, account: gone.account, note: 'استرداد سلفة محذوفة #' + gone.id + ' — ' + (gone.worker_name || '') }, ctx); } catch (e) {}
      }
    } catch (e) {}
    d.advances.splice(i, 1);
    db.save(d);
    return { ok: true };
  },

  // ---- جزاءات/مكافآت ----
  listAdjustments() {
    const d = db.load();
    return { data: d.adjustments.slice().sort((a, b) => (a.id < b.id ? 1 : -1)) };
  },
  addAdjustment(b, ctx) {
    if (!Auth.can(ctx.role, 'employees', 'pay')) err('الجزاءات: المدير أو المحاسب فقط', 403);
    const md = mdata();
    const w = getWorker(md, b.worker_id);
    if (b.kind !== 'خصم' && b.kind !== 'مكافأة') err('النوع: خصم أو مكافأة');
    const amount = toNum(b.amount, 'المبلغ');
    if (!(amount > 0)) err('المبلغ أكبر من صفر');
    const d = db.load();
    const row = {
      id: d.seq.adj++, worker_id: w.id, worker_name: w.name,
      date: validDate(b.date || now().slice(0, 10), 'التاريخ'),
      kind: b.kind, amount: r2(amount), reason: String(b.reason || '').trim(),
      applied_payroll: null, by: ctx.user, created_at: now()
    };
    d.adjustments.push(row);
    db.save(d);
    return { data: row };
  },
  deleteAdjustment(id, ctx) {
    if (!Auth.can(ctx.role, 'employees', 'pay')) err('الجزاءات: المدير أو المحاسب فقط', 403);
    const d = db.load();
    const i = d.adjustments.findIndex(x => x.id === Number(id));
    if (i < 0) err('غير موجود', 404);
    if (d.adjustments[i].applied_payroll) err('مطبقة في كشف مدفوع — لا حذف');
    d.adjustments.splice(i, 1);
    db.save(d);
    return { ok: true };
  },

  // ---- الكشوف ----
  _compute(d, md, worker_id, month) {
    const w = getWorker(md, worker_id);
    const p = d.profiles.find(x => x.worker_id === w.id);
    if (!p) err('لا بطاقة أجر لـ ' + w.name + ' — عرّفها أولاً');
    let gross;
    let present = null;
    if (p.pay_type === 'يومي') {
      present = r2(d.attendance.filter(a => a.worker_id === w.id && String(a.date).startsWith(month)).reduce((s, a) => s + attWeight(a.status), 0));
      gross = r2(present * Number(p.pay_amount || 0));
    } else {
      gross = r2(Number(p.pay_amount || 0));
    }
    const advs = d.advances.filter(a => a.worker_id === w.id && !a.settled_payroll);
    const advSum = r2(advs.reduce((s, a) => s + Number(a.amount || 0), 0));
    const adjs = d.adjustments.filter(a => a.worker_id === w.id && !a.applied_payroll && String(a.date).slice(0, 7) <= month);
    let bonus = 0, penalty = 0;
    for (const a of adjs) {
      if (a.kind === 'مكافأة') bonus = r2(bonus + Number(a.amount || 0));
      else penalty = r2(penalty + Number(a.amount || 0));
    }
    // استيعاب الافتتاحي في أول كشف فقط
    let openingApplied = 0;
    const hadPaid = d.payrolls.some(x => x.worker_id === w.id && x.status === 'مدفوعة');
    if (!hadPaid && Number(w.opening_balance || 0) !== 0) {
      openingApplied = w.opening_type === 'سلفة على العامل' ? -r2(Number(w.opening_balance)) : r2(Number(w.opening_balance));
    }
    const net = r2(gross - advSum - penalty + bonus + openingApplied);
    return {
      worker_id: w.id, worker_name: w.name, month,
      pay_type: p.pay_type, pay_amount: Number(p.pay_amount || 0), present_days: present,
      gross, advances: advSum, advance_ids: advs.map(a => a.id),
      penalty, bonus, adj_ids: adjs.map(a => a.id),
      opening_applied: openingApplied, net
    };
  },
  listPayrolls(month) {
    const d = db.load();
    const rows = (month ? d.payrolls.filter(p => p.month === month) : d.payrolls).slice().sort((a, b) => (a.id < b.id ? 1 : -1));
    return { data: rows };
  },
  generate(b, ctx) {
    if (!Auth.can(ctx.role, 'employees', 'pay')) err('الرواتب: المدير أو المحاسب فقط', 403);
    const month = validDate((b.month || now().slice(0, 10)) + '-01', 'الشهر').slice(0, 7);
    const md = mdata();
    const d = db.load();
    const ids = b.worker_id ? [Number(b.worker_id)] : (md.workers || []).filter(w => w.active !== false).map(w => w.id);
    const created = [], skipped = [];
    const wname = id => ((md.workers || []).find(w => w.id === id) || {}).name || ('#' + id);
    for (const id of ids) {
      if (d.payrolls.some(p => p.worker_id === id && p.month === month)) { skipped.push({ worker_id: id, worker_name: wname(id), reason: 'موجود مسبقاً' }); continue; }
      try {
        const c = this._compute(d, md, id, month);
        const row = { id: d.seq.payroll++, ...c, status: 'مسودة', by: ctx.user, created_at: now() };
        d.payrolls.push(row);
        created.push(row);
      } catch (e) { skipped.push({ worker_id: id, worker_name: wname(id), reason: e.message }); }
    }
    db.save(d);
    return { data: { created, skipped } };
  },
  deletePayroll(id, ctx) {
    if (!Auth.can(ctx.role, 'employees', 'pay')) err('الرواتب: المدير أو المحاسب فقط', 403);
    const d = db.load();
    const i = d.payrolls.findIndex(x => x.id === Number(id));
    if (i < 0) err('غير موجود', 404);
    if (d.payrolls[i].status !== 'مسودة') err('الحذف للمسودة فقط');
    d.payrolls.splice(i, 1);
    db.save(d);
    return { ok: true };
  },
  pay(id, b, ctx) {
    if (!Auth.can(ctx.role, 'employees', 'pay')) err('الدفع: المدير أو المحاسب فقط', 403);
    const d = db.load();
    const r = d.payrolls.find(x => x.id === Number(id));
    if (!r) err('غير موجود', 404);
    if (r.status !== 'مسودة') err('مدفوعة مسبقاً');
    if (!(Number(r.net || 0) > 0)) err('الصافي غير موجب (' + r.net + ') — راجع السلف والجزاءات أولاً');
    const acc = finAccount(b.account);
    // تثبيت التسويات على هذا الكشف
    for (const aid of r.advance_ids || []) {
      const a = d.advances.find(x => x.id === aid);
      if (a && !a.settled_payroll) a.settled_payroll = r.id;
    }
    for (const aid of r.adj_ids || []) {
      const a = d.adjustments.find(x => x.id === aid);
      if (a && !a.applied_payroll) a.applied_payroll = r.id;
    }
    Finance.addExpense({ category: 'رواتب', date: validDate(b.date || now().slice(0, 10), 'التاريخ'), amount: r.net, account: acc.name, note: 'راتب ' + r.month + ' — ' + r.worker_name }, ctx);
    r.status = 'مدفوعة'; r.paid_account = acc.name; r.paid_by = ctx.user; r.paid_at = now();
    db.save(d);
    return { data: r };
  }
};

module.exports = Emp;
