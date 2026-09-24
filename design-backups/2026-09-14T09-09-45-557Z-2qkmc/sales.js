// المبيعات: فاتورة SI ← تأكيد بخصم FEFO للمنتج التام + دين ← تحصيل ← مرتجع للمخزون
// القواعد: المسودة بلا أثر — المؤكدة تُصحح بالمرتجع فقط — النقد قابل للتعديل
const jstore = require('./jstore');
const mstore = require('./store');
const Stock = require('./stock');
const Finance = require('./finance');

const db = jstore('sales.json', {
  seq: { invoice: 1, invoice_num: 1, receipt: 1, receipt_num: 1, ret: 1, ret_num: 1 },
  invoices: [], receipts: [], returns: []
});
const now = () => new Date().toISOString();
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
const CAN_SALE = ['admin', 'accountant'];
const CAN_RETURN = ['admin', 'storekeeper'];
const METHODS = ['نقدي', 'تحويل بنكي', 'شيك'];
const RETURN_REASONS = ['عيب', 'خطأ', 'انتهاء', 'أخرى'];

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
function mdata() { return mstore.load(); }
function getCustomer(md, id) {
  const c = md.customers.find(x => x.id === Number(id));
  if (!c) err('الزبون غير موجود في البيانات الأساسية');
  if (c.active === false) err('الزبون موقف — فعّله من البيانات الأساسية أولاً');
  return c;
}
function getProduct(md, id) {
  const it = md.items.find(x => x.id === Number(id));
  if (!it) err('المنتج غير موجود في البيانات الأساسية');
  if (it.status === 'متوقفة') err('المنتج ' + it.name + ' موقف');
  const cat = (md.categories || []).find(c => c.id === Number(it.category_id));
  if (!cat || cat.main !== 'منتج نهائي') {
    err('البيع للمنتج النهائي فقط: ' + it.name + ' مصنفة «' + (cat ? cat.main : 'بلا تصنيف') + '» — المواد الأولية لا تباع');
  }
  return it;
}
function cleanLines(md, items) {
  if (!Array.isArray(items) || !items.length) err('سطور الفاتورة مطلوبة (منتج واحد على الأقل)');
  const out = [];
  for (const ln of items) {
    const it = getProduct(md, ln.item_id);
    const qty = toNum(ln.qty, 'كمية ' + it.name);
    const price = toNum(ln.price, 'سعر ' + it.name);
    if (!(qty > 0)) err('كمية ' + it.name + ' أكبر من صفر');
    if (price < 0) err('السعر لا يكون سالباً');
    if (out.some(o => o.item_id === it.id)) err('المنتج مكرر في الفاتورة: ' + it.name);
    out.push({ item_id: it.id, item_name: it.name, unit: it.unit, qty: r2(qty), price: r2(price), total: r2(qty * price) });
  }
  return out;
}
// صافي الفاتورة: الإجمالي − المحصل − المرتجع بسعر البيع الأصلي
function invoiceView(d, inv) {
  const receipts = d.receipts.filter(x => x.invoice_id === inv.id);
  const returns = d.returns.filter(x => x.invoice_id === inv.id);
  const paid = r2(receipts.reduce((s, x) => s + Number(x.amount || 0), 0));
  let retVal = 0;
  for (const rt of returns) {
    for (const l of rt.lines) {
      const ol = inv.lines.find(x => x.item_id === l.item_id);
      retVal = r2(retVal + Number(l.qty || 0) * Number(ol ? ol.price : 0));
    }
  }
  return { ...inv, receipts, returns, paid, retVal, remaining: r2(inv.total - paid - retVal) };
}

const Sales = {
  METHODS, RETURN_REASONS,

  kpi() {
    const d = db.load();
    const conf = d.invoices.filter(o => o.status === 'مؤكدة');
    const t = now().slice(0, 10), month = t.slice(0, 7);
    const sumT = arr => r2(arr.reduce((s, o) => s + Number(o.total || 0), 0));
    let recv = 0;
    for (const o of conf) recv = r2(recv + invoiceView(d, o).remaining);
    return {
      data: {
        today: sumT(conf.filter(o => o.date === t)),
        month: sumT(conf.filter(o => String(o.date).startsWith(month))),
        receivables: recv,
        last: conf.slice().sort((a, b) => (a.id < b.id ? 1 : -1))[0] || null,
        returnsMonth: d.returns.filter(x => String(x.date).startsWith(month)).length
      }
    };
  },

  statement(invoice_id, customer_id) {
    const d = db.load();
    const md = mdata();
    let inv = null;
    if (invoice_id) {
      inv = d.invoices.find(x => x.id === Number(invoice_id));
      if (!inv) err('الفاتورة غير موجودة', 404);
    }
    const cust = md.customers.find(x => x.id === Number(inv ? inv.customer_id : customer_id));
    if (!cust) err('الزبون غير موجود', 404);
    const opening = toNum(cust.opening_debt, 'الدين الافتتاحي');
    const open = d.invoices.filter(x => x.customer_id === cust.id && x.status === 'مؤكدة');
    let invTotal = 0, paid = 0, ret = 0;
    for (const o of open) {
      const v = invoiceView(d, o);
      invTotal = r2(invTotal + o.total); paid = r2(paid + v.paid); ret = r2(ret + v.retVal);
    }
    return {
      data: {
        customer: { id: cust.id, name: cust.name },
        invoice: inv ? { id: inv.id, num: inv.num, total: inv.total } : null,
        opening, invoices_total: invTotal, paid, returns: ret,
        net: r2(opening + invTotal - paid - ret)
      }
    };
  },

  listInvoices() {
    const d = db.load();
    return { data: d.invoices.slice().sort((a, b) => (a.id < b.id ? 1 : -1)).map(o => invoiceView(d, o)) };
  },
  getInvoice(id) {
    const d = db.load();
    const o = d.invoices.find(x => x.id === Number(id));
    if (!o) err('الفاتورة غير موجودة', 404);
    return { data: invoiceView(d, o) };
  },
  addInvoice(b, ctx) {
    if (!CAN_SALE.includes(ctx.role)) err('الفواتير: المدير أو المحاسب فقط', 403);
    const md = mdata();
    const cust = getCustomer(md, b.customer_id);
    const lines = cleanLines(md, b.items);
    const d = db.load();
    const date = validDate(b.date || now().slice(0, 10), 'التاريخ');
    const row = {
      id: d.seq.invoice++, num: 'SI-' + date.slice(0, 4) + '-' + String(d.seq.invoice_num++).padStart(3, '0'),
      customer_id: cust.id, customer_name: cust.name, date, lines,
      total: r2(lines.reduce((s, l) => s + l.total, 0)),
      status: 'مسودة', note: String(b.note || '').trim(),
      created_by: ctx.user, created_at: now(), updated_at: now()
    };
    d.invoices.push(row);
    db.save(d);
    return { data: invoiceView(d, row) };
  },
  updateInvoice(id, b, ctx) {
    if (!CAN_SALE.includes(ctx.role)) err('الفواتير: المدير أو المحاسب فقط', 403);
    const d = db.load();
    const o = d.invoices.find(x => x.id === Number(id));
    if (!o) err('الفاتورة غير موجودة', 404);
    if (o.status !== 'مسودة') err('التعديل في مسودة فقط — المؤكدة تُصحح بالمرتجع');
    const md = mdata();
    if (b.customer_id !== undefined) {
      const cust = getCustomer(md, b.customer_id);
      o.customer_id = cust.id; o.customer_name = cust.name;
    }
    if (b.date !== undefined) o.date = validDate(b.date, 'التاريخ');
    if (b.items !== undefined) {
      o.lines = cleanLines(md, b.items);
      o.total = r2(o.lines.reduce((s, l) => s + l.total, 0));
    }
    if (b.note !== undefined) o.note = String(b.note || '').trim();
    o.updated_at = now();
    db.save(d);
    return { data: invoiceView(d, o) };
  },
  deleteInvoice(id, ctx) {
    if (!CAN_SALE.includes(ctx.role)) err('الفواتير: المدير أو المحاسب فقط', 403);
    const d = db.load();
    const i = d.invoices.findIndex(x => x.id === Number(id));
    if (i < 0) err('الفاتورة غير موجودة', 404);
    if (d.invoices[i].status !== 'مسودة') err('الحذف في مسودة فقط');
    d.invoices.splice(i, 1);
    db.save(d);
    return { ok: true };
  },
  confirmInvoice(id, b, ctx) {
    if (!CAN_SALE.includes(ctx.role)) err('التأكيد: المدير أو المحاسب فقط', 403);
    const md = mdata();
    const d = db.load();
    const o = d.invoices.find(x => x.id === Number(id));
    if (!o) err('الفاتورة غير موجودة', 404);
    if (o.status !== 'مسودة') err('التأكيد من مسودة فقط');
    for (const ln of o.lines) getProduct(md, ln.item_id); // إعادة التحقق لحظة البيع (قد تكون أُعيد تصنيفها بعد المسودة)
    const wh = md.warehouses.find(w => w.id === Number(b.warehouse_id)) || md.warehouses.find(w => w.type === 'منتج نهائي') || md.warehouses[0];
    if (!wh) err('لا يوجد مخزن');
    const inv = require('./inventory-check');
    // خصم FEFO للمنتج التام + لقطة التكلفة لكل سطر
    for (const ln of o.lines) {
      const taken = inv.consume(wh.id, [{ item_id: ln.item_id, qty: ln.qty }], { kind: 'فاتورة', num: o.num }, ctx.user, 'بيع ' + o.num);
      const val = r2(taken.reduce((s, c) => s + c.value, 0));
      ln.cost_snapshot = r2(val / ln.qty);
      ln.margin = r2((ln.price - ln.cost_snapshot) * ln.qty);
    }
    o.warehouse_id = wh.id; o.warehouse_name = wh.name;
    o.status = 'مؤكدة'; o.confirmed_by = ctx.user; o.confirmed_at = now(); o.updated_at = now();
    Finance.addReceivable({ invoice_id: o.id, invoice_num: o.num, customer_id: o.customer_id, customer_name: o.customer_name, amount: o.total, date: o.date, note: 'فاتورة بيع' });
    db.save(d);
    return { data: invoiceView(d, o) };
  },

  // ---- التحصيل ----
  listReceipts(invoice_id) {
    const d = db.load();
    const rows = (invoice_id ? d.receipts.filter(x => x.invoice_id === Number(invoice_id)) : d.receipts).slice().sort((a, b) => (a.id < b.id ? 1 : -1));
    return { data: rows };
  },
  addReceipt(b, ctx) {
    if (!CAN_SALE.includes(ctx.role)) err('التحصيل: المدير أو المحاسب فقط', 403);
    const d = db.load();
    const o = d.invoices.find(x => x.id === Number(b.invoice_id));
    if (!o) err('الفاتورة غير موجودة', 404);
    if (o.status !== 'مؤكدة') err('التحصيل للفاتورة المؤكدة فقط');
    if (!METHODS.includes(b.method)) err('الطريقة: ' + METHODS.join(' / '));
    const amount = toNum(b.amount, 'المبلغ');
    if (!(amount > 0)) err('المبلغ أكبر من صفر');
    const row = {
      id: d.seq.receipt++, num: 'RC-' + validDate(b.date || now().slice(0, 10), 'التاريخ').slice(0, 4) + '-' + String(d.seq.receipt_num++).padStart(3, '0'),
      invoice_id: o.id, invoice_num: o.num, customer_id: o.customer_id, customer_name: o.customer_name,
      date: validDate(b.date || now().slice(0, 10), 'التاريخ'),
      method: b.method, amount: r2(amount), note: String(b.note || '').trim().slice(0, 200),
      created_by: ctx.user, created_at: now()
    };
    d.receipts.push(row);
    db.save(d);
    return { data: row };
  },
  updateReceipt(id, b, ctx) {
    if (!CAN_SALE.includes(ctx.role)) err('التحصيل: المدير أو المحاسب فقط', 403);
    const d = db.load();
    const r = d.receipts.find(x => x.id === Number(id));
    if (!r) err('غير موجود', 404);
    if (b.date !== undefined) r.date = validDate(b.date, 'التاريخ');
    if (b.method !== undefined) {
      if (!METHODS.includes(b.method)) err('الطريقة: ' + METHODS.join(' / '));
      r.method = b.method;
    }
    if (b.amount !== undefined) {
      const a = toNum(b.amount, 'المبلغ');
      if (!(a > 0)) err('المبلغ أكبر من صفر');
      r.amount = r2(a);
    }
    if (b.note !== undefined) r.note = String(b.note || '').trim().slice(0, 200);
    db.save(d);
    return { data: r };
  },
  deleteReceipt(id, ctx) {
    if (ctx.role !== 'admin') err('حذف السند للمدير فقط', 403);
    const d = db.load();
    const i = d.receipts.findIndex(x => x.id === Number(id));
    if (i < 0) err('غير موجود', 404);
    d.receipts.splice(i, 1);
    db.save(d);
    return { ok: true };
  },

  // ---- المرتجع: للمخزون مباشرة + تخفيض الدين بسعر البيع الأصلي ----
  listReturns() {
    const d = db.load();
    return { data: d.returns.slice().sort((a, b) => (a.id < b.id ? 1 : -1)) };
  },
  addReturn(b, ctx) {
    if (!CAN_RETURN.includes(ctx.role)) err('المرتجع: المدير أو أمين المخزن فقط', 403);
    const md = mdata();
    const d = db.load();
    const o = d.invoices.find(x => x.id === Number(b.invoice_id));
    if (!o) err('الفاتورة غير موجودة', 404);
    if (o.status !== 'مؤكدة') err('المرتجع للفاتورة المؤكدة فقط');
    if (!RETURN_REASONS.includes(b.reason)) err('السبب: ' + RETURN_REASONS.join(' / '));
    const wh = md.warehouses.find(w => w.id === Number(b.warehouse_id)) || md.warehouses.find(w => w.id === o.warehouse_id) || md.warehouses[0];
    if (!wh) err('لا يوجد مخزن');
    if (!Array.isArray(b.lines) || !b.lines.length) err('سطور المرتجع مطلوبة');
    // المتاح إرجاعه = المباع − المرجع سابقاً
    const prevRet = {};
    for (const rt of d.returns.filter(x => x.invoice_id === o.id)) {
      for (const l of rt.lines) prevRet[l.item_id] = r2((prevRet[l.item_id] || 0) + Number(l.qty || 0));
    }
    const lines = [];
    for (const ln of b.lines) {
      const ol = o.lines.find(l => l.item_id === Number(ln.item_id));
      if (!ol) err('منتج خارج الفاتورة الأصلية');
      const q = toNum(ln.qty, 'مرتجع ' + ol.item_name);
      if (!(q > 0)) err('كمية المرتجع أكبر من صفر');
      const max = r2(ol.qty - (prevRet[ol.item_id] || 0));
      if (q > max + 1e-9) err('مرتجع ' + ol.item_name + ' يتجاوز المتبقي (' + max + ')');
      lines.push({ item_id: ol.item_id, item_name: ol.item_name, unit: ol.unit, qty: r2(q), price: ol.price });
    }
    const date = validDate(b.date || now().slice(0, 10), 'التاريخ');
    const row = {
      id: d.seq.ret++, num: 'RT-' + date.slice(0, 4) + '-' + String(d.seq.ret_num++).padStart(3, '0'),
      invoice_id: o.id, invoice_num: o.num, customer_id: o.customer_id, customer_name: o.customer_name,
      date, warehouse_id: wh.id, warehouse_name: wh.name, lines,
      reason: b.reason, note: String(b.note || '').trim(),
      created_by: ctx.user, created_at: now()
    };
    d.returns.push(row);
    // دخول مباشر للمخزون بتكلفة البيع المسجلة
    for (const l of lines) {
      const ol = o.lines.find(x => x.item_id === l.item_id);
      Stock.receiveLot({
        item_id: l.item_id, item_name: l.item_name, unit: l.unit, qty: l.qty,
        cost: Number(ol.cost_snapshot || 0), warehouse_id: wh.id, warehouse_name: wh.name,
        expiry: '', qc: 'مقبولة', order_num: row.num, supplier_name: 'مرتجع ' + o.customer_name,
        date, user: ctx.user
      });
    }
    db.save(d);
    return { data: row };
  }
};

module.exports = Sales;
