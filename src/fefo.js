// FEFO/FIFO الموحد — المصدر الوحيد لمنتقي الدفعات (يمنع انحراف المخزون عن الإنتاج)
// القاعدة: المرفوضة والمعلقة محجوبتان — الأقرب انتهاء أولاً — بلا تاريخ في الأخير
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
function err(msg, code) { throw Object.assign(new Error(msg), { code: code || 400 }); }

function effQc(lot) {
  if (!lot) return 'مقبولة';
  if (lot.qc_final) return lot.qc_final;
  if (lot.qc === 'تمرير استثنائي') return 'بانتظار المراجعة';
  return lot.qc || 'مقبولة';
}

function candidates(d, item_id, wh_id) {
  return (d.lots || [])
    .filter(l => l.item_id === Number(item_id) && l.warehouse_id === Number(wh_id) && Number(l.remaining || 0) > 0 && effQc(l) === 'مقبولة')
    .sort((a, b) => {
      const ea = a.expiry || '', eb = b.expiry || '';
      if (ea && eb && ea !== eb) return ea < eb ? -1 : 1;
      if (ea && !eb) return -1;
      if (!ea && eb) return 1;
      return a.id - b.id;
    });
}

function available(d, item_id, wh_id) {
  return r2(candidates(d, item_id, wh_id).reduce((s, l) => s + Number(l.remaining || 0), 0));
}

// يحسب الحصص دون تعديل (pure) — التعديل والحفظ مسؤولية المستدعي ضمن نفس المقطع المتزامن
function planTakes(d, item_id, wh_id, qty, item_name) {
  const cands = candidates(d, item_id, wh_id);
  const avail = r2(cands.reduce((s, l) => s + Number(l.remaining || 0), 0));
  if (Number(qty) > avail + 1e-9) err('الرصيد غير كافٍ لـ ' + (item_name || '') + ' (المتاح ' + avail + ')');
  let left = r2(Number(qty));
  const takes = [];
  for (const l of cands) {
    if (left <= 1e-9) break;
    const take = r2(Math.min(Number(l.remaining), left));
    if (take > 0) { takes.push({ lot: l, take }); left = r2(left - take); }
  }
  return takes;
}

module.exports = { effQc, candidates, available, planTakes, r2 };
