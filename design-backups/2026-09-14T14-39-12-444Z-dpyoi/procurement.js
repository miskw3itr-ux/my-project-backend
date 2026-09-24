// المشتريات: طلبية BC ← موافقة المدير ← عربون ← تأكيد بلوتات ومستحق
// القواعد: لا أثر مخزني/مالي قبل التأكيد + المؤخر لا يخصم + الجزئي يبقى مفتوحاً
const jstore = require('./jstore');
const System = require('./system');
const Auth = require('./auth');
const mstore = require('./store');
const Master = require('./master');
const Stock = require('./stock');
const Finance = require('./finance');

const db = jstore('procurement.json', {
  seq: { order: 1, order_num: 1, deposit: 1, confirmation: 1, audit: 1 },
  orders: [], deposits: [], confirmations: [], audit: []
});
const now = () => new Date().toISOString();
const r2 = n => Math.round(Number(n || 0) * 100) / 100;

const METHODS = ['نقدي', 'تحويل بنكي', 'شيك', 'مؤخر'];
const CASH_METHODS = ['نقدي', 'تحويل بنكي', 'شيك']; // المؤخر وعد لا يخصم

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
function audit(d, action, ref_id, by, role) {
  d.audit.push({ id: d.seq.audit++, action, ref_id, by: by || 'admin', role: role || 'admin', at: now() });
  if (d.audit.length > 500) d.audit = d.audit.slice(-500);
}
function mdata() { return mstore.load(); }
function getSupplier(md, id) {
  const s = md.suppliers.find(x => x.id === Number(id));
  if (!s) err('المورد غير موجود في البيانات الأساسية');
  if (s.active === false) err('المورد موقف — فعّله من البيانات الأساسية أولاً');
  return s;
}
function getItem(md, id) {
  const it = md.items.find(x => x.id === Number(id));
  if (!it) err('المادة غير موجودة في البيانات الأساسية');
  if (it.status === 'متوقفة') err('المادة ' + it.name + ' متوقفة');
  return it;
}
function cleanLines(md, items) {
  if (!Array.isArray(items) || !items.length) err('جدول المواد مطلوب (مادة واحدة على الأقل)');
  const out = [];
  for (const ln of items) {
    const it = getItem(md, ln.item_id);
    const qty = toNum(ln.qty, 'كمية ' + it.name);
    const price = toNum(ln.price, 'سعر ' + it.name);
    if (!(qty > 0)) err('كمية ' + it.name + ' يجب أن تكون أكبر من صفر');
    if (price < 0) err('سعر ' + it.name + ' لا يكون سالباً');
    if (out.some(o => o.item_id === it.id)) err('المادة مكررة في الطلبية: ' + it.name);
    out.push({ item_id: it.id, item_name: it.name, unit: it.unit, qty: r2(qty), price: r2(price), total: r2(qty * price) });
  }
  return out;
}
function orderView(d, o) {
  const deps = d.deposits.filter(x => x.order_id === o.id);
  const confs = d.confirmations.filter(x => x.order_id === o.id);
  const cashPaid = r2(deps.filter(x => CASH_METHODS.includes(x.method)).reduce((s, x) => s + Number(x.amount || 0), 0));
  const allPaid = r2(deps.reduce((s, x) => s + Number(x.amount || 0), 0));
  const lines = o.lines.map(ln => {
    const rec = r2(confs.reduce((s, c) => s + Number((c.lines.find(l => l.item_id === ln.item_id) || {}).received_qty || 0), 0));
    return { ...ln, received: rec, remaining: r2(ln.qty - rec) };
  });
  return { ...o, deposits: deps, confirmations: confs, cashPaid, allPaid, lines, total: r2(o.lines.reduce((s, l) => s + Number(l.total || 0), 0)) };
}

const Proc = {
  METHODS, CASH_METHODS,

  meta() {
    const md = mdata();
    const wh = md.warehouses.find(w => w.type === 'مواد أولية') || md.warehouses[0];
    return { data: { methods: METHODS, cash_methods: CASH_METHODS, default_warehouse_id: wh ? wh.id : null, year: new Date().getFullYear() } };
  },

  kpi() {
    const d = db.load();
    const month = now().slice(0, 7);
    const paidMonth = r2(d.deposits.filter(x => CASH_METHODS.includes(x.method) && String(x.date || '').startsWith(month)).reduce((s, x) => s + Number(x.amount || 0), 0));
    const confs = d.confirmations.slice().sort((a, b) => (a.id < b.id ? 1 : -1));
    const last = confs[0] ? d.orders.find(o => o.id === confs[0].order_id) : null;
    return {
      data: {
        pendingApproval: d.orders.filter(o => o.status === 'بانتظار الموافقة').length,
        approvedWaiting: d.orders.filter(o => o.status === 'معتمدة').length,
        depositsMonth: paidMonth,
        lastConfirmed: last ? { num: last.num, date: confs[0].arrival_date, supplier: last.supplier_name } : null,
        partialOpen: d.orders.filter(o => o.status === 'مؤكدة جزئياً').length
      }
    };
  },

  listOrders() {
    const d = db.load();
    return { data: d.orders.slice().sort((a, b) => (a.id < b.id ? 1 : -1)).map(o => orderView(d, o)) };
  },
  getOrder(id) {
    const d = db.load();
    const o = d.orders.find(x => x.id === Number(id));
    if (!o) err('الطلبية غير موجودة', 404);
    return { data: orderView(d, o) };
  },

  addOrder(b, ctx) {
    const md = mdata();
    const sup = getSupplier(md, b.supplier_id);
    const date = validDate(b.date || now().slice(0, 10), 'تاريخ الطلبية');
    const lines = cleanLines(md, b.items);
    const d = db.load();
    const year = date.slice(0, 4);
    const row = {
      id: d.seq.order++, num: System.formatNum('order', { year, n: d.seq.order_num++ }),
      supplier_id: sup.id, supplier_name: sup.name, date, lines,
      total: r2(lines.reduce((s, l) => s + l.total, 0)),
      status: 'مسودة', reject_reason: '', decided_by: '', decided_at: '',
      created_by: ctx.user, created_at: now(), updated_at: now()
    };
    d.orders.push(row);
    audit(d, 'add-order', row.id, ctx.user, ctx.role);
    db.save(d);
    return { data: orderView(d, row) };
  },
  updateOrder(id, b, ctx) {
    const d = db.load();
    const o = d.orders.find(x => x.id === Number(id));
    if (!o) err('الطلبية غير موجودة', 404);
    if (o.status !== 'مسودة') err('التعديل مسموح في حالة مسودة فقط');
    const md = mdata();
    if (b.supplier_id !== undefined) {
      const sup = getSupplier(md, b.supplier_id);
      o.supplier_id = sup.id; o.supplier_name = sup.name;
    }
    if (b.date !== undefined) o.date = validDate(b.date, 'تاريخ الطلبية');
    if (b.items !== undefined) {
      o.lines = cleanLines(md, b.items);
      o.total = r2(o.lines.reduce((s, l) => s + l.total, 0));
    }
    o.updated_at = now();
    audit(d, 'update-order', o.id, ctx.user, ctx.role);
    db.save(d);
    return { data: orderView(d, o) };
  },
  deleteOrder(id, ctx) {
    const d = db.load();
    const i = d.orders.findIndex(x => x.id === Number(id));
    if (i < 0) err('الطلبية غير موجودة', 404);
    if (d.orders[i].status !== 'مسودة') err('الحذف مسموح في حالة مسودة فقط');
    d.orders.splice(i, 1);
    audit(d, 'delete-order', id, ctx.user, ctx.role);
    db.save(d);
    return { ok: true };
  },
  submitOrder(id, ctx) {
    const d = db.load();
    const o = d.orders.find(x => x.id === Number(id));
    if (!o) err('الطلبية غير موجودة', 404);
    if (o.status !== 'مسودة') err('الإرسال للموافقة من حالة مسودة فقط');
    o.status = 'بانتظار الموافقة';
    o.updated_at = now();
    audit(d, 'submit-order', o.id, ctx.user, ctx.role);
    db.save(d);
    return { data: orderView(d, o) };
  },
  decideOrder(id, b, ctx) {
    if (!Auth.can(ctx.role, 'procurement', 'approve')) err('الموافقة والرفض للمدير فقط', 403);
    const d = db.load();
    const o = d.orders.find(x => x.id === Number(id));
    if (!o) err('الطلبية غير موجودة', 404);
    if (o.status !== 'بانتظار الموافقة') err('القرار من حالة بانتظار الموافقة فقط');
    if (b.decision === 'موافقة') {
      o.status = 'معتمدة'; o.reject_reason = '';
    } else if (b.decision === 'رفض') {
      if (!String(b.reason || '').trim()) err('سبب الرفض مطلوب');
      o.status = 'مرفوضة'; o.reject_reason = String(b.reason).trim();
    } else err('القرار: موافقة أو رفض');
    o.decided_by = ctx.user; o.decided_at = now(); o.updated_at = now();
    audit(d, 'decide-order', o.id, ctx.user, ctx.role);
    db.save(d);
    return { data: orderView(d, o) };
  },

  // ---- كشف المورد: السابقة (افتتاحي + غير مسددة) + الكلي − المدفوع نقدا ----
  statement(order_id, supplier_id) {
    const d = db.load();
    const md = mdata();
    let order = null;
    if (order_id) {
      order = d.orders.find(x => x.id === Number(order_id));
      if (!order) err('الطلبية غير موجودة', 404);
    }
    const sup = md.suppliers.find(x => x.id === Number(order ? order.supplier_id : supplier_id));
    if (!sup) err('المورد غير موجود', 404);
    const opening = toNum(sup.opening_debt, 'الدين الافتتاحي');
    const payPrev = r2(Finance.list().data
      .filter(p => p.supplier_id === sup.id && p.status !== 'مسواة')
      .reduce((s, p) => s + Number(p.amount || 0) - Number(p.settled || 0), 0));
    const prev = r2(opening + payPrev);
    const total = order ? r2(order.total) : 0;
    const cash = order ? r2(d.deposits.filter(x => x.order_id === order.id && CASH_METHODS.includes(x.method)).reduce((s, x) => s + Number(x.amount || 0), 0)) : 0;
    return {
      data: {
        supplier: { id: sup.id, name: sup.name },
        order: order ? { id: order.id, num: order.num, total, status: order.status } : null,
        opening, payables_prev: payPrev, prev_total: prev,
        cash_paid: cash, current: r2(prev + total - cash)
      }
    };
  },

  // ---- العربون ----
  listDeposits(order_id) {
    const d = db.load();
    const rows = (order_id ? d.deposits.filter(x => x.order_id === Number(order_id)) : d.deposits).slice().sort((a, b) => (a.id < b.id ? 1 : -1));
    return { data: rows };
  },
  _depLock(d, order_id) {
    if (d.confirmations.some(c => c.order_id === Number(order_id))) err('مقفل: بدأ تأكيد الطلبية المرتبطة — لا إضافة ولا تعديل ولا حذف للعربون');
  },
  addDeposit(b, ctx) {
    if (!Auth.can(ctx.role, 'procurement', 'deposit')) err('العربون: المحاسب أو المدير فقط', 403);
    const d = db.load();
    const o = d.orders.find(x => x.id === Number(b.order_id));
    if (!o) err('الطلبية غير موجودة', 404);
    if (o.status !== 'معتمدة' && o.status !== 'مؤكدة جزئياً') err('العربون للطلبيات المعتمدة فقط');
    this._depLock(d, o.id);
    if (!METHODS.includes(b.method)) err('طريقة الدفع: ' + METHODS.join(' / '));
    const amount = toNum(b.amount, 'المبلغ المدفوع');
    if (b.method === 'مؤخر') {
      if (amount !== 0) err('المؤخر وعد لا دفع — المبلغ صفر إجباري');
    } else if (!(amount > 0)) err('المبلغ يجب أن يكون أكبر من صفر');
    if (CASH_METHODS.includes(b.method)) {
      const paid = r2(d.deposits.filter(x => x.order_id === o.id && CASH_METHODS.includes(x.method)).reduce((s, x) => s + Number(x.amount || 0), 0));
      if (r2(paid + amount) > r2(o.total) + 1e-9) err('تجاوز إجمالي الطلبية (' + o.total + ') — المدفوع نقدا ' + paid + ' والمسموح المتبقي ' + r2(o.total - paid));
    }
    const row = {
      id: d.seq.deposit++, order_id: o.id, order_num: o.num,
      supplier_id: o.supplier_id, supplier_name: o.supplier_name,
      date: validDate(b.date || now().slice(0, 10), 'التاريخ'),
      method: b.method, amount: r2(amount), note: String(b.note || '').trim().slice(0, 200),
      created_by: ctx.user, created_at: now()
    };
    d.deposits.push(row);
    audit(d, 'add-deposit', row.id, ctx.user, ctx.role);
    db.save(d);
    return { data: row };
  },
  updateDeposit(id, b, ctx) {
    if (!Auth.can(ctx.role, 'procurement', 'deposit')) err('العربون: المحاسب أو المدير فقط', 403);
    const d = db.load();
    const r = d.deposits.find(x => x.id === Number(id));
    if (!r) err('غير موجود', 404);
    this._depLock(d, r.order_id);
    if (b.date !== undefined) r.date = validDate(b.date, 'التاريخ');
    if (b.method !== undefined) {
      if (!METHODS.includes(b.method)) err('طريقة الدفع: ' + METHODS.join(' / '));
      r.method = b.method;
    }
    if (b.amount !== undefined) r.amount = r2(toNum(b.amount, 'المبلغ المدفوع'));
    if (r.method === 'مؤخر' && r.amount !== 0) err('المؤخر وعد لا دفع — المبلغ صفر إجباري');
    if (r.method !== 'مؤخر' && !(r.amount > 0)) err('المبلغ يجب أن يكون أكبر من صفر');
    if (b.note !== undefined) r.note = String(b.note || '').trim().slice(0, 200);
    if (CASH_METHODS.includes(r.method)) {
      const o = d.orders.find(x => x.id === r.order_id);
      const paid = r2(d.deposits.filter(x => x.order_id === r.order_id && x.id !== r.id && CASH_METHODS.includes(x.method)).reduce((s, x) => s + Number(x.amount || 0), 0));
      if (r2(paid + r.amount) > r2(o.total) + 1e-9) err('تجاوز إجمالي الطلبية (' + o.total + ') — المسموح المتبقي ' + r2(o.total - paid));
    }
    audit(d, 'update-deposit', r.id, ctx.user, ctx.role);
    db.save(d);
    return { data: r };
  },
  deleteDeposit(id, ctx) {
    if (!Auth.can(ctx.role, 'procurement', 'deposit')) err('العربون: المحاسب أو المدير فقط', 403);
    const d = db.load();
    const i = d.deposits.findIndex(x => x.id === Number(id));
    if (i < 0) err('غير موجود', 404);
    this._depLock(d, d.deposits[i].order_id);
    d.deposits.splice(i, 1);
    audit(d, 'delete-deposit', id, ctx.user, ctx.role);
    db.save(d);
    return { ok: true };
  },

  // ---- التأكيد ----
  listConfirmations(order_id) {
    const d = db.load();
    const rows = (order_id ? d.confirmations.filter(x => x.order_id === Number(order_id)) : d.confirmations).slice().sort((a, b) => (a.id < b.id ? 1 : -1));
    return { data: rows };
  },
  getConfirmation(id) {
    const d = db.load();
    const c = d.confirmations.find(x => x.id === Number(id));
    if (!c) err('غير موجود', 404);
    return { data: c };
  },
  addConfirmation(b, ctx) {
    if (!Auth.can(ctx.role, 'procurement', 'confirm')) err('التأكيد: أمين المخزن أو المدير فقط', 403);
    const md = mdata();
    const d = db.load();
    const o = d.orders.find(x => x.id === Number(b.order_id));
    if (!o) err('الطلبية غير موجودة', 404);
    if (o.status !== 'معتمدة' && o.status !== 'مؤكدة جزئياً') err('التأكيد للطلبية المعتمدة فقط (بعد موافقة المدير)');
    const arrival = validDate(b.arrival_date || now().slice(0, 10), 'تاريخ الوصول');
    const wh = md.warehouses.find(w => w.id === Number(b.warehouse_id)) || md.warehouses.find(w => w.type === 'مواد أولية') || md.warehouses[0];
    if (!wh) err('لا يوجد مخزن — عرّف المخازن أولاً');
    const expiry = validDate(b.expiry, 'تاريخ انتهاء الشحنة');
    // الكميات مقابل المتبقي
    const prev = {};
    for (const c of d.confirmations.filter(x => x.order_id === o.id)) {
      for (const l of c.lines) prev[l.item_id] = r2((prev[l.item_id] || 0) + Number(l.received_qty || 0));
    }
    if (!Array.isArray(b.lines) || !b.lines.length) err('جدول المقارنة مطلوب');
    const lines = [];
    for (const ln of b.lines) {
      const ol = o.lines.find(l => l.item_id === Number(ln.item_id));
      if (!ol) err('مادة خارج الطلبية الأصلية');
      const rec = toNum(ln.received_qty, 'المستلم من ' + ol.item_name);
      if (rec < 0) err('المستلم لا يكون سالباً');
      const remain = r2(ol.qty - (prev[ol.item_id] || 0));
      if (rec > remain + 1e-9) err('المستلم من ' + ol.item_name + ' يتجاوز المتبقي (' + remain + ')');
      const price = toNum(ln.price !== undefined ? ln.price : ol.price, 'سعر ' + ol.item_name);
      if (price < 0) err('السعر لا يكون سالباً');
      lines.push({ item_id: ol.item_id, item_name: ol.item_name, unit: ol.unit, ordered_qty: ol.qty, received_qty: r2(rec), price: r2(price), line_total: r2(rec * price) });
    }
    if (!lines.some(l => l.received_qty > 0)) err('أدخل كمية مستلمة واحدة على الأقل');
    // الجودة: مقبولة أو تمرير استثنائي مسجل
    const qc = b.qc || {};
    if (!['مقبولة', 'تمرير استثنائي'].includes(qc.result)) err('نتيجة الفحص: مقبولة أو تمرير استثنائي');
    if (qc.result === 'تمرير استثنائي' && (!String(qc.note || '').trim() || !String(qc.by || '').trim())) {
      err('التمرير الاستثنائي يتطلب الملاحظة واسم المصرح');
    }
    // هل اكتملت؟
    const fullAfter = o.lines.every(ol => r2(ol.qty - (prev[ol.item_id] || 0) - Number((lines.find(l => l.item_id === ol.item_id) || {}).received_qty || 0)) <= 1e-9);
    const invoice_ref = String(b.invoice_ref || '').trim();
    if (fullAfter && !invoice_ref) err('مرجع الفاتورة/وصل التسليم إلزامي عند التأكيد الكامل');
    // الحسابات: النقدي الفعلي فقط يخصم
    const received_total = r2(lines.reduce((s, l) => s + l.line_total, 0));
    const cashPaid = r2(d.deposits.filter(x => x.order_id === o.id && CASH_METHODS.includes(x.method)).reduce((s, x) => s + Number(x.amount || 0), 0));
    const payable = r2(received_total - cashPaid);
    const row = {
      id: d.seq.confirmation++, order_id: o.id, order_num: o.num,
      supplier_id: o.supplier_id, supplier_name: o.supplier_name,
      arrival_date: arrival, warehouse_id: wh.id, warehouse_name: wh.name, expiry,
      lines, invoice_ref,
      qc: { result: qc.result, note: String(qc.note || '').trim(), by: String(qc.by || ctx.user).trim() },
      received_total, cash_deducted: cashPaid, payable,
      status: fullAfter ? 'مؤكدة بالكامل' : 'مؤكدة جزئياً',
      confirmed_by: ctx.user, created_at: now()
    };
    d.confirmations.push(row);
    // الآثار التلقائية: (1) لوتات (2) آخر سعر (3) مستحق المورد
    for (const l of lines) {
      if (l.received_qty > 0) {
        Stock.receiveLot({ item_id: l.item_id, item_name: l.item_name, unit: l.unit, qty: l.received_qty, cost: l.price, warehouse_id: wh.id, warehouse_name: wh.name, expiry, qc: qc.result, order_num: o.num, supplier_name: o.supplier_name, date: arrival, user: ctx.user });
        Master.updateItem(l.item_id, { last_price: l.price }, ctx);
      }
    }
    Finance.addPayable({ order_id: o.id, order_num: o.num, supplier_id: o.supplier_id, supplier_name: o.supplier_name, amount: payable, date: arrival, note: 'تأكيد ' + row.status });
    o.status = fullAfter ? 'مؤكدة بالكامل' : 'مؤكدة جزئياً';
    o.updated_at = now();
    audit(d, 'confirm-order', o.id, ctx.user, ctx.role);
    db.save(d);
    return { data: row };
  }
};

module.exports = Proc;
