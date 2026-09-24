// صرف مشترك FEFO: يخدم الإنتاج (والمبيعات لاحقاً) — تحقق ثم استهلاك ذري
// يستعمل المنتقي الموحد من fefo.js (المصدر الوحيد) لمنع الانحراف عن المخزون
// السحب الإنتاجي يعبر كل مخازن المواد الأولية (FEFO شامل) — بلا مخزن مصدر محدد
const jstore = require('./jstore');
const Fefo = require('./fefo');

const db = jstore('inventory.json', {
  seq: { lot: 1, lot_num: 1, mov: 1, count: 1, count_num: 1, waste: 1, transfer_num: 1 },
  lots: [], movements: [], counts: [], wastes: []
});
const now = () => new Date().toISOString();
const r2 = n => Math.round(Number(n || 0) * 100) / 100;

function err(msg, code) { throw Object.assign(new Error(msg), { code: code || 400 }); }
function load() {
  const d = db.load();
  if (!Array.isArray(d.lots)) d.lots = [];
  if (!Array.isArray(d.movements)) d.movements = [];
  d.seq = d.seq || {};
  for (const k of ['lot', 'lot_num', 'mov']) if (!Number.isInteger(d.seq[k]) || d.seq[k] < 1) d.seq[k] = 1;
  for (const l of d.lots) if (l.remaining === undefined || l.remaining === null) l.remaining = r2(l.qty);
  return d;
}
function effQc(lot) { return Fefo.effQc(lot); }
function candidates(d, item_id, wh_id) { return Fefo.candidates(d, item_id, wh_id); }
// معيار المصنع: 2 كيس لكل قنطار مباع — يُخصم من مخازن الخام عند تأكيد البيع
const BAGS_PER_Q = 2;
// صنف الأكياس المعتمد: أول صنف تغليف نشط، وإلا أول صنف وحدة باسم كيس/أكياس (غير تام)
// عند التكرار يُفضَّل صاحب الرصيد — حتى لا يخصم البيع من بطاقة فارغة والمخزون في شقيقتها
function bagsItem() {
  try {
    const md = require('./store').load();
    const items = md.items || [], cats = md.categories || [];
    const isPack = i => i.status !== 'متوقفة' && cats.some(c => String(c.id) === String(i.category_id) && c.main === 'تعبئة وتغليف');
    const isBagLike = i => i.status !== 'متوقفة' && i.unit === 'وحدة' && /كيس|اكياس|شكارة/i.test(i.name || '')
      && !cats.some(c => String(c.id) === String(i.category_id) && c.main === 'منتج نهائي');
    const cands = items.filter(i => isPack(i)) ;
    const pool = cands.length ? cands : items.filter(i => isBagLike(i));
    if (!pool.length) return null;
    let inv = null;
    try { inv = require('./jstore')('inventory.json', { lots: [] }).load(); } catch { inv = { lots: [] }; }
    const stockOf = id => (inv.lots || []).filter(l => Number(l.item_id) === Number(id)).reduce((s, l) => s + Number(l.remaining || 0), 0);
    pool.sort((a, b) => stockOf(b.id) - stockOf(a.id));
    return pool[0];
  } catch { return null; }
}
// مخازن مؤهلة للسحب حسب النوع (الإنتاج: خام — البيع: تام)
function whIdsByTypes(types) {
  try {
    const md = require('./store').load();
    const want = types || ['مواد أولية'];
    return new Set((md.warehouses || []).filter(w => want.includes(w.type)).map(w => w.id));
  } catch { return new Set(); }
}
// مخازن الخام المؤهلة كمصدر للسحب الإنتاجي
function rawWhIds() { return whIdsByTypes(['مواد أولية']); }
// مرشحو FEFO عبر مخازن من نوع معين: الأقرب انتهاء أولاً ثم الأقدم
function candidatesAll(d, item_id, types) {
  const ids = whIdsByTypes(types || ['مواد أولية']);
  return (d.lots || [])
    .filter(l => l.item_id === Number(item_id) && ids.has(l.warehouse_id) && Number(l.remaining || 0) > 0 && effQc(l) === 'مقبولة')
    .sort((a, b) => {
      const ea = a.expiry || '', eb = b.expiry || '';
      if (ea && eb && ea !== eb) return ea < eb ? -1 : 1;
      if (ea && !eb) return -1;
      if (!ea && eb) return 1;
      if (a.warehouse_id !== b.warehouse_id) return a.warehouse_id - b.warehouse_id;
      return a.id - b.id;
    });
}

const Issue = {
  // فحص التوفر فقط — needs: [{item_id, qty, item_name?}]
  check(wh_id, needs, label) {
    const d = load();
    const md = require('./store').load();
    for (const n of needs || []) {
      const it = (md.items || []).find(x => x.id === Number(n.item_id)) || {};
      const avail = r2(candidates(d, n.item_id, wh_id).reduce((s, l) => s + Number(l.remaining || 0), 0));
      if (Number(n.qty || 0) > avail + 1e-9) {
        err('(' + (label || 'الصرف') + ') رصيد ' + (it.name || n.item_name || '') + ' غير كافٍ — المتاح ' + avail);
      }
    }
    return { ok: true };
  },
  // صرف فعلي FEFO مع التقييم — needs: [{item_id, item_name?, unit?, qty, theo?}]
  // يرجع: [{item_id, item_name, unit, theo, extra, out, value}] ويحفظ الحركات
  consume(wh_id, needs, source, user, note) {
    return this._consume(candidates, wh_id, needs, source, user, note);
  },
  // صرف شامل مخازن من نوع معين — نفس المخرجات، والمصدر من كل لوت يُسجل في حركته
  consumeMulti(needs, source, user, note, types) {
    return this._consume((d, item_id) => candidatesAll(d, item_id, types), null, needs, source, user, note);
  },
  _consume(candsFn, wh_id, needs, source, user, note) {
    const d = load();
    const md = require('./store').load();
    const out = [];
    for (const n of needs || []) {
      const it = (md.items || []).find(x => x.id === Number(n.item_id)) || {};
      const cands = candsFn(d, n.item_id, wh_id);
      const avail = r2(cands.reduce((s, l) => s + Number(l.remaining || 0), 0));
      const need = r2(Number(n.qty || 0));
      if (need > avail + 1e-9) err('رصيد ' + (it.name || '') + ' غير كافٍ (المتاح ' + avail + ')');
      let left = need, value = 0;
      const perLot = [];
      for (const l of cands) {
        if (left <= 1e-9) break;
        const take = r2(Math.min(Number(l.remaining), left));
        if (take <= 0) continue;
        l.remaining = r2(Number(l.remaining) - take);
        value = r2(value + take * Number(l.cost_per_unit || 0));
        perLot.push({ lot: l, take });
        left = r2(left - take);
      }
      for (const { lot, take } of perLot) {
        if (!Number.isInteger(d.seq.mov) || d.seq.mov < 1) d.seq.mov = 1;
        d.movements.push({
          id: d.seq.mov++, at: now(), date: now().slice(0, 10),
          item_id: Number(n.item_id), item_name: it.name || n.item_name || '', unit: it.unit || n.unit || '',
          type: 'خروج', qty: -take,
          warehouse_from: lot.warehouse_name || '', warehouse_to: '',
          lot_id: lot.id, lot_no: lot.lot_no, expiry: lot.expiry || '',
          source: source || {}, user: user || '', note: note || ''
        });
      }
      const theo = Number(n.theo !== undefined ? n.theo : need);
      out.push({ item_id: Number(n.item_id), item_name: it.name || n.item_name || '', unit: it.unit || n.unit || '', theo: r2(theo), extra: r2(need - theo), out: need, value });
    }
    db.save(d);
    return out;
  },
  // خصم مرن حتى المتاح (لا يرمي عند النقص — يُرجع الناقص للتحذير بدل منع عملية حقيقية)
  // يُستعمل لأكياس البيع: المنتج مغلّف فعلياً، فمنع البيع لنقص رقمي يعاقب خطأ البيانات لا الواقع
  consumeUpTo(item_id, qty, source, user, note, types) {
    const d = load();
    const md = require('./store').load();
    const it = (md.items || []).find(x => x.id === Number(item_id)) || {};
    const cands = candidatesAll(d, item_id, types || ['مواد أولية']);
    let left = r2(Number(qty || 0)), took = 0;
    const perLot = [];
    for (const l of cands) {
      if (left <= 1e-9) break;
      const take = r2(Math.min(Number(l.remaining), left));
      if (take <= 0) continue;
      l.remaining = r2(Number(l.remaining) - take);
      perLot.push({ lot: l, take }); left = r2(left - take); took = r2(took + take);
    }
    for (const { lot, take } of perLot) {
      if (!Number.isInteger(d.seq.mov) || d.seq.mov < 1) d.seq.mov = 1;
      d.movements.push({
        id: d.seq.mov++, at: now(), date: now().slice(0, 10),
        item_id: Number(item_id), item_name: it.name || '', unit: it.unit || '',
        type: 'خروج', qty: -take,
        warehouse_from: lot.warehouse_name || '', warehouse_to: '',
        lot_id: lot.id, lot_no: lot.lot_no, expiry: lot.expiry || '',
        source: source || {}, user: user || '', note: note || ''
      });
    }
    db.save(d);
    return { took, shortfall: r2(Number(qty || 0) - took) };
  },
  // فحص التوفر الشامل لمخازن من نوع معين — needs: [{item_id, qty, item_name?}]
  checkMulti(needs, label, types) {
    const d = load();
    const md = require('./store').load();
    for (const n of needs || []) {
      const it = (md.items || []).find(x => x.id === Number(n.item_id)) || {};
      const avail = r2(candidatesAll(d, n.item_id, types).reduce((s, l) => s + Number(l.remaining || 0), 0));
      if (Number(n.qty || 0) > avail + 1e-9) {
        err('(' + (label || 'الصرف') + ') رصيد ' + (it.name || n.item_name || '') + ' غير كافٍ في المخازن — المتاح ' + avail);
      }
    }
    return { ok: true };
  },
  // لوتات المنتج التام (أوامر OF) للعرض
  finishedLots() {
    const d = load();
    return d.lots
      .filter(l => String(l.order_num || '').startsWith('OF-'))
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .map(l => ({ ...l, remaining: r2(Number(l.remaining ?? l.qty ?? 0)), value: r2(Number(l.remaining ?? l.qty ?? 0) * Number(l.cost_per_unit || 0)) }));
  }
};

module.exports = Issue;
module.exports.BAGS_PER_Q = BAGS_PER_Q;
module.exports.bagsItem = bagsItem;
