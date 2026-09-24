// الجودة: سجل فحص فوق دفعات الاستلام — قبول/رفض + قياسات مخبرية
// لا يغير منطق المشتريات: التمرير الاستثنائي يدخل طابور المراجعة، والمقبولة قابلة للتوثيق المخبري
const jstore = require('./jstore');
const Auth = require('./auth');

const db = jstore('inventory.json', { seq: { lot: 1, lot_num: 1, mov: 1 }, lots: [], movements: [] });
const now = () => new Date().toISOString();
const r2 = n => Math.round(Number(n || 0) * 100) / 100;

function err(msg, code) { throw Object.assign(new Error(msg), { code: code || 400 }); }
function num(v, field) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) err((field || 'القياس') + ': رقم غير صالح');
  return Math.round(n * 100) / 100;
}
function view(lot) {
  const pending = lot.qc === 'تمرير استثنائي' && !lot.qc_final;
  return { ...lot, qc_final: lot.qc_final || (pending ? 'بانتظار المراجعة' : lot.qc || 'مقبولة') };
}

const Quality = {
  list(status) {
    const d = db.load();
    let rows = d.lots.map(view).sort((a, b) => (a.id < b.id ? 1 : -1));
    if (status === 'pending') rows = rows.filter(r => r.qc_final === 'بانتظار المراجعة');
    if (status === 'accepted') rows = rows.filter(r => r.qc_final === 'مقبولة');
    if (status === 'rejected') rows = rows.filter(r => r.qc_final === 'مرفوضة');
    return { data: rows };
  },
  kpi() {
    const d = db.load();
    const rows = d.lots.map(view);
    const rej = rows.filter(r => r.qc_final === 'مرفوضة').length;
    const decided = rows.filter(r => r.lab).slice().sort((a, b) => (a.lab.at < b.lab.at ? 1 : -1))[0];
    return {
      data: {
        pending: rows.filter(r => r.qc_final === 'بانتظار المراجعة').length,
        accepted: rows.filter(r => r.qc_final === 'مقبولة').length,
        rejected: rej,
        rejectRate: rows.length ? Math.round((rej / rows.length) * 1000) / 10 : 0,
        last: decided ? { lot: decided.lot_no, at: decided.lab.at.slice(0, 10), by: decided.lab.by } : null
      }
    };
  },
  decide(b, ctx) {
    if (!Auth.can(ctx.role, 'quality', 'decide')) err('قرارات الجودة: المدير أو أمين المخزن فقط', 403);
    const d = db.load();
    const lot = d.lots.find(x => x.id === Number(b.lot_id));
    if (!lot) err('الدفعة غير موجودة', 404);
    if (lot.qc_final) err('تم البت في هذه الدفعة مسبقاً (' + lot.qc_final + ')');
    if (b.decision !== 'قبول' && b.decision !== 'رفض') err('القرار: قبول أو رفض');
    const note = String(b.note || '').trim();
    if (b.decision === 'رفض' && !note) err('سبب الرفض إلزامي');
    lot.lab = {
      humidity: num(b.humidity, 'الرطوبة'), protein: num(b.protein, 'البروتين'), impurities: num(b.impurities, 'الشوائب'),
      note, by: String(b.by || ctx.user).trim(), at: now()
    };
    lot.qc_final = b.decision === 'قبول' ? 'مقبولة' : 'مرفوضة';
    // حجب مخزني ومالي عند الرفض: تصفير المتبقي + حركة حجب + قيد دائن يعكس القيمة
    if (lot.qc_final === 'مرفوضة') {
      const blocked = r2(Number(lot.remaining ?? lot.qty) || 0);
      lot.remaining = 0;
      lot.blocked_qty = blocked;
      lot.blocked_at = now();
      lot.blocked_by = ctx.user;
      d.seq = d.seq || {};
      if (!Number.isInteger(d.seq.mov) || d.seq.mov < 1) d.seq.mov = (d.movements || []).length + 1;
      d.movements = d.movements || [];
      d.movements.push({
        id: d.seq.mov++, at: now(), date: now().slice(0, 10),
        item_id: lot.item_id, item_name: lot.item_name, unit: lot.unit, type: 'حجب جودة',
        qty: blocked, warehouse_from: lot.warehouse_name || '', warehouse_to: '',
        lot_id: lot.id, lot_no: lot.lot_no, expiry: lot.expiry || '',
        source: { kind: 'جودة', num: lot.lot_no }, user: ctx.user,
        note: 'رفض جودة — ' + note
      });
      try {
        const Finance = require('./finance');
        const val = r2(blocked * Number(lot.cost_per_unit || 0));
        if (val > 0) Finance.addPayable({
          order_id: null, order_num: lot.order_num || lot.lot_no,
          supplier_id: lot.supplier_id || null, supplier_name: lot.supplier_name || '',
          amount: -val, date: now().slice(0, 10), note: 'عكس رفض جودة ' + lot.lot_no + ' — ' + note
        });
      } catch (e) {}
    }
    db.save(d);
    return { data: view(lot) };
  }
};

module.exports = Quality;
