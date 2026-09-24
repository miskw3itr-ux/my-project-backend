// التتبع: قراءة فقط فوق اللوتات — أمامي (إلى أين ذهب) وخلفي (من أين جاء)
// خطافات الإنتاج/المبيعات جاهزة: children/produced_from تُملأ عند بناء القسمين 8 و9
const jstore = require('./jstore');
const Inv = require('./inventory');

const idb = jstore('inventory.json', { lots: [], movements: [] });
const pdb = jstore('procurement.json', { orders: [] });

function err(msg, code) { throw Object.assign(new Error(msg), { code: code || 400 }); }

const Trace = {
  kpi() {
    const lots = Inv.lots().data;
    const movs = Inv.movements().data;
    const active = lots.filter(l => Number(l.remaining || 0) > 0);
    const blocked = lots.filter(l => ['مرفوضة', 'بانتظار المراجعة'].includes(l.qc_final));
    const expiring = active.filter(l => l.days_left !== null && l.days_left !== undefined && l.days_left >= 0 && l.days_left <= 60);
    const last = movs[0] || null;
    return {
      data: {
        active: active.length,
        blocked: blocked.length,
        expiring: expiring.length,
        value: Math.round(active.reduce((s, l) => s + Number(l.remaining || 0) * Number(l.cost_per_unit || 0), 0) * 100) / 100,
        lastMove: last ? { lot: last.lot_no, type: last.type, at: String(last.at || '').slice(0, 16).replace('T', ' ') } : null
      }
    };
  },

  lots() { return Inv.lots(); },

  _lot(id) {
    const lot = Inv.lots().data.find(x => x.id === Number(id));
    if (!lot) err('الدفعة غير موجودة', 404);
    return lot;
  },

  // أمامي: الاستلام ← الفحص ← كل الحركات ← المتبقي (← الإنتاج/المبيعات لاحقاً)
  forward(id) {
    const lot = this._lot(id);
    const movs = Inv.movements().data.filter(m => m.lot_id === lot.id).sort((a, b) => (a.id < b.id ? 1 : -1));
    return { data: { lot, timeline: movs, children: [] } };
  },

  // خلفي: الطلبية والمورد وتاريخ الاستلام والفحص المخبري
  backward(id) {
    const lot = this._lot(id);
    const orders = pdb.load().orders || [];
    const order = orders.find(o => o.num === lot.order_num) || null;
    return {
      data: {
        lot,
        origin: {
          order_num: lot.order_num || '—',
          order_date: order ? order.date : '',
          supplier: lot.supplier_name || (order ? order.supplier_name : '—'),
          received: lot.date || '',
          qc_initial: lot.qc || '—',
          lab: lot.lab || null
        },
        produced_from: []
      }
    };
  }
};

module.exports = Trace;
