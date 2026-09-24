// التقارير: قراءة فقط — تجميع من الأقسام بلا تخزين (حد 2000 سطر)
// الملخص أولاً: إجماليات + الأعلى + التغير عن الفترة السابقة المماثلة
const Inv = require('./inventory');
const Proc = require('./procurement');
const Sales = require('./sales');
const Finance = require('./finance');
const Formulas = require('./formulas');
const mstore = require('./store');

const LIM = 2000;
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
function err(msg, code) { throw Object.assign(new Error(msg), { code: code || 400 }); }
function validRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) err('الفترة إلزامية: من/إلى بصيغة سنة-شهر-يوم');
  if (from > to) err('من أكبر من إلى');
  return { from, to };
}
function prevRange(from, to) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const pe = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const ps = new Date(Date.parse(pe) - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { from: ps, to: pe };
}
function pct(cur, prev) {
  if (!(prev > 0)) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}
function top(list, key, n) {
  const m = {};
  for (const r of list) {
    const k = r[key] || '—';
    m[k] = m[k] || { name: k, total: 0, count: 0 };
    m[k].total = r2(m[k].total + Number(r.total || r.amount || r.qty || 0));
    m[k].count++;
  }
  return Object.values(m).sort((a, b) => b.total - a.total).slice(0, n || 5);
}

const Rep = {
  stock(from, to) {
    validRange(from, to);
    const bal = Inv.balance().data;
    const movs = Inv.movements(from, to, '').data.slice(0, LIM);
    const d = require('./jstore')('inventory.json', { counts: [], wastes: [] }).load();
    return {
      data: {
        balance: bal,
        movements: movs,
        counts: (d.counts || []).filter(c => c.date >= from && c.date <= to),
        wastes: (d.wastes || []).filter(w => w.date >= from && w.date <= to && w.status === 'مؤكدة'),
        low: bal.filter(r => r.status !== 'normal'),
        expiring: Inv.lots().data.filter(l => Number(l.remaining || 0) > 0 && l.days_left !== null && l.days_left >= 0 && l.days_left <= 60),
        value: r2(bal.reduce((s, r) => s + Number(r.value || 0), 0))
      }
    };
  },

  procurement(from, to) {
    validRange(from, to);
    const all = Proc.listOrders().data;
    const rows = all.filter(o => o.date >= from && o.date <= to);
    const pr = prevRange(from, to);
    const prevRows = all.filter(o => o.date >= pr.from && o.date <= pr.to);
    const tot = r2(rows.reduce((s, o) => s + Number(o.total || 0), 0));
    const ptot = r2(prevRows.reduce((s, o) => s + Number(o.total || 0), 0));
    const bySup = {};
    for (const o of rows) {
      bySup[o.supplier_name] = bySup[o.supplier_name] || { name: o.supplier_name, total: 0, count: 0 };
      bySup[o.supplier_name].total = r2(bySup[o.supplier_name].total + Number(o.total || 0));
      bySup[o.supplier_name].count++;
    }
    // أسعار المواد عبر الزمن من التأكيدات
    const hist = [];
    const pd = require('./jstore')('procurement.json', { confirmations: [] }).load();
    for (const c of pd.confirmations || []) {
      if (c.arrival_date < from || c.arrival_date > to) continue;
      for (const l of c.lines || []) hist.push({ date: c.arrival_date, item: l.item_name, price: Number(l.price || 0), qty: Number(l.received_qty || 0), order: c.order_num });
    }
    hist.sort((a, b) => (a.date < b.date ? -1 : 1));
    return { data: { orders: rows.slice(0, LIM), bySupplier: Object.values(bySup), priceHistory: hist.slice(0, LIM), summary: { total: tot, count: rows.length, prevTotal: ptot, changePct: pct(tot, ptot) } } };
  },

  sales(from, to) {
    validRange(from, to);
    const all = Sales.listInvoices().data.filter(o => o.status === 'مؤكدة');
    const rows = all.filter(o => o.date >= from && o.date <= to);
    const pr = prevRange(from, to);
    const prevRows = all.filter(o => o.date >= pr.from && o.date <= pr.to);
    const tot = r2(rows.reduce((s, o) => s + Number(o.total || 0), 0));
    const ptot = r2(prevRows.reduce((s, o) => s + Number(o.total || 0), 0));
    const byCus = {}, byProd = {};
    for (const o of rows) {
      byCus[o.customer_name] = byCus[o.customer_name] || { name: o.customer_name, total: 0, count: 0 };
      byCus[o.customer_name].total = r2(byCus[o.customer_name].total + Number(o.total || 0));
      byCus[o.customer_name].count++;
      for (const l of o.lines || []) {
        byProd[l.item_name] = byProd[l.item_name] || { name: l.item_name, total: 0, qty: 0 };
        byProd[l.item_name].total = r2(byProd[l.item_name].total + Number(l.total || 0));
        byProd[l.item_name].qty = r2(byProd[l.item_name].qty + Number(l.qty || 0));
      }
    }
    const topProd = Object.values(byProd).sort((a, b) => b.qty - a.qty).slice(0, 5);
    return { data: { invoices: rows.slice(0, LIM), byCustomer: Object.values(byCus), byProduct: Object.values(byProd), top: topProd, summary: { total: tot, count: rows.length, prevTotal: ptot, changePct: pct(tot, ptot) } } };
  },

  finance(from, to) {
    validRange(from, to);
    const trial = Finance.trial(from, to).data;
    const cmp = Finance.compare().data;
    // التدفق النقدي من الدفتر: داخل الحسابات النقدية مقابل خارجها
    const J = Finance.journal(from, to).data;
    const accs = Finance.listAccounts().data.map(a => a.name);
    const days = {};
    for (const e of J) {
      const k = String(e.date);
      days[k] = days[k] || { date: k, in: 0, out: 0 };
      if (accs.includes(e.debit) && !accs.includes(e.credit)) days[k].in = r2(days[k].in + e.amount);
      else if (accs.includes(e.credit) && !accs.includes(e.debit)) days[k].out = r2(days[k].out + e.amount);
      else if (accs.includes(e.debit) && accs.includes(e.credit)) { days[k].in = r2(days[k].in + e.amount); days[k].out = r2(days[k].out + e.amount); }
    }
    const flow = Object.values(days).sort((a, b) => (a.date < b.date ? 1 : -1)).map(x => ({ ...x, net: r2(x.in - x.out) }));
    const tin = r2(flow.reduce((s, x) => s + x.in, 0));
    const tout = r2(flow.reduce((s, x) => s + x.out, 0));
    return { data: { trial, compare: cmp, cashflow: { days: flow, in: tin, out: tout, net: r2(tin - tout) } } };
  },

  statement(type, id) {
    if (type === 'supplier') return Proc.statement(null, Number(id));
    if (type === 'customer') return Sales.statement(null, Number(id));
    if (type === 'worker') {
      const md = mstore.load();
      const w = (md.workers || []).find(x => x.id === Number(id));
      if (!w) err('العامل غير موجود', 404);
      return { data: { worker: { id: w.id, name: w.name }, opening: Number(w.opening_balance || 0), type: w.opening_type || '', note: 'الرواتب والسلف التفصيلية في قسم الموظفين' } };
    }
    err('النوع: supplier / customer / worker');
  },

  production(from, to, aNum, bNum, overhead) {
    validRange(from, to);
    const pd = require('./jstore')('production.json', { orders: [] }).load();
    const rows = pd.orders.filter(o => o.date >= from && o.date <= to && o.status === 'مكتملة');
    const pr = prevRange(from, to);
    const prevRows = pd.orders.filter(o => o.date >= pr.from && o.date <= pr.to && o.status === 'مكتملة');
    const tot = r2(rows.reduce((s, o) => s + Number(o.actual_qty || 0), 0));
    const ptot = r2(prevRows.reduce((s, o) => s + Number(o.actual_qty || 0), 0));
    const byProd = {};
    let waste = 0, theo = 0;
    for (const o of rows) {
      byProd[o.product_name] = byProd[o.product_name] || { name: o.product_name, qty: 0, waste: 0 };
      byProd[o.product_name].qty = r2(byProd[o.product_name].qty + Number(o.actual_qty || 0));
      byProd[o.product_name].waste = r2(byProd[o.product_name].waste + Number(o.waste || 0));
      waste = r2(waste + Number(o.waste || 0));
      theo = r2(theo + Number(o.theoretical_total || 0));
    }
    let cmp = null;
    if (aNum && bNum) {
      const full = Formulas.costing(overhead === undefined ? 5 : Number(overhead));
      const a = full.data.find(f => f.num === String(aNum));
      const b = full.data.find(f => f.num === String(bNum));
      if (!a || !b) err('إحدى التركيبتين غير موجودة');
      const mats = [...new Set([...a.lines.map(l => l.item_name), ...b.lines.map(l => l.item_name)])];
      cmp = {
        a: { num: a.num, name: a.name, total: a.total, perQ: a.perQ },
        b: { num: b.num, name: b.name, total: b.total, perQ: b.perQ },
        cheaper: a.total <= b.total ? a.num : b.num,
        lines: mats.map(m => ({
          item: m,
          qa: Number((a.lines.find(l => l.item_name === m) || { qty: 0 }).qty),
          qb: Number((b.lines.find(l => l.item_name === m) || { qty: 0 }).qty)
        }))
      };
    }
    return { data: { orders: rows.slice(0, LIM), byProduct: Object.values(byProd), waste, wastePct: theo > 0 ? Math.round((waste / theo) * 1000) / 10 : 0, summary: { total: tot, count: rows.length, prevTotal: ptot, changePct: pct(tot, ptot) }, compare: cmp } };
  }
};

module.exports = Rep;
