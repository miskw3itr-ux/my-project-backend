// تركيبات الأعلاف: تكلفة حية بالقنطار من آخر أسعار الشراء + نسبة مصاريف
// قراءة فقط — لا تخزن التكلفة أبداً (تُحسب بتاريخ الطلب)
const mstore = require('./store');

const r2 = n => Math.round(Number(n || 0) * 100) / 100;

// إضافات التكلفة للقنطار (أكياس/نقل/أخرى): تُفعّل وتُعطّل فرادى وتُضاف بعد المصاريف
// الشكل: { bags: {on, amount}, transport: {on, amount}, other: {on, amount} } — المبالغ دج/قنطار
const ADDER_KEYS = ['bags', 'transport', 'other'];
function cleanAdders(a) {
  const out = {};
  for (const k of ADDER_KEYS) {
    const v = (a && a[k]) || {};
    const amount = Number(v.amount);
    out[k] = { on: v.on === true || v.on === 1 || v.on === '1', amount: r2(Number.isFinite(amount) && amount > 0 ? amount : 0) };
  }
  return out;
}

const Formulas = {
  ADDER_KEYS,
  costing(overheadPct, adders) {
    let oh = Number(overheadPct);
    if (!Number.isFinite(oh) || oh < 0) oh = 5;
    if (oh > 100) oh = 100;
    const ad = cleanAdders(adders);
    const extraPerQ = r2(ADDER_KEYS.reduce((s, k) => s + (ad[k].on ? ad[k].amount : 0), 0));
    const d = mstore.load();
    const prices = {};
    const names = {};
    for (const it of d.items) { prices[it.id] = Number(it.last_price || 0); names[it.id] = it.name; }
    const data = d.formulas_ref.map(f => {
      const comp = (d.formula_items || []).filter(x => x.formula_id === f.id);
      const lines = comp.map(c => {
        const price = Number(prices[c.item_id] ?? 0);
        return { item_id: c.item_id, item_name: c.item_name || names[c.item_id] || '—', qty: Number(c.qty || 0), unit: c.unit || '', price, line: r2(Number(c.qty || 0) * price) };
      });
      const materials = r2(lines.reduce((s, l) => s + l.line, 0));
      const ohAmt = r2(materials * oh / 100);
      const totQty = r2(lines.reduce((s, l) => s + Number(l.qty || 0), 0));
      const extra = r2(extraPerQ * totQty);
      const perQ = totQty > 0 ? r2((materials + ohAmt) / totQty) : 0;
      const finalPerQ = totQty > 0 ? r2((materials + ohAmt + extra) / totQty) : 0;
      const total = r2(materials + ohAmt + extra);
      return { id: f.id, num: f.num || '—', name: f.name, date: f.date || '', status: f.status || 'نشطة', note: f.note || '', parent_num: f.parent_num || null, product_id: f.product_id || null, items_count: lines.length, totQty, materials, overhead_pct: oh, overhead: ohAmt, extraPerQ, extra, total, perQ, finalPerQ, lines };
    }).sort((a, b) => (String(a.num) < String(b.num) ? 1 : -1));
    const act = data.filter(f => f.status === 'نشطة');
    const byQ = act.slice().sort((a, b) => a.finalPerQ - b.finalPerQ);
    let lastChg = null;
    for (const it of d.items) {
      if (it.price_updated_at && (!lastChg || it.price_updated_at > lastChg.at)) {
        lastChg = { at: it.price_updated_at, item: it.name, id: it.id };
      }
    }
    let affected = 0;
    if (lastChg) affected = data.filter(f => f.lines.some(l => l.item_id === lastChg.id)).length;
    return {
      data,
      kpi: {
        active: act.length,
        cheapest: byQ[0] ? { num: byQ[0].num, name: byQ[0].name, perQ: byQ[0].finalPerQ } : null,
        expensive: byQ.length ? { num: byQ[byQ.length - 1].num, name: byQ[byQ.length - 1].name, perQ: byQ[byQ.length - 1].finalPerQ } : null,
        avgQ: act.length ? r2(act.reduce((s, f) => s + f.finalPerQ, 0) / act.length) : 0,
        lastChange: lastChg ? { ...lastChg, at: String(lastChg.at).slice(0, 10), affected } : null
      },
      overhead: oh, at: new Date().toISOString().slice(0, 10), adders: ad, extraPerQ
    };
  }
};

module.exports = Formulas;
