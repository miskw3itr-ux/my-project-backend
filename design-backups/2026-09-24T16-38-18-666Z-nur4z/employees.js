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
  },

  // ---- حالة الموظف: بطاقة + حضور + كشوف وسلف وتسويات + دفتر مستحق + طباعة ----
  // الدفتر (المستحق الصافي للعامل: + له / − عليه): الكشوف المولدة استحقاق، والدفع والسلف المعلقة
  // والخصم تخفضه، والمكافأة والافتتاحي المستحق ترفعه — المسدد/المطبق داخل الكشوف لا يُفرد (منعاً للازدواج)
  workerActivity(worker_id, from, to) {
    const md = mdata();
    const w = getWorker(md, worker_id);
    const d = db.load();
    if (from) validDate(from, 'من');
    if (to) validDate(to, 'إلى');
    if (from && to && from > to) err('من أكبر من إلى', 400);
    const fromM = from ? from.slice(0, 7) : '';
    const toM = to ? to.slice(0, 7) : '';
    const inRange = dt => (!from || String(dt || '') >= from) && (!to || String(dt || '') <= to);
    const inMonthRange = m => (!fromM || String(m || '') >= fromM) && (!toM || String(m || '') <= toM);
    const p = d.profiles.find(x => x.worker_id === w.id) || null;
    const opening = r2(Number(w.opening_balance || 0));
    const openingEffect = opening !== 0 ? (w.opening_type === 'سلفة على العامل' ? -opening : opening) : 0;
    const pays = (d.payrolls || []).filter(x => x.worker_id === w.id);
    const consumedAdv = new Set();
    const consumedAdj = new Set();
    for (const pg of pays) {
      for (const aid of pg.advance_ids || []) consumedAdv.add(aid);
      for (const aid of pg.adj_ids || []) consumedAdj.add(aid);
    }
    const pendAdv = a => !a.settled_payroll && !consumedAdv.has(a.id);
    const pendAdj = a => !a.applied_payroll && !consumedAdj.has(a.id);
    const payDate = pg => String((pg.paid_at || '')).slice(0, 10);
    // السابق: كشوف الأشهر السابقة + مدفوعاتها + المعلق قبل الفترة + الافتتاحي إن كان أول كشف داخل/بعد الفترة
    let prev = 0, prevPay = 0, prevPaid = 0, prevAdv = 0, prevPen = 0, prevBon = 0, prevOpen = 0;
    if (from) {
      const hadBefore = pays.some(pg => String(pg.month || '') < fromM);
      for (const pg of pays) {
        if (String(pg.month || '') >= fromM) continue;
        prevPay = r2(prevPay + Number(pg.net || 0));
        if (pg.status === 'مدفوعة' && payDate(pg) < from) prevPaid = r2(prevPaid + Number(pg.net || 0));
      }
      for (const a of d.advances || []) {
        if (a.worker_id !== w.id || !pendAdv(a)) continue;
        if (String(a.date || '') < from) prevAdv = r2(prevAdv + Number(a.amount || 0));
      }
      for (const a of d.adjustments || []) {
        if (a.worker_id !== w.id || !pendAdj(a)) continue;
        if (String(a.date || '') < from) {
          if (a.kind === 'مكافأة') prevBon = r2(prevBon + Number(a.amount || 0));
          else prevPen = r2(prevPen + Number(a.amount || 0));
        }
      }
      if (!hadBefore) prevOpen = openingEffect;
      prev = r2(prevPay - prevPaid - prevAdv - prevPen + prevBon + prevOpen);
    }
    // سجل الفترة (أو كل النشاط): كشوف + دفع + سلف معلقة + تسويات معلقة + افتتاحي أولاً عند غياب الفترة
    const lines = [];
    if (!from && openingEffect !== 0) {
      lines.push({ date: '', kind: 'رصيد افتتاحي', ref: '', detail: w.opening_type || '', total: Math.abs(openingEffect), effect: openingEffect, _id: 'o0' });
    }
    for (const pg of pays) {
      if (!inMonthRange(pg.month)) continue;
      lines.push({
        date: String(pg.month || '') + '-01', kind: 'كشف راتب', ref: 'كشف ' + pg.month,
        detail: 'إجمالي ' + Number(pg.gross || 0) + ' − سلف ' + Number(pg.advances || 0) + ' − جزاء ' + Number(pg.penalty || 0) + ' + مكافأة ' + Number(pg.bonus || 0) + (Number(pg.opening_applied || 0) ? ' + افتتاحي ' + Number(pg.opening_applied) : '') + ' (' + pg.status + ')',
        total: r2(Number(pg.net || 0)), effect: r2(Number(pg.net || 0)), _id: 'p' + pg.id
      });
      if (pg.status === 'مدفوعة' && inRange(payDate(pg))) {
        lines.push({ date: payDate(pg), kind: 'دفع راتب', ref: 'كشف ' + pg.month, detail: (pg.paid_account || '') + (pg.paid_by ? ' — ' + pg.paid_by : ''), total: r2(Number(pg.net || 0)), effect: -r2(Number(pg.net || 0)), _id: 'y' + pg.id });
      }
    }
    for (const a of d.advances || []) {
      if (a.worker_id !== w.id || !pendAdv(a) || !inRange(a.date)) continue;
      lines.push({ date: a.date, kind: 'سلفة', ref: 'سلفة #' + a.id, detail: (a.account || '') + (a.reason ? ' — ' + a.reason : '') + ' (معلقة)', total: r2(Number(a.amount || 0)), effect: -r2(Number(a.amount || 0)), _id: 'a' + a.id });
    }
    for (const a of d.adjustments || []) {
      if (a.worker_id !== w.id || !pendAdj(a) || !inRange(a.date)) continue;
      const bon = a.kind === 'مكافأة';
      lines.push({ date: a.date, kind: a.kind, ref: (bon ? 'مكافأة' : 'خصم') + ' #' + a.id, detail: (a.reason || '') + ' (معلقة)', total: r2(Number(a.amount || 0)), effect: bon ? r2(Number(a.amount || 0)) : -r2(Number(a.amount || 0)), _id: 'j' + a.id });
    }
    lines.sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : (a._id < b._id ? -1 : 1)));
    let bal = prev, tPay = 0, tPaid = 0, tAdv = 0, tPen = 0, tBon = 0, tOpen = 0;
    for (const l of lines) {
      if (l.kind === 'رصيد افتتاحي') tOpen = r2(tOpen + l.effect);
      else if (l.kind === 'كشف راتب') tPay = r2(tPay + l.effect);
      else if (l.kind === 'دفع راتب') tPaid = r2(tPaid - l.effect);
      else if (l.kind === 'سلفة') tAdv = r2(tAdv - l.effect);
      else if (l.kind === 'خصم') tPen = r2(tPen - l.effect);
      else if (l.kind === 'مكافأة') tBon = r2(tBon + l.effect);
      bal = r2(bal + l.effect);
      l.balance = bal;
    }
    // الحضور داخل الفترة: عد per حالة + أيام مرجحة (حاضر=1 ونصف يوم=0.5)
    const att = { 'حاضر': 0, 'نصف يوم': 0, 'غائب': 0, 'إجازة': 0 };
    let weighted = 0;
    for (const a of d.attendance || []) {
      if (a.worker_id !== w.id || !inRange(a.date)) continue;
      if (att[a.status] === undefined) att[a.status] = 0;
      att[a.status]++;
      weighted = r2(weighted + attWeight(a.status));
    }
    return {
      data: {
        worker: {
          id: w.id, name: w.name, phone: w.phone || '', address: w.address || '',
          job: (p && p.job) || w.job || '', hire_date: (p && p.hire_date) || '',
          pay_type: (p && p.pay_type) || '', pay_amount: p ? Number(p.pay_amount || 0) : 0,
          opening_balance: opening, opening_type: w.opening_type || ''
        },
        from: from || '', to: to || '',
        prev: { payrolls: prevPay, paid: prevPaid, advances: prevAdv, penalty: prevPen, bonus: prevBon, opening: prevOpen, total: prev },
        lines,
        attendance: { ...att, weighted },
        payrolls: pays.filter(pg => inMonthRange(pg.month)).map(pg => ({ month: pg.month, gross: pg.gross, advances: pg.advances, penalty: pg.penalty, bonus: pg.bonus, opening_applied: pg.opening_applied, net: pg.net, status: pg.status, paid_account: pg.paid_account || '' })),
        totals: { opening: tOpen, payrolls: tPay, paid: tPaid, advances: tAdv, penalty: tPen, bonus: tBon, current: bal },
        generated_at: new Date().toISOString().slice(0, 16).replace('T', ' ')
      }
    };
  },
  // ---- ملخص كل العمال: مستحق سابق/حالي + مدفوعات + حضور + كشوف + افتتاحي + سلف ----
  // نفس دفتر workerActivity مطبقاً على كل عامل نشط (الفترة اختيارية)
  workersSummary(from, to) {
    const md = mdata();
    const d = db.load();
    if (from) validDate(from, 'من');
    if (to) validDate(to, 'إلى');
    if (from && to && from > to) err('من أكبر من إلى', 400);
    const fromM = from ? from.slice(0, 7) : '';
    const toM = to ? to.slice(0, 7) : '';
    const inRange = dt => (!from || String(dt || '') >= from) && (!to || String(dt || '') <= to);
    const inMonthRange = m => (!fromM || String(m || '') >= fromM) && (!toM || String(m || '') <= toM);
    const rows = [];
    for (const w of md.workers || []) {
      if (w.active === false) continue;
      const opening = r2(Number(w.opening_balance || 0));
      const openingEffect = opening !== 0 ? (w.opening_type === 'سلفة على العامل' ? -opening : opening) : 0;
      const pays = (d.payrolls || []).filter(x => x.worker_id === w.id);
      const consumedAdv = new Set();
      for (const pg of pays) for (const aid of pg.advance_ids || []) consumedAdv.add(aid);
      const pendAdv = a => !a.settled_payroll && !consumedAdv.has(a.id);
      const payDate = pg => String((pg.paid_at || '')).slice(0, 10);
      // السابق
      let prev = 0, prevPay = 0, prevPaid = 0, prevAdv = 0;
      if (from) {
        const hadBefore = pays.some(pg => String(pg.month || '') < fromM);
        for (const pg of pays) {
          if (String(pg.month || '') >= fromM) continue;
          prevPay = r2(prevPay + Number(pg.net || 0));
          if (pg.status === 'مدفوعة' && payDate(pg) < from) prevPaid = r2(prevPaid + Number(pg.net || 0));
        }
        for (const a of d.advances || []) {
          if (a.worker_id !== w.id || !pendAdv(a)) continue;
          if (String(a.date || '') < from) prevAdv = r2(prevAdv + Number(a.amount || 0));
        }
        prev = r2(prevPay - prevPaid - prevAdv + (!hadBefore ? openingEffect : 0));
      }
      // الفترة: كشوف + مدفوعات + سلف ممنوحة + حضور مرجح
      let inPay = 0, inPaid = 0, inAdv = 0, inCount = 0, weighted = 0, lastPayDate = '', lastPayAmt = 0;
      for (const pg of pays) {
        if (!inMonthRange(pg.month)) continue;
        inPay = r2(inPay + Number(pg.net || 0));
        inCount++;
        if (pg.status === 'مدفوعة' && inRange(payDate(pg))) {
          inPaid = r2(inPaid + Number(pg.net || 0));
          if (!lastPayDate || payDate(pg) >= lastPayDate) { lastPayDate = payDate(pg); lastPayAmt = r2(Number(pg.net || 0)); }
        }
      }
      for (const a of d.advances || []) {
        if (a.worker_id !== w.id || !inRange(a.date)) continue;
        inAdv = r2(inAdv + Number(a.amount || 0));
      }
      for (const a of d.attendance || []) {
        if (a.worker_id !== w.id || !inRange(a.date)) continue;
        weighted = r2(weighted + attWeight(a.status));
      }
      const p = (d.profiles || []).find(x => x.worker_id === w.id) || null;
      rows.push({
        worker_id: w.id, code: w.code || '', name: w.name, job: (p && p.job) || w.job || '',
        opening: openingEffect, prev, paid: inPaid, current: r2(prev + inPay - inPaid),
        attend_days: weighted, pay_count: inCount, advances: inAdv,
        last_pay_date: lastPayDate, last_pay_amount: lastPayAmt
      });
    }
    rows.sort((a, b) => b.current - a.current);
    const tot = rows.reduce((s, r) => ({ prev: r2(s.prev + r.prev), paid: r2(s.paid + r.paid), current: r2(s.current + r.current), att: r2(s.att + r.attend_days), adv: r2(s.adv + r.advances) }), { prev: 0, paid: 0, current: 0, att: 0, adv: 0 });
    return { data: { from: from || '', to: to || '', rows, totals: tot, generated_at: new Date().toISOString().slice(0, 16).replace('T', ' ') } };
  }
};

module.exports = Emp;
