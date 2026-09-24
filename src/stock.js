// مخزون أولي: دفعات LOT تدخل من تأكيد المشتريات (يستهلكها قسم المخزون لاحقاً)
const jstore = require('./jstore');
const System = require('./system');

const db = jstore('inventory.json', { seq: { lot: 1, lot_num: 1, mov: 1 }, lots: [], movements: [] });
const now = () => new Date().toISOString();

const Stock = {
  // إدخال دفعة مستلمة — تُستدعى من تأكيد المشتريات فقط
  receiveLot(o) {
    const d = db.load();
    const n = d.seq.lot_num++;
    const year = String(o.date || now()).slice(0, 4);
    const row = {
      id: d.seq.lot++,
      lot_no: System.formatNum('lot', { year, n }),
      item_id: o.item_id, item_name: o.item_name, unit: o.unit, supplier_id: o.supplier_id || null, supplier_name: o.supplier_name || '',
      qty: o.qty, cost_per_unit: o.cost,
      warehouse_id: o.warehouse_id, warehouse_name: o.warehouse_name,
      expiry: o.expiry, qc: o.qc || 'مقبولة',
      order_num: o.order_num || '', date: o.date || now().slice(0, 10),
      remaining: o.qty, backfilled: true,
      created_at: now()
    };
    d.lots.push(row);
    if (!Array.isArray(d.movements)) d.movements = [];
    if (!Number.isInteger(d.seq.mov) || d.seq.mov < 1) d.seq.mov = 1;
    d.movements.push({
      id: d.seq.mov++, at: now(), date: row.date,
      item_id: row.item_id, item_name: row.item_name, unit: row.unit, type: 'دخول',
      qty: row.qty, warehouse_from: '', warehouse_to: row.warehouse_name,
      lot_id: row.id, lot_no: row.lot_no, expiry: row.expiry || '',
      source: { kind: 'طلبية', num: row.order_num || 'افتتاحي' },
      user: o.user || 'النظام', note: ''
    });
    db.save(d);
    return row;
  },
  list() {
    const d = db.load();
    return { data: d.lots.slice().sort((a, b) => (a.id < b.id ? 1 : -1)) };
  }
};

module.exports = Stock;
