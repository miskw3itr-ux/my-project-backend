// الفوترة والوصولات (قسم 11): وثائق مزدوجة فوق فواتير البيع — نفس الصلاحيات (sales)
// - وصل مؤقت + فاتورة مؤقتة يُنشآن تلقائياً عند إنشاء فاتورة البيع (مسودة)
// - الوصل النهائي بزر «استلام السلعة» من الوصل المؤقت (يشترط فاتورة مؤكدة)
// - فاتورة الضرائب بترقية الفاتورة المؤقتة (تشترط فاتورة مؤكدة)
// - الحذف/التحديث تبعي لفاتورة البيع (لا وثائق يتيمة أبداً)
const jstore = require('./jstore');
const Auth = require('./auth');

const db = jstore('billing.json', {
  seq: { receipt: 1, invoice: 1, receipt_num: 1, invoice_num: 1 },
  receipts: [], invoices: []
});
const now = () => new Date().toISOString();
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
function err(msg, code) { throw Object.assign(new Error(msg), { code: code || 400 }); }
function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 120); }
function toNum(v, field) {
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim();
  if (s === '') return 0;
  s = s.replace(/[٠-٩]/g, ch => '٠١٢٣٤٥٦٧٨٩'.indexOf(ch))
       .replace(/[۰-۹]/g, ch => '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch))
       .replace(/[\s  ']/g, '').replace(/٬/g, '').replace(/[٫,]/g, '.');
  const parts = s.split('.');
  if (parts.length > 2) s = parts.shift() + '.' + parts.join('');
  const n = Number(s);
  if (!Number.isFinite(n)) err((field || 'الرقم') + ': رقم غير صالح');
  return n;
}
function pct(v, field) {
  const n = toNum(v, field);
  if (n < 0 || n > 100) err((field || 'النسبة') + ': بين 0 و 100');
  return r2(n);
}
const PAY_METHODS = ['نقداً', 'تحويل', 'شيك', 'آجل'];

// ---- بناة اللقطات من فاتورة البيع (المرجع الوحيد — لا إدخال يدوي للسطور) ----
function snapReceipt(inv) {
  return {
    invoice_id: inv.id, invoice_num: inv.num, date: inv.date,
    customer_id: inv.customer_id, customer_name: inv.customer_name,
    delivery_date: str(inv.delivery_date, 10),
    destination: str(inv.destination, 120), driver: str(inv.driver, 120),
    lines: (inv.lines || []).map((l, i) => ({
      n: i + 1, item_id: l.item_id, item_name: l.item_name, unit: l.unit,
      qty: r2(Number(l.qty || 0)), price: r2(Number(l.price || 0)), total: r2(Number(l.total || 0))
    })),
    total: r2(Number(inv.total || 0)), note: str(inv.note, 200)
  };
}
function snapInvoice(inv, md) {
  const cust = ((md || {}).customers || []).find(c => c.id === Number(inv.customer_id)) || {};
  return {
    invoice_id: inv.id, invoice_num: inv.num, date: inv.date,
    customer: {
      id: cust.id || inv.customer_id, name: cust.name || inv.customer_name,
      code: cust.code || '', phone: cust.phone || '', address: cust.address || '',
      kind: cust.kind || '', rc: cust.rc || '', mf: cust.mf || '',
      art_imp: cust.art_imp || '', nis: cust.nis || ''
    },
    destination: str(inv.destination, 120), driver: str(inv.driver, 120),
    delivery_date: str(inv.delivery_date, 10),
    seller: str(inv.created_by, 120),
    lines: (inv.lines || []).map((l, i) => {
      const it = ((md || {}).items || []).find(x => x.id === Number(l.item_id)) || {};
      return {
        n: i + 1, item_id: l.item_id, code: it.code || '', name: l.item_name,
        desc: '', unit: l.unit, qty: r2(Number(l.qty || 0)), price: r2(Number(l.price || 0)),
        discount: 0, total: r2(Number(l.total || 0))
      };
    }),
    note: str(inv.note, 200)
  };
}
function totalsOf(doc) {
  const subtotal = r2((doc.lines || []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0));
  const discount_total = r2((doc.lines || []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0) * Number(l.discount || 0) / 100, 0));
  const after = r2(subtotal - discount_total);
  const tax_amount = r2(after * Number(doc.tax_rate || 0) / 100);
  const net = r2(after + tax_amount);
  const paid = r2(Number((doc.payment || {}).paid || 0));
  return { subtotal, discount_total, after_discount: after, tax_amount, net, paid, remaining: r2(net - paid) };
}
// الديون الحية للوثيقة: السابقة (دون أثر هذه الفاتورة) + الحالية + الكلية
function debtsOf(inv) {
  const Sales = require('./sales');
  const st = Sales.statement(inv.id, inv.customer_id).data;
  const confirmed = inv.status === 'مؤكدة';
  const prev = confirmed ? r2(st.net - Number(inv.total || 0)) : r2(st.net);
  const current = r2(Number(inv.total || 0));
  return { prev, current, total: r2(prev + current), paid: r2(st.paid) };
}
function salesInv(id) {
  const Sales = require('./sales');
  const d = require('./jstore')('sales.json', { invoices: [] }).load();
  const o = (d.invoices || []).find(x => x.id === Number(id));
  if (!o) err('فاتورة البيع غير موجودة', 404);
  return { Sales, inv: o };
}
function needInvoice(ctx) {
  if (!Auth.can(ctx.role, 'sales', 'invoice')) err('الفواتير: المدير أو المحاسب فقط', 403);
}
function needReceipt(ctx) {
  if (!Auth.can(ctx.role, 'sales', 'receipt')) err('التحصيل والوصولات: المدير أو المحاسب فقط', 403);
}
// الدفعات المالية المسجلة على الفاتورة (تحصيلات المبيعات — جزء من إثبات النهائي)
function paymentsOf(invoice_id) {
  try {
    const sd = require('./jstore')('sales.json', { receipts: [] }).load();
    return (sd.receipts || []).filter(x => Number(x.invoice_id) === Number(invoice_id))
      .map(x => ({ num: x.num, date: x.date, method: x.method, account: x.account, amount: r2(Number(x.amount || 0)), by: x.created_by || '' }))
      .sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  } catch { return []; }
}
// الرقم الموحد للعملية: كل وثائق البيع (مؤقت/نهائي/فاتورة) تحمل رقم الفاتورة المؤقتة —
// المراقبة تطابق رقماً واحداً عبر الجداول. ترحيل صامت للوثائق القديمة (BTM/BFN).
function unifiedCode(d, invoice_id) {
  const inv = d.invoices.find(x => x.invoice_id === Number(invoice_id));
  return inv ? inv.code : null;
}
function ensureUnifiedCodes(d) {
  let touched = false;
  for (const r of d.receipts || []) {
    const u = unifiedCode(d, r.invoice_id);
    if (u && r.code !== u) { r.code = u; touched = true; }
  }
  return touched;
}

const Billing = {
  // ---- قراءة ----
  _scope(rows, ctx) {
    if ((ctx || {}).role !== 'salesman') return rows;
    return (rows || []).filter(x => x.created_by === ctx.user);
  },
  // وثيقة الفوترة ملك صاحب فاتورة بيعها (للمندوب)
  _ownDoc(doc, ctx) {
    if (!doc) err('الوثيقة غير موجودة', 404);
    if (ctx.role === 'salesman') {
      const sd = require('./jstore')('sales.json', { invoices: [] }).load();
      const o = (sd.invoices || []).find(x => x.id === Number(doc.invoice_id));
      if (!o || o.created_by !== ctx.user) err('وثائقك فقط — هذه لزميل آخر', 403);
    }
    return doc;
  },
  listReceipts(q, ctx) {
    const d = db.load();
    if (ensureUnifiedCodes(d)) { try { db.save(d); } catch {} }
    let rows = this._scope(d.receipts.slice().sort((a, b) => (a.id < b.id ? 1 : -1)), ctx);
    const s = str(q, 60);
    if (s) rows = rows.filter(r => (r.code + ' ' + r.invoice_num + ' ' + r.customer_name).includes(s));
    return { data: rows };
  },
  getReceipt(id, ctx) {
    const d = db.load();
    if (ensureUnifiedCodes(d)) { try { db.save(d); } catch {} }
    const r = this._ownDoc(d.receipts.find(x => x.id === Number(id)), ctx || {});
    if (!r) err('الوصل غير موجود', 404);
    const { inv } = salesInv(r.invoice_id);
    return { data: { ...r, debts: debtsOf(inv), payments: paymentsOf(inv.id), invoice_status: inv.status } };
  },
  listInvoices(q, kind, ctx) {
    const d = db.load();
    let rows = this._scope(d.invoices.slice().sort((a, b) => (a.id < b.id ? 1 : -1)), ctx);
    if (kind === 'temp' || kind === 'tax') rows = rows.filter(r => r.kind === kind);
    const s = str(q, 60);
    if (s) rows = rows.filter(r => (r.code + ' ' + r.invoice_num + ' ' + (r.customer && r.customer.name) + ' ' + (r.official_serial || '')).includes(s));
    return { data: rows.map(x => ({ ...x, ...totalsOf(x) })) };
  },
  getInvoice(id, ctx) {
    const d = db.load();
    const r = this._ownDoc(d.invoices.find(x => x.id === Number(id)), ctx || {});
    if (!r) err('الفاتورة غير موجودة', 404);
    const { inv } = salesInv(r.invoice_id);
    return { data: { ...r, ...totalsOf(r), debts: debtsOf(inv), invoice_status: inv.status } };
  },

  // بناء الوصل النهائي (مشترك: تلقائي عند التأكيد + يدوي للفواتير القديمة)
  // الرقم = رقم الفاتورة المؤقتة (توحيد المراقبة) — مع ترقيم احتياطي فريد عند غيابها
  _makeFinal(d, inv, ctx) {
    if (d.receipts.some(x => x.invoice_id === Number(inv.id) && x.kind === 'final')) err('الوصل النهائي موجود مسبقاً لهذه العملية');
    const row = {
      id: d.seq.receipt++, code: unifiedCode(d, inv.id) || ('BFN-' + String(d.seq.receipt_num++).padStart(3, '0')),
      kind: 'final', ...snapReceipt(inv),
      returns: [],
      received_by: (ctx && ctx.user) || 'system', received_at: now().slice(0, 10),
      signatures: { store: '', economist: '', seller: str(inv.created_by, 120) },
      created_by: (ctx && ctx.user) || 'system', created_at: now()
    };
    d.receipts.push(row);
    return row;
  },
  // ---- أرشفة الوصل النهائي مع التأكيد (إثبات التسليم + المدفوعات + المرتجعات) ----
  archive(id, ctx) {
    needReceipt(ctx);
    const d = db.load();
    const r = this._ownDoc(d.receipts.find(x => x.id === Number(id)), ctx);
    if (!r) err('الوصل غير موجود', 404);
    if (r.kind !== 'final') err('الأرشفة للوصل النهائي فقط');
    if (r.archived) err('الوصل مؤرشف مسبقاً');
    r.archived = true;
    r.archived_by = ctx.user; r.archived_at = now();
    r.updated_at = now();
    db.save(d);
    return { data: r };
  },
  // ---- استلام السلعة: وصل نهائي من المؤقت (فاتورة مؤكدة فقط، نهائي واحد فقط) ----
  receive(id, ctx) {
    needReceipt(ctx);
    const d = db.load();
    const t = this._ownDoc(d.receipts.find(x => x.id === Number(id)), ctx);
    if (!t) err('الوصل غير موجود', 404);
    if (t.kind !== 'temp') err('الاستلام من الوصل المؤقت فقط');
    const { inv } = salesInv(t.invoice_id);
    if (inv.status !== 'مؤكدة') err('استلام السلعة بعد تأكيد فاتورة البيع فقط');
    const row = this._makeFinal(d, inv, ctx);
    db.save(d);
    return { data: row };
  },

  // ---- تعديل وثيقة الفاتورة (المؤقتة كاملة — الضريبية: الدفع والملاحظة والجبائي فقط) ----
  updateInvoice(id, b, ctx) {
    needInvoice(ctx);
    const d = db.load();
    const r = this._ownDoc(d.invoices.find(x => x.id === Number(id)), ctx);
    if (!r) err('الفاتورة غير موجودة', 404);
    const locked = r.kind === 'tax';
    if (b.lines !== undefined) {
      if (locked) err('فاتورة الضرائب مقفلة السطور — التعديل للدفع والملاحظة فقط');
      if (!Array.isArray(b.lines) || !b.lines.length) err('سطور الفاتورة مطلوبة');
      const byId = {};
      for (const l of r.lines) byId[l.item_id] = l;
      r.lines = b.lines.map((l, i) => {
        const base = byId[Number(l.item_id)];
        if (!base) err('سطر غير معروف في الوثيقة');
        return { ...base, n: i + 1, desc: str(l.desc, 200), discount: pct(l.discount || 0, 'خصم ' + base.name) };
      });
      r.subtotal_note = undefined;
    }
    if (b.tax_rate !== undefined) {
      if (locked && Number(b.tax_rate) !== Number(r.tax_rate || 0)) err('نسبة ضريبة فاتورة الضرائب ثابتة بعد الترقية');
      r.tax_rate = pct(b.tax_rate, 'نسبة الضريبة');
    }
    if (b.payment !== undefined) {
      const p = b.payment || {};
      const method = p.method === undefined ? r.payment.method : p.method;
      if (!PAY_METHODS.includes(method)) err('طريقة الدفع: ' + PAY_METHODS.join(' / '));
      r.payment = {
        method,
        paid: r2(toNum(p.paid === undefined ? r.payment.paid : p.paid, 'المبلغ المدفوع')),
        due_date: p.due_date === undefined ? r.payment.due_date : (String(p.due_date || '').trim() ? String(p.due_date).trim() : '')
      };
      if (r.payment.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(r.payment.due_date)) err('تاريخ الاستحقاق بصيغة (سنة-شهر-يوم)');
    }
    if (b.fiscal !== undefined) {
      const f = b.fiscal || {};
      r.fiscal = {
        customer_rc: str(f.customer_rc !== undefined ? f.customer_rc : r.fiscal.customer_rc, 60),
        customer_mf: str(f.customer_mf !== undefined ? f.customer_mf : r.fiscal.customer_mf, 60),
        customer_nis: str(f.customer_nis !== undefined ? f.customer_nis : r.fiscal.customer_nis, 60),
        tva_rate: pct(f.tva_rate !== undefined ? f.tva_rate : r.fiscal.tva_rate, 'نسبة TVA'),
        official_serial: str(f.official_serial !== undefined ? f.official_serial : r.fiscal.official_serial, 60)
      };
      if (locked && !r.fiscal.official_serial) err('الرقم التسلسلي الرسمي مطلوب لفاتورة الضرائب');
    }
    if (b.destination !== undefined) r.destination = str(b.destination, 120);
    if (b.driver !== undefined) r.driver = str(b.driver, 120);
    if (b.delivery_date !== undefined) r.delivery_date = str(b.delivery_date, 10);
    if (b.note !== undefined) r.note = str(b.note, 200);
    r.updated_at = now();
    db.save(d);
    return { data: { ...r, ...totalsOf(r) } };
  },

  // ---- ترقية المؤقتة → فاتورة ضرائب (فاتورة بيع مؤكدة فقط) ----
  upgrade(id, b, ctx) {
    needInvoice(ctx);
    const d = db.load();
    const r = this._ownDoc(d.invoices.find(x => x.id === Number(id)), ctx);
    if (!r) err('الفاتورة غير موجودة', 404);
    if (r.kind === 'tax') err('هي فاتورة ضرائب أصلاً');
    const { inv } = salesInv(r.invoice_id);
    if (inv.status !== 'مؤكدة') err('ترقية الضرائب بعد تأكيد فاتورة البيع فقط');
    const tva = pct((b || {}).tva_rate !== undefined ? (b || {}).tva_rate : (r.tax_rate || 0), 'نسبة TVA');
    r.tax_rate = tva;
    r.fiscal = {
      customer_rc: str((b || {}).customer_rc !== undefined ? (b || {}).customer_rc : ((r.customer || {}).rc || ''), 60),
      customer_mf: str((b || {}).customer_mf !== undefined ? (b || {}).customer_mf : ((r.customer || {}).mf || ''), 60),
      customer_nis: str((b || {}).customer_nis !== undefined ? (b || {}).customer_nis : ((r.customer || {}).nis || ''), 60),
      tva_rate: tva,
      official_serial: str((b || {}).official_serial, 60) || ('FTX-' + String(r.id).padStart(4, '0'))
    };
    try {
      const sys = require('./system').get();
      r.company = {
        name: str((sys.factory || {}).name, 120), address: str((sys.factory || {}).address, 120),
        phone: str((sys.factory || {}).phone, 60), rc: str((sys.factory || {}).commercialReg, 60),
        mf: str((sys.factory || {}).taxId, 60), artImp: str((sys.factory || {}).artImp, 60), bank: str((sys.factory || {}).bank, 60)
      };
    } catch { r.company = r.company || {}; }
    r.kind = 'tax';
    r.upgraded_by = ctx.user; r.upgraded_at = now(); r.updated_at = now();
    db.save(d);
    return { data: { ...r, ...totalsOf(r) } };
  },

  // ---- خطافات فواتير البيع (تُستدعى من sales.js — لا تُستدعى مباشرة من المسارات) ----
  onInvoiceCreated(inv, ctx) {
    const d = db.load();
    // عدم التكرار: إعادة إرسال الإنشاء لنفس الفاتورة لا تولّد وثائق مكررة أبداً
    if (d.receipts.some(x => x.invoice_id === Number(inv.id) && x.kind === 'temp')) return;
    const md = require('./store').load();
    const ib = snapInvoice(inv, md);
    const invCode = 'FTM-' + String(d.seq.invoice_num++).padStart(3, '0');
    d.invoices.push({
      id: d.seq.invoice++, code: invCode,
      kind: 'temp', ...ib,
      tax_rate: 0, payment: { method: 'نقداً', paid: 0, due_date: '' },
      fiscal: { customer_rc: ib.customer.rc || '', customer_mf: ib.customer.mf || '', customer_nis: ib.customer.nis || '', tva_rate: 0, official_serial: '' },
      company: {},
      created_by: (ctx && ctx.user) || 'system', created_at: now(), updated_at: now()
    });
    // الوصل المؤقت يحمل رقم الفاتورة المؤقتة نفسه (رقم موحد للعملية)
    const base = snapReceipt(inv);
    d.receipts.push({
      id: d.seq.receipt++, code: invCode,
      kind: 'temp', ...base,
      signatures: { store: '', economist: '', seller: str(inv.created_by, 120) },
      created_by: (ctx && ctx.user) || 'system', created_at: now()
    });
    db.save(d);
  },
  onInvoiceUpdated(inv) {
    const d = db.load();
    const md = require('./store').load();
    let touched = false;
    const t = d.receipts.find(x => x.invoice_id === Number(inv.id) && x.kind === 'temp');
    if (t) { Object.assign(t, snapReceipt(inv)); touched = true; }
    const f = d.invoices.find(x => x.invoice_id === Number(inv.id) && x.kind === 'temp');
    if (f) {
      const fresh = snapInvoice(inv, md);
      // تحديث اللقطة الأساسية فقط — الخصومات والضرائب والدفع والجبائي ملك الوثيقة
      f.date = fresh.date; f.customer = fresh.customer;
      f.destination = fresh.destination; f.driver = fresh.driver; f.seller = fresh.seller; f.note = fresh.note;
      const disc = {};
      for (const l of (f.lines || [])) disc[l.item_id] = { discount: l.discount, desc: l.desc };
      f.lines = fresh.lines.map(l => ({ ...l, discount: (disc[l.item_id] || {}).discount || 0, desc: (disc[l.item_id] || {}).desc || '' }));
      f.updated_at = now(); touched = true;
    }
    if (touched) db.save(d);
  },
  onInvoiceDeleted(invoice_id) {
    const d = db.load();
    const n0 = d.receipts.length + d.invoices.length;
    d.receipts = d.receipts.filter(x => x.invoice_id !== Number(invoice_id));
    d.invoices = d.invoices.filter(x => x.invoice_id !== Number(invoice_id));
    if (d.receipts.length + d.invoices.length !== n0) db.save(d);
  },
  // عند تأكيد البيع: وصل نهائي تلقائي (إثبات التسليم — نسخة للزبون ونسخة للأرشيف)
  onInvoiceConfirmed(inv, ctx) {
    const d = db.load();
    if (d.receipts.some(x => x.invoice_id === Number(inv.id) && x.kind === 'final')) return;
    try { this._makeFinal(d, inv, ctx); db.save(d); } catch {}
  },
  // عند المرتجع/الخلل: يُحدَّث الوصل النهائي بسجل المرتجعات (السطور المسلّمة ثابتة للتاريخ)
  onReturn(rt) {
    const d = db.load();
    const f = d.receipts.find(x => x.invoice_id === Number(rt.invoice_id) && x.kind === 'final');
    if (!f) return;
    f.returns = f.returns || [];
    if (f.returns.some(x => x.return_num === rt.num)) return;
    const amount = r2((rt.lines || []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0));
    f.returns.push({ return_num: rt.num, date: rt.date, reason: str(rt.reason, 120), amount, by: str(rt.created_by, 120) });
    f.updated_at = now();
    db.save(d);
  }
};

module.exports = Billing;
