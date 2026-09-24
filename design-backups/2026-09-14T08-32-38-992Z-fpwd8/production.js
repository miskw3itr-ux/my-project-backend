// الإنتاج: أمر OF ← بدء ← إغلاق باستهلاك FEFO للمواد + لوت منتج تام بتكلفة حقيقية
// القواعد: لا سالب — المغلق نهائي — المنتج التام بطاقة مادة — الهدر يُحمّل على التكلفة
const jstore = require('./jstore');
const mstore = require('./store');
const Stock = require('./stock');

const db = jstore('production.json', { seq: { order: 1, order_num: 1 }, orders: [] });
const now = () => new Date().toISOString();
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
const CAN_PROD = ['admin', 'storekeeper'];
const OH = 0.05;

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
function plusDays(base, n) {
  const t = Date.parse(base) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
function mdata() { return mstore.load(); }
function getFormula(md, id) {
  const f = md.formulas_ref.find(x => x.id === Number(id));
  if (!f) err('التركيبة غير موجودة');
  if (f.status === 'متوقفة') err('التركيبة ' + (f.num || '') + ' متوقفة — اعتمد نسخة نشطة');
  const items = (md.formula_items || []).filter(x => x.formula_id === f.id);
  if (!items.length) err('التركيبة بلا عناصر');
  return { f, items };
}
function getProduct(md, id) {
  const p = md.items.find(x => x.id === Number(id));
  if (!p) err('المنتج التام غير موجود — عرّفه بطاقة مادة أولاً');
  if (p.status === 'متوقفة') err('المنتج ' + p.name + ' موقف');
  const cat = (md.categories || []).find(c => c.id === Number(p.category_id));
  if (!cat || cat.main !== 'منتج نهائي') {
    err('المخرج منتج تام فقط: ' + p.name + ' مصنفة «' + (cat ? cat.main : 'بلا تصنيف') + '» — أنشئ بطاقة بتصنيف منتج نهائي');
  }
  return p;
}
// الاحتياج النظري لكمية إنتاج فعلية/مخططة
function theoretical(items, qty) {
  const totQ = r2(items.reduce((s, x) => s + Number(x.qty || 0), 0));
  if (!(totQ > 0)) err('مجموع التركيبة صفر');
  const k = qty / totQ;
  return items.map(x => ({ item_id: x.item_id, item_name: x.item_name, unit: x.unit, qty: r2(Number(x.qty || 0) * k) }));
}
function checkAvail(wh_id, lines, label) {
  const inv = require('./inventory-check');
  return inv.check(wh_id, lines, label);
}

const Prod = {
  kpi() {
    const d = db.load();
    const done = d.orders.filter(o => o.status === 'مكتملة');
    const t = now().slice(0, 10);
    const weekAgo = plusDays(t, -6);
    const month = t.slice(0, 7);
    const sum = arr => r2(arr.reduce((s, o) => s + Number(o.actual_qty || 0), 0));
    const inMonth = done.filter(o => String(o.closed_at || '').slice(0, 7) === month);
    const th = inMonth.reduce((s, o) => s + Number(o.theoretical_total || 0), 0);
    const wa = inMonth.reduce((s, o) => s + Number(o.waste || 0), 0);
    return {
      data: {
        today: sum(done.filter(o => String(o.closed_at || '').slice(0, 10) === t)),
        week: sum(done.filter(o => String(o.closed_at || '').slice(0, 10) >= weekAgo)),
        month: sum(inMonth),
        wip: d.orders.filter(o => o.status === 'قيد التنفيذ').length,
        wastePct: th > 0 ? Math.round((wa / th) * 1000) / 10 : 0
      }
    };
  },

  list() {
    const d = db.load();
    return { data: d.orders.slice().sort((a, b) => (a.id < b.id ? 1 : -1)) };
  },
  get(id) {
    const d = db.load();
    const o = d.orders.find(x => x.id === Number(id));
    if (!o) err('الأمر غير موجود', 404);
    return { data: o };
  },

  add(b, ctx) {
    if (!CAN_PROD.includes(ctx.role)) err('الإنتاج: المدير أو أمين المخزن فقط', 403);
    const md = mdata();
    const { f } = getFormula(md, b.formula_id);
    const p = getProduct(md, b.product_id);
    const src = md.warehouses.find(w => w.id === Number(b.src_wh));
    const dst = md.warehouses.find(w => w.id === Number(b.dst_wh));
    if (!src || !dst) err('مخزن المصدر والوجهة مطلوبان');
    if (src.id === dst.id) err('مخزنا المصدر والوجهة مختلفان');
    const planned = toNum(b.planned_qty, 'الكمية المخططة');
    if (!(planned > 0)) err('الكمية المخططة أكبر من صفر');
    const d = db.load();
    const year = validDate(b.date || now().slice(0, 10), 'التاريخ').slice(0, 4);
    const row = {
      id: d.seq.order++, num: 'OF-' + year + '-' + String(d.seq.order_num++).padStart(3, '0'),
      formula_id: f.id, formula_num: f.num, formula_name: f.name,
      product_id: p.id, product_name: p.name, product_unit: p.unit,
      planned_qty: r2(planned), date: validDate(b.date || now().slice(0, 10), 'التاريخ'),
      src_wh: src.id, src_wh_name: src.name, dst_wh: dst.id, dst_wh_name: dst.name,
      status: 'مسودة', note: String(b.note || '').trim(),
      actual_qty: 0, waste: 0, theoretical: [], actual_lines: [], finished: null,
      created_by: ctx.user, created_at: now(), updated_at: now()
    };
    row.theoretical = theoretical((md.formula_items || []).filter(x => x.formula_id === f.id), r2(planned));
    row.theoretical_total = r2(row.theoretical.reduce((s, l) => s + l.qty, 0));
    d.orders.push(row);
    db.save(d);
    return { data: row };
  },
  update(id, b, ctx) {
    if (!CAN_PROD.includes(ctx.role)) err('الإنتاج: المدير أو أمين المخزن فقط', 403);
    const md = mdata();
    const d = db.load();
    const o = d.orders.find(x => x.id === Number(id));
    if (!o) err('الأمر غير موجود', 404);
    if (o.status !== 'مسودة') err('التعديل في مسودة فقط');
    if (b.formula_id !== undefined || b.product_id !== undefined) {
      const { f } = getFormula(md, b.formula_id !== undefined ? b.formula_id : o.formula_id);
      const p = getProduct(md, b.product_id !== undefined ? b.product_id : o.product_id);
      o.formula_id = f.id; o.formula_num = f.num; o.formula_name = f.name;
      o.product_id = p.id; o.product_name = p.name; o.product_unit = p.unit;
    }
    if (b.src_wh !== undefined || b.dst_wh !== undefined) {
      const src = md.warehouses.find(w => w.id === Number(b.src_wh !== undefined ? b.src_wh : o.src_wh));
      const dst = md.warehouses.find(w => w.id === Number(b.dst_wh !== undefined ? b.dst_wh : o.dst_wh));
      if (!src || !dst) err('المخزن غير موجود');
      if (src.id === dst.id) err('مخزنا المصدر والوجهة مختلفان');
      o.src_wh = src.id; o.src_wh_name = src.name; o.dst_wh = dst.id; o.dst_wh_name = dst.name;
    }
    if (b.planned_qty !== undefined) {
      const pl = toNum(b.planned_qty, 'الكمية المخططة');
      if (!(pl > 0)) err('الكمية المخططة أكبر من صفر');
      o.planned_qty = r2(pl);
    }
    if (b.date !== undefined) o.date = validDate(b.date, 'التاريخ');
    if (b.note !== undefined) o.note = String(b.note || '').trim();
    const { items } = getFormula(md, o.formula_id);
    o.theoretical = theoretical(items, o.planned_qty);
    o.theoretical_total = r2(o.theoretical.reduce((s, l) => s + l.qty, 0));
    o.updated_at = now();
    db.save(d);
    return { data: o };
  },
  remove(id, ctx) {
    if (!CAN_PROD.includes(ctx.role)) err('الإنتاج: المدير أو أمين المخزن فقط', 403);
    const d = db.load();
    const i = d.orders.findIndex(x => x.id === Number(id));
    if (i < 0) err('الأمر غير موجود', 404);
    if (d.orders[i].status !== 'مسودة') err('الحذف في مسودة فقط — المغلق نهائي');
    d.orders.splice(i, 1);
    db.save(d);
    return { ok: true };
  },
  start(id, ctx) {
    if (!CAN_PROD.includes(ctx.role)) err('الإنتاج: المدير أو أمين المخزن فقط', 403);
    const md = mdata();
    const d = db.load();
    const o = d.orders.find(x => x.id === Number(id));
    if (!o) err('الأمر غير موجود', 404);
    if (o.status !== 'مسودة') err('البدء من مسودة فقط');
    const { items } = getFormula(md, o.formula_id);
    checkAvail(o.src_wh, theoretical(items, o.planned_qty), 'بدء التنفيذ');
    o.status = 'قيد التنفيذ';
    o.started_by = ctx.user; o.started_at = now(); o.updated_at = now();
    db.save(d);
    return { data: o };
  },
  cancel(id, ctx) {
    if (!CAN_PROD.includes(ctx.role)) err('الإنتاج: المدير أو أمين المخزن فقط', 403);
    const d = db.load();
    const o = d.orders.find(x => x.id === Number(id));
    if (!o) err('الأمر غير موجود', 404);
    if (o.status === 'مكتملة') err('المغلق نهائي — لا إلغاء');
    if (o.status === 'ملغاة') err('ملغاة مسبقاً');
    o.status = 'ملغاة';
    o.updated_at = now();
    db.save(d);
    return { data: o };
  },
  close(id, b, ctx) {
    if (!CAN_PROD.includes(ctx.role)) err('الإنتاج: المدير أو أمين المخزن فقط', 403);
    const md = mdata();
    const d = db.load();
    const o = d.orders.find(x => x.id === Number(id));
    if (!o) err('الأمر غير موجود', 404);
    if (o.status !== 'قيد التنفيذ') err('الإغلاق لأمر قيد التنفيذ فقط (ابدأ التنفيذ أولاً)');
    const actual = toNum(b.actual_qty, 'الكمية المنتجة فعلاً');
    if (!(actual > 0)) err('الكمية المنتجة أكبر من صفر');
    const waste = toNum(b.waste, 'الهدر');
    if (waste < 0) err('الهدر لا يكون سالباً');
    const { items } = getFormula(md, o.formula_id);
    const theo = theoretical(items, actual);
    const theoTot = r2(theo.reduce((s, l) => s + l.qty, 0));
    // الاستهلاك = النظري + الهدر موزعاً بنفس الخلطة
    const k = theoTot > 0 ? (actual + waste) / actual : 1;
    const needs = theo.map(l => ({ ...l, need: r2(l.qty * k) }));
    checkAvail(o.src_wh, needs.map(n => ({ item_id: n.item_id, qty: n.need })), 'الإغلاق');
    // الصرف FEFO + التقييم بأسعار اللوتات
    const inv = require('./inventory-check');
    const consumed = inv.consume(o.src_wh, needs.map(n => ({ item_id: n.item_id, item_name: n.item_name, unit: n.unit, qty: n.need, theo: n.qty })), { kind: 'إنتاج', num: o.num }, ctx.user, 'أمر ' + o.num);
    const rawValue = r2(consumed.reduce((s, c) => s + c.value, 0));
    const unitCost = r2((rawValue * (1 + OH)) / actual);
    const expiry = b.expiry && String(b.expiry).trim() ? validDate(b.expiry, 'انتهاء المنتج') : plusDays(now().slice(0, 10), 180);
    const lot = Stock.receiveLot({
      item_id: o.product_id, item_name: o.product_name, unit: o.product_unit,
      qty: actual, cost: unitCost, warehouse_id: o.dst_wh, warehouse_name: o.dst_wh_name,
      expiry, qc: 'مقبولة', order_num: o.num, date: validDate(b.date || now().slice(0, 10), 'تاريخ الإنتاج'), user: ctx.user
    });
    o.actual_qty = r2(actual); o.waste = r2(waste);
    o.theoretical = theo; o.theoretical_total = theoTot;
    o.actual_lines = consumed.map(c => ({ item_id: c.item_id, item_name: c.item_name, unit: c.unit, theo: c.theo, extra: c.extra, out: c.out, value: c.value }));
    o.raw_value = rawValue; o.unit_cost = unitCost;
    o.finished = { lot_id: lot.id, lot_no: lot.lot_no, qty: actual, expiry };
    o.close_note = String(b.note || '').trim();
    o.status = 'مكتملة';
    o.closed_by = ctx.user; o.closed_at = now(); o.updated_at = now();
    db.save(d);
    return { data: o };
  },

  lots() {
    const inv = require('./inventory-check');
    return { data: inv.finishedLots() };
  }
};

module.exports = Prod;
