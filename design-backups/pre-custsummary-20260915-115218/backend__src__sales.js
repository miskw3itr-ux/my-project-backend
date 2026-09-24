// المبيعات: فاتورة SI ← تأكيد بخصم FEFO للمنتج التام + دين ← تحصيل ← مرتجع للمخزون
// القواعد: المسودة بلا أثر — المؤكدة تُصحح بالمرتجع فقط — النقد قابل للتعديل
const jstore = require('./jstore');
const System = require('./system');
const Auth = require('./auth');
const mstore = require('./store');
const Stock = require('./stock');
const Finance = require('./finance');

const db = jstore('sales.json', {
  seq: { invoice: 1, invoice_num: 1, receipt: 1, receipt_num: 1, ret: 1, ret_num: 1 },
  invoices: [], receipts: [], returns: []
});
const now = () => new Date().toISOString();
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
const METHODS = ['نقدي', 'تحويل بنكي', 'شيك', 'مؤخر'];
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
// حساب القبض: النقد في صندوق مسمى، والتحويل/الشيك في بنك مسمى — موجود ومعرف في المالية
function checkReceiptAccount(method, account) {
  const name = String(account || '').trim();
  if (!name) err(method === 'نقدي' ? 'اختر الصندوق لاستلام النقد' : 'اختر البنك — عرّفه في المالية أولاً');
  const accs = Finance.listAccounts().data;
  const acc = accs.find(a => a.name === name);
  if (!acc) err('الحساب «' + name + '» غير موجود — عرّفه في المالية أولاً');
  const want = method === 'نقدي' ? 'صندوق' : 'بنك';
  if (acc.type !== want) err('«' + name + '» حساب ' + acc.type + ' — القبض ' + (method === 'نقدي' ? 'النقدي في صندوق' : 'البنكي في بنك'));
  return acc.name;
}
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

  // توافر البيع: المتبقي القابل للبيع + تكلفة الإنتاج لكل منتج تام (مخازن التام فقط، المقبول فقط)
  availability() {
    const md = mdata();
    const finIds = new Set((md.items || []).filter(it => {
      const c = (md.categories || []).find(x => x.id === Number(it.category_id));
      return c && c.main === 'منتج نهائي';
    }).map(it => it.id));
    const finWh = new Set((md.warehouses || []).filter(w => w.type === 'منتج نهائي').map(w => w.id));
    let lots = [];
    try { lots = require('./jstore')('inventory.json', { lots: [] }).load().lots || []; } catch { lots = []; }
    const map = {};
    for (const l of lots) {
      if (!finIds.has(Number(l.item_id)) || !finWh.has(Number(l.warehouse_id))) continue;
      const rem = r2(Number(l.remaining || 0));
      if (!(rem > 0)) continue;
      const qf = l.qc_final || (l.qc === 'تمرير استثنائي' ? 'بانتظار المراجعة' : (l.qc || 'مقبولة'));
      if (qf !== 'مقبولة') continue;
      const k = Number(l.item_id);
      if (!map[k]) {
        const it = (md.items || []).find(x => x.id === k) || {};
        map[k] = { item_id: k, item_name: l.item_name, unit: l.unit || it.unit || '', remaining: 0, value: 0 };
      }
      map[k].remaining = r2(map[k].remaining + rem);
      map[k].value = r2(map[k].value + rem * Number(l.cost_per_unit || 0));
    }
    return {
      data: Object.values(map).map(r => ({
        item_id: r.item_id, item_name: r.item_name, unit: r.unit,
        remaining: r.remaining, unit_cost: r.remaining > 0 ? r2(r.value / r.remaining) : 0
      }))
    };
  },

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
    if (!Auth.can(ctx.role, 'sales', 'invoice')) err('الفواتير: المدير أو المحاسب فقط', 403);
    const md = mdata();
    const cust = getCustomer(md, b.customer_id);
    const lines = cleanLines(md, b.items);
    const d = db.load();
    const date = validDate(b.date || now().slice(0, 10), 'التاريخ');
    const row = {
      id: d.seq.invoice++, num: System.formatNum('invoice', { year: date.slice(0, 4), n: d.seq.invoice_num++ }),
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
    if (!Auth.can(ctx.role, 'sales', 'invoice')) err('الفواتير: المدير أو المحاسب فقط', 403);
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
    if (!Auth.can(ctx.role, 'sales', 'invoice')) err('الفواتير: المدير أو المحاسب فقط', 403);
    const d = db.load();
    const i = d.invoices.findIndex(x => x.id === Number(id));
    if (i < 0) err('الفاتورة غير موجودة', 404);
    if (d.invoices[i].status !== 'مسودة') err('الحذف في مسودة فقط');
    d.invoices.splice(i, 1);
    db.save(d);
    return { ok: true };
  },
  confirmInvoice(id, b, ctx) {
    if (!Auth.can(ctx.role, 'sales', 'invoice')) err('التأكيد: المدير أو المحاسب فقط', 403);
    const md = mdata();
    const d = db.load();
    const o = d.invoices.find(x => x.id === Number(id));
    if (!o) err('الفاتورة غير موجودة', 404);
    if (o.status !== 'مسودة') err('التأكيد من مسودة فقط');
    for (const ln of o.lines) getProduct(md, ln.item_id); // إعادة التحقق لحظة البيع (قد تكون أُعيد تصنيفها بعد المسودة)
    const inv = require('./inventory-check');
    // خصم FEFO الشامل لكل مخازن التام + لقطة التكلفة لكل سطر (مطابق لرقم التوافر المعروض)
    for (const ln of o.lines) {
      const taken = inv.consumeMulti([{ item_id: ln.item_id, qty: ln.qty }], { kind: 'فاتورة', num: o.num }, ctx.user, 'بيع ' + o.num, ['منتج نهائي']);
      const val = r2(taken.reduce((s, c) => s + c.value, 0));
      ln.cost_snapshot = r2(val / ln.qty);
      ln.margin = r2((ln.price - ln.cost_snapshot) * ln.qty);
    }
    o.warehouse_id = null; o.warehouse_name = 'تلقائي (مخازن التام)';
    // أكياس البيع (معيار المصنع 2/قنطار): تُخصم تلقائياً من مخازن الخام
    // تحذير عند النقص دون منع البيع — المنتج مغلّف فعلياً وثمن الأكياس في التكلفة النهائية
    const bagIt = inv.bagsItem ? inv.bagsItem() : null;
    const bagPerQ = inv.BAGS_PER_Q || 2;
    o.bags = { item_id: bagIt ? bagIt.id : null, item_name: bagIt ? bagIt.name : '', unit: bagIt ? bagIt.unit : '', per_q: bagPerQ, qty: 0, shortfall: 0, skipped: !bagIt };
    if (bagIt) {
      let need = 0;
      for (const ln of o.lines) need += Math.ceil(Number(ln.qty || 0) * bagPerQ - 1e-9);
      if (need > 0) {
        const res = inv.consumeUpTo(bagIt.id, need, { kind: 'فاتورة', num: o.num }, ctx.user, 'أكياس البيع — ' + o.num, ['مواد أولية']);
        o.bags.qty = res.took; o.bags.shortfall = res.shortfall;
      }
    }
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
    if (!Auth.can(ctx.role, 'sales', 'receipt')) err('التحصيل: المدير أو المحاسب فقط', 403);
    const d = db.load();
    const o = d.invoices.find(x => x.id === Number(b.invoice_id));
    if (!o) err('الفاتورة غير موجودة', 404);
    if (o.status !== 'مؤكدة') err('التحصيل للفاتورة المؤكدة فقط');
    if (!METHODS.includes(b.method)) err('الطريقة: ' + METHODS.join(' / '));
    const amount = toNum(b.amount, 'المبلغ');
    // الحساب ملزم لكل قبض فعلي: النقد في صندوق، والتحويل/الشيك في بنك
    // المؤخر وعد لا قبض: صفر إجباري وبلا حساب، لا يُنقص الدين ولا يدخل الدفتر
    let account = '';
    if (b.method === 'مؤخر') {
      if (amount !== 0) err('المؤخر وعد لاحق — المبلغ صفر إجباري');
    } else {
      if (!(amount > 0)) err('المبلغ أكبر من صفر');
      account = checkReceiptAccount(b.method, b.account);
    }
    const row = {
      id: d.seq.receipt++, num: System.formatNum('receipt', { year: validDate(b.date || now().slice(0, 10), 'التاريخ').slice(0, 4), n: d.seq.receipt_num++ }),
      invoice_id: o.id, invoice_num: o.num, customer_id: o.customer_id, customer_name: o.customer_name,
      date: validDate(b.date || now().slice(0, 10), 'التاريخ'),
      method: b.method, amount: r2(amount), account, note: String(b.note || '').trim().slice(0, 200),
      created_by: ctx.user, created_at: now()
    };
    d.receipts.push(row);
    db.save(d);
    return { data: row };
  },
  updateReceipt(id, b, ctx) {
    if (!Auth.can(ctx.role, 'sales', 'receipt')) err('التحصيل: المدير أو المحاسب فقط', 403);
    const d = db.load();
    const r = d.receipts.find(x => x.id === Number(id));
    if (!r) err('غير موجود', 404);
    if (b.date !== undefined) r.date = validDate(b.date, 'التاريخ');
    if (b.method !== undefined) {
      if (!METHODS.includes(b.method)) err('الطريقة: ' + METHODS.join(' / '));
      r.method = b.method;
    }
    if (b.amount !== undefined) {
      r.amount = r2(toNum(b.amount, 'المبلغ'));
    }
    if (b.account !== undefined) r.account = String(b.account || '').trim();
    if (r.method === 'مؤخر') {
      if (r.amount !== 0) err('المؤخر وعد لاحق — المبلغ صفر إجباري');
      r.account = '';
    } else {
      if (!(r.amount > 0)) err('المبلغ أكبر من صفر');
      r.account = checkReceiptAccount(r.method, r.account);
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
    if (!Auth.can(ctx.role, 'sales', 'return')) err('المرتجع: المدير أو أمين المخزن فقط', 403);
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
      id: d.seq.ret++, num: System.formatNum('ret', { year: date.slice(0, 4), n: d.seq.ret_num++ }),
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
    // المرتجع مغلّف: الأكياس تعود مع المنتج (تناظر خصم البيع)
    try {
      const Issue = require('./inventory-check');
      const bagIt = Issue.bagsItem ? Issue.bagsItem() : null;
      const perQ = Issue.BAGS_PER_Q || 2;
      if (bagIt) {
        let back = 0;
        for (const l of lines) back += Math.ceil(Number(l.qty || 0) * perQ - 1e-9);
        if (back > 0) {
          const md2 = mdata();
          const bag = (md2.items || []).find(x => x.id === bagIt.id) || {};
          // الأكياس مادة خام: تعود لأول مخزن خام (لا لمخزن التام المختار للمرتجع)
          const bagWh = (md2.warehouses || []).find(w => w.type === 'مواد أولية') || wh;
          Stock.receiveLot({
            item_id: bagIt.id, item_name: bagIt.name, unit: bagIt.unit, qty: back,
            cost: Number(bag.last_price || 0), warehouse_id: bagWh.id, warehouse_name: bagWh.name,
            expiry: '', qc: 'مقبولة', order_num: row.num, supplier_name: 'مرتجع ' + o.customer_name,
            date, user: ctx.user
          });
          row.bags_back = back;
        }
      }
    } catch (e) {}
    db.save(d);
    return { data: row };
  },

  // ---- نشاط الزبون: بطاقة + سجل مشتريات ومدفوعات ومرتجعات بفترة + ديون سابقة/حالية ----
  // الدفتر: الفاتورة المؤكدة ترفع الدين، والتحصيل والمرتجع (بسعر البيع الأصلي) يخفضانه — المسودة بلا أثر
  customerActivity(customer_id, from, to) {
    const d = db.load();
    const md = mdata();
    const cust = md.customers.find(x => x.id === Number(customer_id));
    if (!cust) err('الزبون غير موجود', 404);
    if (from) validDate(from, 'من');
    if (to) validDate(to, 'إلى');
    if (from && to && from > to) err('من أكبر من إلى', 400);
    const inRange = dt => (!from || String(dt || '') >= from) && (!to || String(dt || '') <= to);
    const isCash = m => METHODS.includes(m) && m !== 'مؤخر';
    const retValOf = rt => r2((rt.lines || []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0));
    const opening = toNum(cust.opening_debt, 'الدين الافتتاحي');
    const conf = o => o.status === 'مؤكدة';
    // الديون السابقة: افتتاحي + فواتير قبل الفترة − تحصيل − مرتجعات قبل الفترة
    let prevInv = 0, prevPaid = 0, prevRet = 0;
    for (const o of d.invoices || []) {
      if (Number(o.customer_id) !== cust.id || !conf(o)) continue;
      if (from && String(o.date || '') < from) prevInv = r2(prevInv + Number(o.total || 0));
    }
    for (const x of d.receipts || []) {
      if (Number(x.customer_id) !== cust.id) continue;
      if (from && String(x.date || '') < from && isCash(x.method)) prevPaid = r2(prevPaid + Number(x.amount || 0));
    }
    for (const rt of d.returns || []) {
      if (Number(rt.customer_id) !== cust.id) continue;
      if (from && String(rt.date || '') < from) prevRet = r2(prevRet + retValOf(rt));
    }
    const prev = r2(opening + prevInv - prevPaid - prevRet);
    // سجل الفترة (أو كل النشاط): مشتريات + تحصيل + مرتجعات مرتبة زمنياً مع رصيد متحرك
    const lines = [];
    for (const o of d.invoices || []) {
      if (Number(o.customer_id) !== cust.id || !conf(o) || !inRange(o.date)) continue;
      const goods = (o.lines || []).map(l => l.item_name + ' ' + Number(l.qty || 0) + ' ' + (l.unit || '')).join(' + ');
      lines.push({ date: o.date, kind: 'مشتريات', ref: o.num || '', detail: goods, total: r2(Number(o.total || 0)), effect: r2(Number(o.total || 0)), _id: 'i' + o.id });
    }
    for (const x of d.receipts || []) {
      if (Number(x.customer_id) !== cust.id || !inRange(x.date)) continue;
      const cash = isCash(x.method) ? r2(Number(x.amount || 0)) : 0;
      lines.push({ date: x.date, kind: x.method === 'مؤخر' ? 'وعد مؤخر' : 'تحصيل', ref: x.invoice_num || '', detail: x.method + (x.account ? ' — ' + x.account : '') + (x.note ? ' — ' + x.note : ''), total: r2(Number(x.amount || 0)), effect: -cash, _id: 'r' + x.id });
    }
    for (const rt of d.returns || []) {
      if (Number(rt.customer_id) !== cust.id || !inRange(rt.date)) continue;
      const rv = retValOf(rt);
      const goods = (rt.lines || []).map(l => l.item_name + ' ' + Number(l.qty || 0)).join(' + ');
      lines.push({ date: rt.date, kind: 'مرتجع', ref: rt.num || '', detail: goods + (rt.reason ? ' — ' + rt.reason : ''), total: rv, effect: -rv, _id: 't' + rt.id });
    }
    lines.sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : (a._id < b._id ? -1 : 1)));
    let bal = prev, invTot = 0, paidTot = 0, retTot = 0;
    for (const l of lines) {
      if (l.kind === 'مشتريات') invTot = r2(invTot + l.effect);
      else if (l.kind === 'مرتجع') retTot = r2(retTot - l.effect);
      else if (l.effect < 0) paidTot = r2(paidTot - l.effect);
      bal = r2(bal + l.effect);
      l.balance = bal;
    }
    // السلعة المشتراة: تجميع الكميات والقيم داخل الفترة (المؤكدة فقط)
    const byItem = {};
    for (const o of d.invoices || []) {
      if (Number(o.customer_id) !== cust.id || !conf(o) || !inRange(o.date)) continue;
      for (const l of o.lines || []) {
        const k = l.item_name || ('#' + l.item_id);
        byItem[k] = byItem[k] || { name: k, unit: l.unit || '', qty: 0, total: 0 };
        byItem[k].qty = r2(byItem[k].qty + Number(l.qty || 0));
        byItem[k].total = r2(byItem[k].total + Number(l.total || 0));
      }
    }
    return {
      data: {
        customer: {
          id: cust.id, code: cust.code || '', name: cust.name, phone: cust.phone || '', address: cust.address || '',
          kind: cust.kind || 'تجزئة', price_type: cust.price_type || 'تجزئة',
          rc: cust.rc || '', mf: cust.mf || '', art_imp: cust.art_imp || '', nis: cust.nis || '',
          breeder_card: cust.breeder_card || ''
        },
        from: from || '', to: to || '',
        prev: { opening, invoices: prevInv, paid: prevPaid, returns: prevRet, total: prev },
        lines, goods: Object.values(byItem),
        totals: { invoices: invTot, paid: paidTot, returns: retTot, current: bal },
        generated_at: new Date().toISOString().slice(0, 16).replace('T', ' ')
      }
    };
  }
};

module.exports = Sales;
