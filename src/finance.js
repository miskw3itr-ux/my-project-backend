// مالية أولية: مستحقات الموردين من تأكيد المشتريات (يفصلها قسم المالية لاحقاً)
const jstore = require('./jstore');
const Auth = require('./auth');

const db = jstore('finance.json', { seq: { payable: 1, receivable: 1, account: 1, expense: 1, income: 1, transfer: 1 }, payables: [], receivables: [], accounts: [], expenses: [], incomes: [], transfers: [] });
const now = () => new Date().toISOString();
// الخزينة المركزية: الدفع من هذا الصندوق أو أي بنك فقط — الصناديق الفرعية للتحصيل والتجميع
const MAIN_FUND = 'صندوق دار العلف';
const EXP_CATS = ['كهرباء', 'إيجار', 'صيانة', 'وقود', 'أجور مؤقتة', 'رواتب', 'سلف', 'أخرى'];
// قائمة التصنيفات الحية من البيانات الأساسية (تبويب المصاريف) — الاحتياطية الصلبة عند الفراغ
function expCats() {
  try {
    const md = mdata();
    const list = (md.expcats || []).filter(c => c.active !== false).map(c => String(c.name || '').trim()).filter(Boolean);
    if (list.length) return list;
  } catch {}
  return EXP_CATS;
}
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
function prep(d) {
  if (!Array.isArray(d.accounts)) d.accounts = [];
  if (!Array.isArray(d.expenses)) d.expenses = [];
  if (!Array.isArray(d.incomes)) d.incomes = [];
  if (!Array.isArray(d.receivables)) d.receivables = [];
  if (!Array.isArray(d.transfers)) d.transfers = [];
  d.seq = d.seq || {};
  for (const k of ['payable', 'receivable', 'account', 'expense', 'income', 'transfer']) {
    if (!Number.isInteger(d.seq[k]) || d.seq[k] < 1) d.seq[k] = 1;
  }
  return d;
}
// ضمان وجود الصندوق المركزي (يُنشأ تلقائياً إن غاب — كما المخزنين الثابتين)
function ensureMainFund() {
  const d = prep(db.load());
  if (!d.accounts.some(a => a.name === MAIN_FUND)) {
    d.accounts.push({ id: d.seq.account++, name: MAIN_FUND, type: 'صندوق', opening: 0, opening_locked: false, opened_at: '', note: '', created_at: now() });
    db.save(d);
  }
  return d;
}
// الأرصدة الحية لكل الحسابات — مرجع واحد لقاعدة الدفع
// المصدر الوحيد هو الدفتر (يشمل قيود الافتتاح) — الافتتاحي لا يُجمع مرتين
function accountsWithBalances() {
  const d = prep(db.load());
  const J = buildJournal();
  return d.accounts.map(a => {
    let bal = 0;
    for (const e of J) {
      if (e.debit === a.name) bal = r2(bal + e.amount * e.sign);
      if (e.credit === a.name) bal = r2(bal - e.amount * e.sign);
    }
    return { ...a, balance: bal, is_main: a.name === MAIN_FUND };
  });
}
// قاعدة الدفع: المركزي أو بنك فقط + رصيد كافٍ (extra يُضاف للمتاح — يُستعمل عند تعديل قيد قائم)
function requireFunds(name, amount, extra) {
  ensureMainFund();
  const rows = accountsWithBalances();
  const a = rows.find(x => x.name === String(name || ''));
  if (!a) err('حساب الدفع غير موجود — عرّفه في المالية أولاً');
  if (a.name !== MAIN_FUND && a.type !== 'بنك') err('الدفع من «' + MAIN_FUND + '» المركزي أو البنك فقط — «' + a.name + '» صندوق فرعي للتحصيل (حوّل منه للمركزي أولاً)');
  const avail = r2(Number(a.balance || 0) + Number(extra || 0));
  if (avail < Number(amount || 0) - 1e-9) err('رصيد «' + a.name + '» غير كافٍ (المتاح ' + fmtDZD(avail) + ') — حوّل إليه من الصناديق أولاً');
  return a;
}
function fmtDZD(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0';
  return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function mdata() { return require('./store').load(); }
function pdata() { return require('./jstore')('procurement.json', { orders: [], deposits: [], confirmations: [] }).load(); }
function idata() { try { return require('./jstore')('inventory.json', { lots: [], movements: [] }).load(); } catch (e) { return { lots: [] }; } }
// قيمة المرفوضات لكل مورد (للحجب المالي): blocked_qty*التكلفة، أو الكمية*التكلفة للقديم
function rejectedBySupplier() {
  const map = {};
  try {
    for (const l of (idata().lots || [])) {
      if (l.qc_final !== 'مرفوضة') continue;
      const q = Number(l.blocked_qty ?? l.qty) || 0;
      const v = Math.round(q * Number(l.cost_per_unit || 0) * 100) / 100;
      if (!(v > 0)) continue;
      const key = l.supplier_id != null ? 'id:' + l.supplier_id : 'name:' + (l.supplier_name || '');
      map[key] = map[key] || { supplier_id: l.supplier_id != null ? l.supplier_id : null, supplier_name: l.supplier_name || '', value: 0 };
      map[key].value = Math.round((map[key].value + v) * 100) / 100;
    }
  } catch (e) {}
  return map;
}
function sdata() { return require('./jstore')('sales.json', { invoices: [], receipts: [], returns: [] }).load(); }
function resolveAccount(accounts, method) {
  const isCash = method === 'نقدي';
  const acc = accounts.find(a => isCash ? a.type === 'صندوق' : a.type === 'بنك');
  return acc || null;
}
function buildJournal() {
  const d = prep(db.load());
  const md = mdata();
  const pd = pdata();
  const sd = sdata();
  const E = [];
  const push = (date, doc, debit, credit, amount, note) => {
    amount = r2(amount);
    if (amount === 0) return;
    E.push({ date, doc, debit, credit, amount: Math.abs(amount), sign: amount < 0 ? -1 : 1, note: note || '' });
  };
  for (const a of d.accounts) {
    if (Number(a.opening || 0)) push(String(a.opened_at || a.created_at).slice(0, 10), 'افتتاحي', a.name, 'رأس المال', Number(a.opening), 'رصيد افتتاحي');
  }
  for (const s of md.suppliers || []) {
    if (Number(s.opening_debt || 0)) push('افتتاحي', 'افتتاحي', 'رأس المال', 'الموردون: ' + s.name, Number(s.opening_debt), 'دين افتتاحي');
  }
  for (const c of md.customers || []) {
    if (Number(c.opening_debt || 0)) push('افتتاحي', 'افتتاحي', 'الزبائن: ' + c.name, 'رأس المال', Number(c.opening_debt), 'دين افتتاحي');
  }
  const accs = d.accounts;
  for (const c of pd.confirmations || []) {
    if (Number(c.payable || 0) > 0) push(c.arrival_date, c.order_num, 'المشتريات/المخزون', 'الموردون: ' + c.supplier_name, Number(c.payable), 'تأكيد استلام');
    else if (Number(c.payable || 0) < 0) push(c.arrival_date, c.order_num, 'الموردون: ' + c.supplier_name, 'المشتريات/المخزون', Number(c.payable), 'رصيد دائن');
  }
  // عكس الرفض المخبري: قيد دائن يُخفض دين المورد (مكمل لقيد payable السالب في payables)
  try {
    for (const l of (idata().lots || [])) {
      if (l.qc_final !== 'مرفوضة') continue;
      const q = Number(l.blocked_qty ?? l.qty) || 0;
      const v = Math.round(q * Number(l.cost_per_unit || 0) * 100) / 100;
      if (!(v > 0)) continue;
      push(String(l.blocked_at || now()).slice(0, 10), l.order_num || l.lot_no, 'الموردون: ' + (l.supplier_name || ''), 'المشتريات/المخزون', -v, 'عكس رفض جودة ' + l.lot_no);
    }
  } catch (e) {}
  for (const x of pd.deposits || []) {
    if (x.method === 'مؤخر') continue;
    // الحساب المخزن أولاً (الدفعات المستقلة + الجديد)، ثم التخمين القديم للعربونات السابقة
    const stored = (d.accounts || []).find(a => a.name === x.account);
    const a = stored || resolveAccount(accs, x.method);
    const isStand = x.order_id == null;
    push(x.date, x.order_num || x.num || 'دفعة', 'الموردون: ' + x.supplier_name, a ? a.name : x.method, Number(x.amount), (isStand ? 'دفعة مستقلة ' : 'عربون ') + x.method);
  }
  for (const o of sd.invoices || []) {
    if (o.status !== 'مؤكدة') continue;
    push(o.date, o.num, 'الزبائن: ' + o.customer_name, 'الإيرادات', Number(o.total), 'فاتورة بيع');
  }
  for (const x of sd.receipts || []) {
    const stored = (d.accounts || []).find(a => a.name === x.account);
    const a = stored || resolveAccount(accs, x.method);
    push(x.date, x.invoice_num || x.num || 'تحصيل', a ? a.name : x.method, 'الزبائن: ' + x.customer_name, Number(x.amount), 'تحصيل ' + x.method + (x.pay_type ? ' — ' + x.pay_type : ''));
  }
  for (const rt of sd.returns || []) {
    const inv = (sd.invoices || []).find(o => o.id === rt.invoice_id);
    let val = 0;
    for (const l of rt.lines || []) {
      const ol = inv ? inv.lines.find(x => x.item_id === l.item_id) : null;
      val = r2(val + Number(l.qty || 0) * Number(ol ? ol.price : 0));
    }
    if (val > 0) push(rt.date, rt.num, 'المرتجعات', 'الزبائن: ' + rt.customer_name, val, 'مرتجع ' + rt.reason);
  }
  for (const x of d.expenses || []) push(x.date, 'مصروف', 'مصاريف: ' + x.category, x.account, Number(x.amount), x.note || '');
  for (const x of d.incomes || []) push(x.date, 'إيراد', x.account, 'إيرادات أخرى', Number(x.amount), x.note || '');
  // التحويلات الداخلية: خروج من المصدر ودخول للوجهة (تحرك الأرصدة الحية تلقائياً)
  for (const t of d.transfers || []) push(t.date, t.num, t.to_account, t.from_account, Number(t.amount), 'تحويل' + (t.note ? ' — ' + t.note : ''));
  E.sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  return E.map((e, i) => ({ id: i + 1, ...e }));
}

const Finance = {
  // مبلغ موجب = مستحق علينا، سالب = دائن للمورد، صفر = مسواة
  addPayable(o) {
    const d = db.load();
    const amount = Math.round(Number(o.amount || 0) * 100) / 100;
    const row = {
      id: d.seq.payable++,
      order_id: o.order_id, order_num: o.order_num,
      supplier_id: o.supplier_id, supplier_name: o.supplier_name,
      amount, settled: 0,
      status: amount > 0 ? 'مستحق' : amount < 0 ? 'دائن' : 'مسواة',
      date: o.date || now().slice(0, 10), note: o.note || '',
      created_at: now()
    };
    d.payables.push(row);
    db.save(d);
    return row;
  },
  list() {
    const d = db.load();
    if (!Array.isArray(d.receivables)) d.receivables = [];
    if (!d.seq || !Number.isInteger(d.seq.receivable)) { d.seq = d.seq || {}; d.seq.receivable = 1; }
    return { data: d.payables.slice().sort((a, b) => (a.id < b.id ? 1 : -1)) };
  },
  // مستحق لنا من زبون (موجب) — يُخفض بالتحصيل والمرتجع
  addReceivable(o) {
    const d = db.load();
    if (!Array.isArray(d.receivables)) d.receivables = [];
    if (!d.seq || !Number.isInteger(d.seq.receivable)) { d.seq = d.seq || {}; d.seq.receivable = 1; }
    const amount = Math.round(Number(o.amount || 0) * 100) / 100;
    const row = {
      id: d.seq.receivable++,
      invoice_id: o.invoice_id, invoice_num: o.invoice_num,
      customer_id: o.customer_id, customer_name: o.customer_name,
      amount, settled: 0,
      status: amount > 0 ? 'مستحق' : 'مسواة',
      date: o.date || now().slice(0, 10), note: o.note || '',
      created_at: now()
    };
    d.receivables.push(row);
    db.save(d);
    return row;
  },
  // ---- الحسابات النقدية: تعريف + رصيد افتتاحي مرة واحدة مقفل ----
  listAccounts() {
    const d = prep(db.load());
    // ترميم: كود ثابت لكل حساب (ACC برقم المعرف — مستقر ولا يستهلك عداداً) + ملاحظة افتراضية
    let touched = false;
    for (const a of d.accounts || []) {
      if (!a.code) { a.code = 'ACC-' + String(a.id).padStart(3, '0'); touched = true; }
      if (a.note === undefined) { a.note = ''; touched = true; }
    }
    if (touched) db.save(d);
    return { data: accountsWithBalances() };
  },
  addAccount(b, ctx) {
    if (!Auth.can(ctx.role, 'finance', 'account')) err('الحسابات: المدير أو المحاسب فقط', 403);
    const name = String(b.name || '').trim();
    if (!name) err('اسم الحساب مطلوب (مثال: صندوق، بنك BNA)');
    if (b.type !== 'صندوق' && b.type !== 'بنك') err('النوع: صندوق أو بنك');
    const note = String(b.note || '').trim().slice(0, 200);
    const d = prep(db.load());
    if (d.accounts.some(a => a.name === name)) err('الحساب موجود مسبقاً');
    const row = { id: d.seq.account++, code: '', name, type: b.type, opening: 0, opening_locked: false, opened_at: '', note, created_at: now() };
    row.code = 'ACC-' + String(row.id).padStart(3, '0');
    // مبلغ افتتاحي اختياري مع الإنشاء (مرة واحدة ويُقفل — كإدخاله اللاحق)
    if (b.opening !== undefined && b.opening !== null && String(b.opening).trim() !== '') {
      const amt = toNum(b.opening, 'المبلغ الافتتاحي');
      if (amt < 0) err('المبلغ الافتتاحي لا يكون سالباً');
      if (amt > 0) { row.opening = r2(amt); row.opening_locked = true; row.opened_at = now().slice(0, 10); }
    }
    d.accounts.push(row);
    db.save(d);
    return { data: row };
  },
  // تعديل بيانات العرض فقط (ملاحظة) — الاسم والنوع والكود ثابتة لأن الدفتر يربط بالاسم
  updateAccount(id, b, ctx) {
    if (!Auth.can(ctx.role, 'finance', 'account')) err('الحسابات: المدير أو المحاسب فقط', 403);
    const d = prep(db.load());
    const a = d.accounts.find(x => x.id === Number(id));
    if (!a) err('الحساب غير موجود', 404);
    if (b.note !== undefined) a.note = String(b.note || '').trim().slice(0, 200);
    db.save(d);
    return { data: a };
  },
  setOpening(id, b, ctx) {
    if (!Auth.can(ctx.role, 'finance', 'account')) err('الحسابات: المدير أو المحاسب فقط', 403);
    const d = prep(db.load());
    const a = d.accounts.find(x => x.id === Number(id));
    if (!a) err('الحساب غير موجود', 404);
    if (a.opening_locked) {
      // التصحيح للمدير العام فقط: بوابة المسار (finance.account) تمنع مدير المخزون أصلاً،
      // والمحاسب يملك الإدخال الأول فقط — الفحص الصريح هنا دفاع إضافي
      if (ctx.role !== 'admin' && ctx.role !== 'storekeeper') err('الرصيد الافتتاحي مقفل بعد الإدخال — التصحيح للمدير العام فقط', 403);
      const amt2 = toNum(b.amount, 'الرصيد الافتتاحي');
      if (amt2 < 0) err('الرصيد الافتتاحي لا يكون سالباً');
      a.opening = r2(amt2);
      db.save(d);
      return { data: a };
    }
    const amt = toNum(b.amount, 'الرصيد الافتتاحي');
    if (amt < 0) err('الرصيد الافتتاحي لا يكون سالباً');
    a.opening = r2(amt); a.opening_locked = true; a.opened_at = now().slice(0, 10);
    db.save(d);
    return { data: a };
  },
  deleteAccount(id, ctx) {
    if (ctx.role !== 'admin') err('حذف الحساب للمدير فقط', 403);
    const d = prep(db.load());
    const i = d.accounts.findIndex(x => x.id === Number(id));
    if (i < 0) err('الحساب غير موجود', 404);
    if (d.accounts[i].name === MAIN_FUND) err('الصندوق المركزي لا يُحذف أبداً');
    const nm = d.accounts[i].name;
    if (buildJournal().some(e => e.debit === nm || e.credit === nm)) err('ممنوع الحذف: للحساب حركات مسجلة');
    d.accounts.splice(i, 1);
    db.save(d);
    return { ok: true };
  },
  // ---- المصاريف العامة (الإدخال اليدوي الوحيد) ----
  listExpenses() {
    const d = prep(db.load());
    return { data: d.expenses.slice().sort((a, b) => (a.id < b.id ? 1 : -1)) };
  },
  addExpense(b, ctx) {
    if (!Auth.can(ctx.role, 'finance', 'expense')) err('المصاريف: المدير أو المحاسب فقط', 403);
    if (!expCats().includes(b.category)) err('التصنيف: ' + expCats().join(' / '));
    const d = prep(db.load());
    const acc = d.accounts.find(a => a.name === String(b.account || ''));
    if (!acc) err('اختر حساب الدفع (الصندوق/البنك) — عرّفه أولاً');
    const amount = toNum(b.amount, 'المبلغ');
    if (!(amount > 0)) err('المبلغ أكبر من صفر');
    requireFunds(acc.name, amount);
    const row = {
      id: d.seq.expense++, category: b.category, date: validDate(b.date || now().slice(0, 10), 'التاريخ'),
      amount: r2(amount), account: acc.name, note: String(b.note || '').trim().slice(0, 200),
      by: ctx.user, created_at: now()
    };
    d.expenses.push(row);
    db.save(d);
    return { data: row };
  },
  updateExpense(id, b, ctx) {
    if (!Auth.can(ctx.role, 'finance', 'expense')) err('المصاريف: المدير أو المحاسب فقط', 403);
    const d = prep(db.load());
    const r = d.expenses.find(x => x.id === Number(id));
    if (!r) err('غير موجود', 404);
    const oldAcc = r.account, oldAmt = Number(r.amount || 0);
    if (b.category !== undefined) {
      if (!expCats().includes(b.category)) err('التصنيف: ' + expCats().join(' / '));
      r.category = b.category;
    }
    if (b.date !== undefined) r.date = validDate(b.date, 'التاريخ');
    if (b.amount !== undefined) {
      const a = toNum(b.amount, 'المبلغ');
      if (!(a > 0)) err('المبلغ أكبر من صفر');
      r.amount = r2(a);
    }
    if (b.account !== undefined) {
      const acc = d.accounts.find(a => a.name === String(b.account));
      if (!acc) err('الحساب غير موجود');
      r.account = acc.name;
    }
    if (b.note !== undefined) r.note = String(b.note || '').trim().slice(0, 200);
    // إعادة التحقق بعد التعديل: الدافع المركزي/بنك + الكفاية (القديم يُعاد حسابه)
    if (!(r.amount > 0)) err('المبلغ أكبر من صفر');
    requireFunds(r.account, r.amount, (r.account === oldAcc ? oldAmt : 0));
    db.save(d);
    return { data: r };
  },
  deleteExpense(id, ctx) {
    if (ctx.role !== 'admin') err('حذف المصروف للمدير فقط', 403);
    const d = prep(db.load());
    const i = d.expenses.findIndex(x => x.id === Number(id));
    if (i < 0) err('غير موجود', 404);
    d.expenses.splice(i, 1);
    db.save(d);
    return { ok: true };
  },
  // ---- التحويلات الداخلية: تجميع الصناديق في المركزي، ومن المركزي للبنك ----
  listTransfers() {
    const d = prep(db.load());
    return { data: (d.transfers || []).slice().sort((a, b) => (a.id < b.id ? 1 : -1)) };
  },
  addTransfer(b, ctx) {
    // موحد مع بوابة المسار (finance.account): التحويل حركة بين الحسابات لا مصروفاً
    if (!Auth.can(ctx.role, 'finance', 'account')) err('التحويلات: المدير أو المحاسب فقط', 403);
    ensureMainFund();
    const d = prep(db.load());
    const from = d.accounts.find(a => a.name === String(b.from_account || '').trim());
    const to = d.accounts.find(a => a.name === String(b.to_account || '').trim());
    if (!from || !to) err('حساب المصدر والوجهة مطلوبان (موجودان)');
    if (from.name === to.name) err('المصدر والوجهة مختلفان إجبارياً');
    // الاتجاهان المسموحان فقط: فرعي ← مركزي، مركزي ← بنك
    const toMain = to.name === MAIN_FUND;
    const fromMainToBank = from.name === MAIN_FUND && to.type === 'بنك';
    if (!toMain && !fromMainToBank) err('المسموح: من أي صندوق إلى «' + MAIN_FUND + '»، أو من المركزي إلى بنك');
    const amount = toNum(b.amount, 'المبلغ');
    if (!(amount > 0)) err('المبلغ أكبر من صفر');
    // التحويل حركة خزينة لا دفع: يُفحص رصيد المصدر فقط (الاتجاه مفروض أعلاه)
    const rows = accountsWithBalances();
    const src = rows.find(x => x.name === from.name);
    if (!src || Number(src.balance || 0) < Number(amount || 0) - 1e-9) {
      err('رصيد «' + from.name + '» غير كافٍ للتحويل (المتاح ' + fmtDZD(src ? src.balance : 0) + ')');
    }
    const row = {
      id: d.seq.transfer,
      num: 'TF-' + String(new Date().getFullYear()) + '-' + String(d.seq.transfer).padStart(3, '0'),
      date: validDate(b.date || now().slice(0, 10), 'التاريخ'),
      from_account: from.name, to_account: to.name,
      amount: r2(amount), note: String(b.note || '').trim().slice(0, 200),
      by: ctx.user, created_at: now()
    };
    d.seq.transfer++;
    d.transfers.push(row);
    db.save(d);
    return { data: row };
  },
  deleteTransfer(id, ctx) {
    if (ctx.role !== 'admin') err('حذف التحويل للمدير فقط', 403);
    const d = prep(db.load());
    const i = (d.transfers || []).findIndex(x => x.id === Number(id));
    if (i < 0) err('غير موجود', 404);
    d.transfers.splice(i, 1);
    db.save(d);
    return { ok: true };
  },
  // ---- إيرادات أخرى ----
  listIncomes() {
    const d = prep(db.load());
    return { data: d.incomes.slice().sort((a, b) => (a.id < b.id ? 1 : -1)) };
  },
  addIncome(b, ctx) {
    if (!Auth.can(ctx.role, 'finance', 'income')) err('الإيرادات: المدير أو المحاسب فقط', 403);
    const d = prep(db.load());
    const acc = d.accounts.find(a => a.name === String(b.account || ''));
    if (!acc) err('اختر حساب القبض — عرّفه أولاً');
    const amount = toNum(b.amount, 'المبلغ');
    if (!(amount > 0)) err('المبلغ أكبر من صفر');
    const row = {
      id: d.seq.income++, date: validDate(b.date || now().slice(0, 10), 'التاريخ'),
      amount: r2(amount), account: acc.name, note: String(b.note || '').trim().slice(0, 200),
      by: ctx.user, created_at: now()
    };
    d.incomes.push(row);
    db.save(d);
    return { data: row };
  },
  deleteIncome(id, ctx) {
    if (ctx.role !== 'admin') err('الحذف للمدير فقط', 403);
    const d = prep(db.load());
    const i = d.incomes.findIndex(x => x.id === Number(id));
    if (i < 0) err('غير موجود', 404);
    d.incomes.splice(i, 1);
    db.save(d);
    return { ok: true };
  },
  // ---- الدفتر والديون والأرباح والميزان ----
  journal(from, to) {
    let rows = buildJournal();
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) rows = rows.filter(e => String(e.date) >= from);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) rows = rows.filter(e => String(e.date) <= to);
    return { data: rows };
  },
  debts() {
    const d = prep(db.load());
    const md = mdata();
    const pd = pdata();
    const sd = sdata();
    const suppliers = (md.suppliers || []).map(s => {
      const pay = r2((pd.confirmations || []).filter(c => c.supplier_id === s.id).reduce((a, c) => a + Number(c.payable || 0), 0));
      const cash = r2((pd.deposits || []).filter(x => x.supplier_id === s.id && ['نقدي', 'تحويل بنكي', 'شيك'].includes(x.method)).reduce((a, x) => a + Number(x.amount || 0), 0));
      const rejMap = rejectedBySupplier();
      const rej = r2((rejMap['id:' + s.id] ? rejMap['id:' + s.id].value : 0) + (rejMap['name:' + s.name] && rejMap['name:' + s.name].supplier_id == null ? rejMap['name:' + s.name].value : 0));
      return { id: s.id, name: s.name, phone: s.phone || '', opening: r2(Number(s.opening_debt || 0)), confirmed: pay, paid: cash, rejected: rej, net: r2(Number(s.opening_debt || 0) + pay - cash - rej) };
    });
    const customers = (md.customers || []).map(c => {
      const inv = (sd.invoices || []).filter(o => o.customer_id === c.id && o.status === 'مؤكدة');
      let tot = 0, paid = 0, ret = 0;
      for (const o of inv) {
        tot = r2(tot + Number(o.total || 0));
        paid = r2(paid + (sd.receipts || []).filter(x => x.invoice_id === o.id).reduce((a, x) => a + Number(x.amount || 0), 0));
        for (const rt of (sd.returns || []).filter(x => x.invoice_id === o.id)) {
          for (const l of rt.lines || []) {
            const ol = o.lines.find(y => y.item_id === l.item_id);
            ret = r2(ret + Number(l.qty || 0) * Number(ol ? ol.price : 0));
          }
        }
      }
      // التحصيلات المستقلة (بلا فاتورة): تنقص الدين العام للزبون
      paid = r2(paid + (sd.receipts || []).filter(x => x.customer_id === c.id && x.invoice_id == null && x.method !== 'مؤخر').reduce((a, x) => a + Number(x.amount || 0), 0));
      return { id: c.id, name: c.name, phone: c.phone || '', opening: r2(Number(c.opening_debt || 0)), invoiced: tot, paid, returns: ret, net: r2(Number(c.opening_debt || 0) + tot - paid - ret) };
    });
    const workers = (md.workers || []).map(w => ({ id: w.id, name: w.name, opening: r2(Number(w.opening_balance || 0)), type: w.opening_type || '' }));
    return { data: { suppliers, customers, workers } };
  },
  pnl(month) {
    const d = prep(db.load());
    const sd = sdata();
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : now().slice(0, 7);
    let revenue = 0, cogs = 0;
    for (const o of sd.invoices || []) {
      if (o.status !== 'مؤكدة' || !String(o.date).startsWith(m)) continue;
      revenue = r2(revenue + Number(o.total || 0));
      for (const l of o.lines || []) cogs = r2(cogs + Number(l.qty || 0) * Number(l.cost_snapshot || 0));
    }
    for (const rt of sd.returns || []) {
      if (!String(rt.date).startsWith(m)) continue;
      const inv = (sd.invoices || []).find(o => o.id === rt.invoice_id);
      for (const l of rt.lines || []) {
        const ol = inv ? inv.lines.find(x => x.item_id === l.item_id) : null;
        const c = Number(ol && ol.cost_snapshot != null ? ol.cost_snapshot : 0);
        revenue = r2(revenue - Number(l.qty || 0) * Number(ol ? ol.price : 0));
        cogs = r2(cogs - Number(l.qty || 0) * c);
      }
    }
    for (const x of d.incomes || []) {
      if (String(x.date).startsWith(m)) revenue = r2(revenue + Number(x.amount || 0));
    }
    const expenses = r2((d.expenses || []).filter(x => String(x.date).startsWith(m)).reduce((s, x) => s + Number(x.amount || 0), 0));
    const byCat = {};
    for (const x of d.expenses || []) {
      if (!String(x.date).startsWith(m)) continue;
      byCat[x.category] = r2((byCat[x.category] || 0) + Number(x.amount || 0));
    }
    return { data: { month: m, revenue, cogs, gross: r2(revenue - cogs), expenses, byCat, salaries: 0, salariesNote: 'حتى بناء قسم الموظفين', net: r2(revenue - cogs - expenses) } };
  },
  trial(from, to) {
    let rows = buildJournal();
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) rows = rows.filter(e => String(e.date) >= from);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) rows = rows.filter(e => String(e.date) <= to);
    const acc = {};
    let td = 0, tc = 0;
    for (const e of rows) {
      acc[e.debit] = acc[e.debit] || { account: e.debit, debit: 0, credit: 0 };
      acc[e.credit] = acc[e.credit] || { account: e.credit, debit: 0, credit: 0 };
      acc[e.debit].debit = r2(acc[e.debit].debit + e.amount);
      acc[e.credit].credit = r2(acc[e.credit].credit + e.amount);
      td = r2(td + e.amount); tc = r2(tc + e.amount);
    }
    // اكتمال الميزان: كل حساب نقدي يظهر بسطر حتى بلا قيود (رصيده الحي صفر — يطابق /finance/accounts)
    try {
      const allAccs = prep(db.load()).accounts || [];
      for (const a of allAccs) {
        if (!acc[a.name]) acc[a.name] = { account: a.name, debit: 0, credit: 0 };
      }
    } catch {}
    return {
      data: {
        rows: Object.values(acc).map(a => ({ ...a, balance: r2(a.debit - a.credit) })).sort((a, b) => (a.account < b.account ? -1 : 1)),
        totalDebit: td, totalCredit: tc, balanced: td === tc
      }
    };
  },
  compare() {
    const out = [];
    const t = now().slice(0, 7);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(t + '-01T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() - i);
      const m = d.toISOString().slice(0, 7);
      const p = this.pnl(m).data;
      out.push({ month: m, revenue: p.revenue, cogs: p.cogs, expenses: p.expenses, net: p.net });
    }
    return { data: out };
  },
  kpi(month) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : now().slice(0, 7);
    const accs = this.listAccounts().data;
    const cash = r2(accs.reduce((s, a) => s + Number(a.balance || 0), 0));
    const dbt = this.debts().data;
    const pay = r2(dbt.suppliers.reduce((s, x) => s + Math.max(0, x.net), 0));
    const rec = r2(dbt.customers.reduce((s, x) => s + Math.max(0, x.net), 0));
    const p = this.pnl(m).data;
    return { data: { month: m, cash, payables: pay, receivables: rec, expenses: p.expenses, net: p.net, accounts: accs.length } };
  },
  listReceivables() {
    const d = db.load();
    return { data: (d.receivables || []).slice().sort((a, b) => (a.id < b.id ? 1 : -1)) };
  }
};

module.exports = Finance;
