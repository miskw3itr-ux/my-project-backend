// التتبع: قراءة فقط فوق اللوتات — أمامي (إلى أين ذهب) وخلفي (من أين جاء)
// خطافات الإنتاج/المبيعات جاهزة: children/produced_from تُملأ عند بناء القسمين 8 و9
const jstore = require('./jstore');
const Inv = require('./inventory');

const idb = jstore('inventory.json', { lots: [], movements: [] });
const pdb = jstore('procurement.json', { orders: [] });
const proddb = jstore('production.json', { orders: [] });
const sdb = jstore('sales.json', { invoices: [] });

function err(msg, code) { throw Object.assign(new Error(msg), { code: code || 400 }); }
function r2(n) { return Math.round(Number(n || 0) * 100) / 100; }

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

  // أمامي: الاستلام ← الفحص ← كل الحركات ← المتبقي ← الأبناء (إنتاج/بيع/تحويل)
  // يُبنى من الحركات المسجلة فقط — بلا حقول يدوية: خروج إنتاج→لوت تام، فاتورة→زبون، تحويل→لوت جديد
  forward(id) {
    const lot = this._lot(id);
    const allMovs = Inv.movements().data;
    const movs = allMovs.filter(m => m.lot_id === lot.id).sort((a, b) => (a.id < b.id ? 1 : -1));
    const outs = movs.filter(m => m.type === 'خروج');
    const children = [];
    const lots = Inv.lots().data;
    const porders = proddb.load().orders || [];
    const invoices = sdb.load().invoices || [];
    for (const m of outs) {
      const kind = m.source && m.source.kind;
      const num = m.source && m.source.num;
      const qty = Math.abs(Number(m.qty || 0));
      if (kind === 'إنتاج' && num) {
        const fins = lots.filter(l => String(l.order_num || '') === String(num));
        const o = porders.find(x => String(x.num) === String(num));
        children.push({ type: 'إنتاج', order_num: num, product: o ? o.product_name : (fins[0] ? fins[0].item_name : '—'), finished_lots: fins.map(l => l.lot_no), qty_taken: r2(qty) });
      } else if (kind === 'فاتورة' && num) {
        const inv = invoices.find(x => String(x.num) === String(num));
        children.push({ type: 'بيع', invoice_num: num, customer: inv ? inv.customer_name : '—', qty_taken: r2(qty) });
      } else if (kind === 'تحويل' && num) {
        const nl = lots.filter(l => String(l.lot_no || '').indexOf(lot.lot_no + '-T') === 0);
        children.push({ type: 'تحويل', transfer_num: num, new_lots: nl.map(l => l.lot_no + ' ← ' + (l.warehouse_name || '')), qty_taken: r2(qty) });
      }
    }
    return { data: { lot, timeline: movs, children } };
  },

  // خلفي: الطلبية والمورد وتاريخ الاستلام والفحص المخبري + مكونات المنتج التام
  backward(id) {
    const lot = this._lot(id);
    const orders = pdb.load().orders || [];
    const order = orders.find(o => o.num === lot.order_num) || null;
    const produced_from = [];
    // لوت تام من أمر إنتاج: المواد المستهلكة من حركات الخروج المرتبطة بالأمر
    if (/^OF-/i.test(String(lot.order_num || ''))) {
      const allMovs = Inv.movements().data;
      const used = allMovs.filter(m => m.type === 'خروج' && m.source && m.source.kind === 'إنتاج' && String(m.source.num || '') === String(lot.order_num || ''));
      const byLot = {};
      for (const m of used) {
        const k = m.lot_id;
        byLot[k] = byLot[k] || { lot_no: m.lot_no || '', item_name: m.item_name || '', qty_taken: 0 };
        byLot[k].qty_taken = r2(byLot[k].qty_taken + Math.abs(Number(m.qty || 0)));
      }
      const porders = proddb.load().orders || [];
      const o = porders.find(x => String(x.num) === String(lot.order_num || ''));
      for (const k of Object.keys(byLot)) produced_from.push(Object.assign({ order_num: lot.order_num, product: o ? o.product_name : lot.item_name }, byLot[k]));
    }
    // لوت محوَّل: الأب هو اللوت صاحب البادئة قبل ‎-T
    const mT = String(lot.lot_no || '').match(/^(.*)-T\d+$/);
    if (mT) {
      const parent = Inv.lots().data.find(l => String(l.lot_no || '') === mT[1]);
      if (parent) produced_from.push({ type: 'تحويل', lot_no: parent.lot_no, item_name: parent.item_name, qty_taken: r2(Number(lot.qty || 0)) });
    }
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
        produced_from
      }
    };
  }
};

module.exports = Trace;
