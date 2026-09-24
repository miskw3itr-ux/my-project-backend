// منطق البيانات الأساسية + القواعد التشغيلية المقفلة
const store = require('./store');

const CAN_MATERIAL = ['admin', 'storekeeper']; // مدير عام + مدير مخزون
const CAN_OPENING = ['admin', 'accountant'];   // مدير عام + محاسب
const UNITS = ['كغ', 'قنطار', 'طن', 'وحدة'];
const MAIN_CATS = ['مواد أولية', 'منتج نهائي', 'تعبئة وتغليف'];

const now = () => new Date().toISOString();
const hasText = v => typeof v === 'string' && v.trim().length > 0;
// تطبيع للمطابقة: تقليص المسافات وتوحيد الهمزات (العرض الأصلي محفوظ)
function normSub(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').replace(/[أإآ]/g, 'ا');
}
// إيجاد تصنيف مطابق أو إنشاؤه — الجدول الصامت خلف نموذج المادة
function resolveCategory(d, main, sub, ctx) {
  if (!MAIN_CATS.includes(main)) throw Object.assign(new Error('التصنيف الرئيسي يجب أن يكون: ' + MAIN_CATS.join(' / ')), { code: 400 });
  if (!hasText(sub)) throw Object.assign(new Error('التصنيف الفرعي مطلوب'), { code: 400 });
  const key = normSub(sub);
  let c = d.categories.find(x => x.main === main && normSub(x.sub) === key);
  if (!c) {
    c = { id: d.seq.category++, main, sub: String(sub).trim().replace(/\s+/g, ' '), active: true, created_at: now(), updated_at: now() };
    d.categories.push(c);
    audit(d, 'add', 'category', c.id, (ctx && ctx.user) || 'system', (ctx && ctx.role) || 'admin');
  }
  return c;
}

// تحويل أرقام متسامح: يقبل الأرقام العربية ٠-٩ والفارسية ٠-۹ والفواصل والمسافات
// يرمي خطأ 400 بدل تخزين NaN/null عند إدخال غير صالح
function toNum(v, field) {
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim();
  if (s === '') return 0;
  s = s.replace(/[٠-٩]/g, ch => '٠١٢٣٤٥٦٧٨٩'.indexOf(ch))
       .replace(/[۰-۹]/g, ch => '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch))
       .replace(/[\s  ']/g, '')
       .replace(/٬/g, '')
       .replace(/[٫,]/g, '.');
  const parts = s.split('.');
  if (parts.length > 2) s = parts.shift() + '.' + parts.join('');
  const n = Number(s);
  if (!Number.isFinite(n)) throw Object.assign(new Error((field || 'الرقم') + ': رقم غير صالح'), { code: 400 });
  return n;
}

// الهاتف: أرقام فقط (فارغ مسموح) — مع تحويل الأرقام العربية والفارسية
function checkPhone(p) {
  let s = String(p || '').trim();
  s = s.replace(/[٠-٩]/g, ch => '٠١٢٣٤٥٦٧٨٩'.indexOf(ch)).replace(/[۰-۹]/g, ch => '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch));
  if (s !== '' && !/^[0-9]+$/.test(s)) throw Object.assign(new Error('الهاتف: أرقام فقط'), { code: 400 });
  return s;
}

// وظائف العمال المقفلة — نفس قائمة تبويب العمال
const WORKER_JOBS = ['مدير', 'مقتصد', 'حارس', 'سائق شاحنة', 'منتج', 'عامل'];
function validJob(j) {
  const s = String(j || '').trim();
  if (!WORKER_JOBS.includes(s)) throw Object.assign(new Error('الوظيفة يجب أن تكون: ' + WORKER_JOBS.join(' / ')), { code: 400 });
  return s;
}

function audit(d, action, entity, ref_id, by, role) {
  d.audit.push({ id: d.seq.audit++, action, entity, ref_id, by: by || 'admin', role: role || 'admin', at: now() });
  if (d.audit.length > 500) d.audit = d.audit.slice(-500);
}
function lastMod(d) {
  if (!d.audit.length) return null;
  const a = d.audit[d.audit.length - 1];
  return a.at;
}

// ترتيب الإدخال الإلزامي: تصنيفات ← مواد ← (موردون/زبائن/عمال) ← مخازن
function orderStatus(d) {
  return {
    hasCategories: d.categories.length > 0,
    hasItems: d.items.length > 0,
    hasPartners: (d.suppliers.length + d.customers.length + d.workers.length) > 0,
    hasWarehouses: d.warehouses.length >= 2
  };
}

const Master = {
  UNITS,
  MAIN_CATS,
  CAN_MATERIAL,
  CAN_OPENING,

  kpi() {
    const d = store.load();
    const pick = (arr) => (arr.length ? arr[arr.length - 1] : null);
    const ls = pick(d.suppliers), lc = pick(d.customers), li = pick(d.items);
    return {
      data: {
        last_supplier: ls ? { id: ls.id, name: ls.name, at: ls.created_at } : null,
        last_customer: lc ? { id: lc.id, name: lc.name, at: lc.created_at } : null,
        last_item: li ? { id: li.id, name: li.name, code: li.code, at: li.created_at } : null,
        last_mod: lastMod(d),
        totals: {
          items_active: d.items.filter(x => x.status === 'نشطة').length,
          suppliers_active: d.suppliers.filter(x => x.active !== false).length,
          customers_active: d.customers.filter(x => x.active !== false).length
        },
        order: orderStatus(d)
      }
    };
  },

  list(name) {
    const d = store.load();
    return { data: d[name] || [] };
  },

  // ---- تصنيفات ----
  addCategory(b, ctx) {
    if (!CAN_MATERIAL.includes(ctx.role)) throw Object.assign(new Error('صلاحية بطاقة المادة والتصنيفات: مدير المخزون أو المدير العام فقط'), { code: 403 });
    if (!MAIN_CATS.includes(b.main)) throw Object.assign(new Error('التصنيف الرئيسي يجب أن يكون: ' + MAIN_CATS.join(' / ')), { code: 400 });
    if (!hasText(b.sub)) throw Object.assign(new Error('التصنيف الفرعي مطلوب'), { code: 400 });
    const d = store.load();
    if (d.categories.some(c => c.main === b.main && c.sub.trim() === b.sub.trim())) throw Object.assign(new Error('هذا التصنيف موجود مسبقاً'), { code: 400 });
    const row = { id: d.seq.category++, main: b.main, sub: b.sub.trim(), active: true, created_at: now(), updated_at: now() };
    d.categories.push(row);
    audit(d, 'add', 'category', row.id, ctx.user, ctx.role);
    store.save(d);
    return { data: row };
  },
  updateCategory(id, b, ctx) {
    if (!CAN_MATERIAL.includes(ctx.role)) throw Object.assign(new Error('صلاحية التصنيفات: مدير المخزون أو المدير العام فقط'), { code: 403 });
    const d = store.load();
    const r = d.categories.find(x => x.id === id);
    if (!r) throw Object.assign(new Error('التصنيف غير موجود'), { code: 404 });
    if (b.main && !MAIN_CATS.includes(b.main)) throw Object.assign(new Error('تصنيف رئيسي غير صالح'), { code: 400 });
    if (b.main) r.main = b.main;
    if (b.sub !== undefined) { if (!hasText(b.sub)) throw Object.assign(new Error('التصنيف الفرعي مطلوب'), { code: 400 }); r.sub = b.sub.trim(); }
    r.updated_at = now();
    audit(d, 'update', 'category', id, ctx.user, ctx.role);
    store.save(d);
    return { data: r };
  },
  deleteCategory(id, ctx) {
    if (!CAN_MATERIAL.includes(ctx.role)) throw Object.assign(new Error('صلاحية التصنيفات: مدير المخزون أو المدير العام فقط'), { code: 403 });
    const d = store.load();
    if (d.items.some(i => i.category_id === id)) throw Object.assign(new Error('ممنوع الحذف: توجد مواد مرتبطة بهذا التصنيف'), { code: 400 });
    const i = d.categories.findIndex(x => x.id === id);
    if (i < 0) throw Object.assign(new Error('التصنيف غير موجود'), { code: 404 });
    d.categories.splice(i, 1);
    audit(d, 'delete', 'category', id, ctx.user, ctx.role);
    store.save(d);
    return { ok: true };
  },

  // ---- مواد أولية ----
  addItem(b, ctx) {
    if (!CAN_MATERIAL.includes(ctx.role)) throw Object.assign(new Error('صلاحية بطاقة المادة: مدير المخزون أو المدير العام فقط'), { code: 403 });
    const d = store.load();
    if (!hasText(b.code) || !hasText(b.name)) throw Object.assign(new Error('كود المادة واسم المادة مطلوبان'), { code: 400 });
    if (!UNITS.includes(b.unit)) throw Object.assign(new Error('الوحدة يجب أن تكون: ' + UNITS.join(' / ')), { code: 400 });
    let catId;
    if (b.category_id !== undefined && b.category_id !== '' && b.category_id !== null) {
      if (!d.categories.some(c => c.id === Number(b.category_id))) throw Object.assign(new Error('التصنيف غير موجود'), { code: 400 });
      catId = Number(b.category_id);
    } else {
      if (b.cat_main === undefined) throw Object.assign(new Error('التصنيف مطلوب (رئيسي + فرعي)'), { code: 400 });
      catId = resolveCategory(d, b.cat_main, b.cat_sub, ctx).id;
    }
    if (d.items.some(i => i.code.trim() === b.code.trim())) throw Object.assign(new Error('كود المادة مكرر'), { code: 400 });
    const row = {
      id: d.seq.item++, code: b.code.trim(), name: b.name.trim(),
      category_id: catId, unit: b.unit,
      min_stock: toNum(b.min_stock, 'الحد الأدنى'), last_price: toNum(b.last_price, 'آخر سعر شراء'),
      status: b.status === 'متوقفة' ? 'متوقفة' : 'نشطة', price_updated_at: now(),
      created_at: now(), updated_at: now()
    };
    d.items.push(row);
    audit(d, 'add', 'item', row.id, ctx.user, ctx.role);
    store.save(d);
    return { data: row };
  },
  updateItem(id, b, ctx) {
    if (!CAN_MATERIAL.includes(ctx.role)) throw Object.assign(new Error('صلاحية بطاقة المادة: مدير المخزون أو المدير العام فقط'), { code: 403 });
    const d = store.load();
    const r = d.items.find(x => x.id === id);
    if (!r) throw Object.assign(new Error('المادة غير موجودة'), { code: 404 });
    if (b.code && b.code.trim() !== r.code && d.items.some(i => i.code.trim() === b.code.trim())) throw Object.assign(new Error('كود المادة مكرر'), { code: 400 });
    if (b.code !== undefined) r.code = String(b.code).trim();
    if (b.name !== undefined) { if (!hasText(b.name)) throw Object.assign(new Error('اسم المادة مطلوب'), { code: 400 }); r.name = b.name.trim(); }
    if (b.category_id !== undefined && b.category_id !== '' && b.category_id !== null) {
      if (!d.categories.some(c => c.id === Number(b.category_id))) throw Object.assign(new Error('التصنيف غير موجود'), { code: 400 });
      r.category_id = Number(b.category_id);
    } else if (b.cat_main !== undefined) {
      r.category_id = resolveCategory(d, b.cat_main, b.cat_sub, ctx).id;
    }
    if (b.unit !== undefined) { if (!UNITS.includes(b.unit)) throw Object.assign(new Error('وحدة غير صالحة'), { code: 400 }); r.unit = b.unit; }
    if (b.min_stock !== undefined) r.min_stock = toNum(b.min_stock, 'الحد الأدنى');
    if (b.last_price !== undefined) {
      const np = toNum(b.last_price, 'آخر سعر شراء');
      if (np !== Number(r.last_price || 0)) r.price_updated_at = now();
      r.last_price = np;
    }
    if (b.status !== undefined) r.status = b.status === 'متوقفة' ? 'متوقفة' : 'نشطة';
    r.updated_at = now();
    audit(d, 'update', 'item', id, ctx.user, ctx.role);
    store.save(d);
    return { data: r };
  },
  deleteItem(id, ctx) {
    if (!CAN_MATERIAL.includes(ctx.role)) throw Object.assign(new Error('صلاحية بطاقة المادة: مدير المخزون أو المدير العام فقط'), { code: 403 });
    const d = store.load();
    const i = d.items.findIndex(x => x.id === id);
    if (i < 0) throw Object.assign(new Error('المادة غير موجودة'), { code: 404 });
    // قاعدة: لا حذف لمادة لها رصيد/حركة مرتبطة — نفحص سجل الأرصدة والمخازن حالياً (وتتوسع للمشتريات/الإنتاج لاحقاً)
    const linked = d.opening_log.some(o => o.entity === 'item' && o.ref_id === id);
    if (linked) throw Object.assign(new Error('ممنوع الحذف: للمادة رصيد أو حركة مرتبطة — أوقفها بدل الحذف'), { code: 400 });
    d.items.splice(i, 1);
    audit(d, 'delete', 'item', id, ctx.user, ctx.role);
    store.save(d);
    return { ok: true };
  },

  // ---- جهات: موردون/زبائن/عمال (الرصيد الافتتاحي مرة واحدة ويقفل) ----
  _addParty(col, logEntity, b, ctx) {
    const d = store.load();
    if (!hasText(b.name)) throw Object.assign(new Error('الاسم مطلوب'), { code: 400 });
    const openField = col === 'workers' ? 'opening_balance' : 'opening_debt';
    const row = {
      id: d.seq[col === 'suppliers' ? 'supplier' : col === 'customers' ? 'customer' : 'worker']++,
      name: b.name.trim(), phone: checkPhone(b.phone), address: (b.address || '').trim(),
      active: true, created_at: now(), updated_at: now()
    };
    if (col === 'workers') {
      row.opening_balance = toNum(b.opening_balance, 'الرصيد الافتتاحي');
      row.opening_type = b.opening_type === 'سلفة على العامل' ? 'سلفة على العامل' : 'مستحق للعامل';
      row.job = (b.job === undefined || b.job === '') ? 'عامل' : validJob(b.job);
    } else {
      row.opening_debt = toNum(b.opening_debt, 'الدين الافتتاحي');
    }
    row.opening_locked = true; // يقفل فور الإدخال
    d[col].push(row);
    const amt = col === 'workers' ? row.opening_balance : row.opening_debt;
    if (amt) {
      d.opening_log.push({
        id: d.seq.opening++, entity: logEntity, ref_id: row.id, ref_name: row.name,
        amount: amt, extra: row.opening_type || '', date: now(),
        note: 'رصيد افتتاحي من ' + (col === 'suppliers' ? 'الموردين' : col === 'customers' ? 'الزبائن' : 'العمال')
      });
    }
    audit(d, 'add', col.slice(0, -1), row.id, ctx.user, ctx.role);
    store.save(d);
    return { data: row };
  },
  addSupplier: (b, ctx) => Master._addParty('suppliers', 'supplier', b, ctx),
  addCustomer: (b, ctx) => Master._addParty('customers', 'customer', b, ctx),
  addWorker: (b, ctx) => Master._addParty('workers', 'worker', b, ctx),

  _updateParty(col, id, b, ctx) {
    const d = store.load();
    const r = d[col].find(x => x.id === id);
    if (!r) throw Object.assign(new Error('غير موجود'), { code: 404 });
    // الرصيد الافتتاحي مقفل — أي محاولة تعديله مرفوضة هنا (مقارنة آمنة ضد NaN)
    const openField = col === 'workers' ? 'opening_balance' : 'opening_debt';
    if (b[openField] !== undefined) {
      let nb = 0, same = false;
      try { nb = toNum(b[openField], 'الرصيد'); same = (nb === toNum(r[openField] ?? 0, 'الرصيد')); } catch { same = false; }
      if (!same) throw Object.assign(new Error('الرصيد الافتتاحي مقفل بعد الإدخال — التعديل للمدير أو المحاسب عبر تسوية رسمية فقط'), { code: 400 });
    }
    if (b.opening_type !== undefined && b.opening_type !== r.opening_type) {
      throw Object.assign(new Error('نوع الرصيد مقفل بعد الإدخال'), { code: 400 });
    }
    if (col === 'workers' && b.job !== undefined) r.job = validJob(b.job);
    if (b.name !== undefined) { if (!hasText(b.name)) throw Object.assign(new Error('الاسم مطلوب'), { code: 400 }); r.name = b.name.trim(); }
    if (b.phone !== undefined) r.phone = checkPhone(b.phone);
    if (b.address !== undefined) r.address = String(b.address || '').trim();
    if (b.active !== undefined) r.active = !!b.active;
    r.updated_at = now();
    audit(d, 'update', col.slice(0, -1), id, ctx.user, ctx.role);
    store.save(d);
    return { data: r };
  },
  updateSupplier: (id, b, ctx) => Master._updateParty('suppliers', id, b, ctx),
  updateCustomer: (id, b, ctx) => Master._updateParty('customers', id, b, ctx),
  updateWorker: (id, b, ctx) => Master._updateParty('workers', id, b, ctx),

  _deleteParty(col, id, ctx) {
    const d = store.load();
    const i = d[col].findIndex(x => x.id === id);
    if (i < 0) throw Object.assign(new Error('غير موجود'), { code: 404 });
    const r = d[col][i];
    const openField = col === 'workers' ? 'opening_balance' : 'opening_debt';
    const logEntity = col === 'suppliers' ? 'supplier' : col === 'customers' ? 'customer' : 'worker';
    if (toNum(r[openField] ?? 0, 'الرصيد') !== 0 || d.opening_log.some(o => o.entity === logEntity && o.ref_id === id)) {
      throw Object.assign(new Error('ممنوع الحذف: توجد أرصدة أو حركات مرتبطة — عطّل البطاقة بدل الحذف'), { code: 400 });
    }
    d[col].splice(i, 1);
    audit(d, 'delete', col.slice(0, -1), id, ctx.user, ctx.role);
    store.save(d);
    return { ok: true };
  },
  deleteSupplier: (id, ctx) => Master._deleteParty('suppliers', id, ctx),
  deleteCustomer: (id, ctx) => Master._deleteParty('customers', id, ctx),
  deleteWorker: (id, ctx) => Master._deleteParty('workers', id, ctx),

  // ---- وظائف وأقسام ----
  addJob(b, ctx) {
    if (!hasText(b.name)) throw Object.assign(new Error('اسم الوظيفة/القسم مطلوب'), { code: 400 });
    const d = store.load();
    const row = { id: d.seq.job++, name: b.name.trim(), description: (b.description || '').trim(), created_at: now(), updated_at: now() };
    d.jobs.push(row);
    audit(d, 'add', 'job', row.id, ctx.user, ctx.role);
    store.save(d);
    return { data: row };
  },
  updateJob(id, b, ctx) {
    const d = store.load();
    const r = d.jobs.find(x => x.id === id);
    if (!r) throw Object.assign(new Error('غير موجود'), { code: 404 });
    if (b.name !== undefined) { if (!hasText(b.name)) throw Object.assign(new Error('الاسم مطلوب'), { code: 400 }); r.name = b.name.trim(); }
    if (b.description !== undefined) r.description = String(b.description || '').trim();
    r.updated_at = now();
    audit(d, 'update', 'job', id, ctx.user, ctx.role);
    store.save(d);
    return { data: r };
  },
  deleteJob(id, ctx) {
    const d = store.load();
    const i = d.jobs.findIndex(x => x.id === id);
    if (i < 0) throw Object.assign(new Error('غير موجود'), { code: 404 });
    d.jobs.splice(i, 1);
    audit(d, 'delete', 'job', id, ctx.user, ctx.role);
    store.save(d);
    return { ok: true };
  },

  // ---- مخازن ----
  addWarehouse(b, ctx) {
    if (!hasText(b.name)) throw Object.assign(new Error('اسم المخزن مطلوب'), { code: 400 });
    if (b.type && !['مواد أولية', 'منتج نهائي'].includes(b.type)) throw Object.assign(new Error('نوع المخزن: مواد أولية / منتج نهائي'), { code: 400 });
    const d = store.load();
    const row = { id: d.seq.warehouse++, name: b.name.trim(), place: (b.place || '').trim(), type: b.type || 'مواد أولية', opening_stock: toNum(b.opening_stock, 'المخزون الافتتاحي'), fixed: false, created_at: now(), updated_at: now() };
    d.warehouses.push(row);
    audit(d, 'add', 'warehouse', row.id, ctx.user, ctx.role);
    store.save(d);
    return { data: row };
  },
  updateWarehouse(id, b, ctx) {
    const d = store.load();
    const r = d.warehouses.find(x => x.id === id);
    if (!r) throw Object.assign(new Error('غير موجود'), { code: 404 });
    if (b.name !== undefined) { if (!hasText(b.name)) throw Object.assign(new Error('الاسم مطلوب'), { code: 400 }); r.name = b.name.trim(); }
    if (b.place !== undefined) r.place = String(b.place || '').trim();
    if (b.type !== undefined) { if (!['مواد أولية', 'منتج نهائي'].includes(b.type)) throw Object.assign(new Error('نوع غير صالح'), { code: 400 }); r.type = b.type; }
    if (b.opening_stock !== undefined) r.opening_stock = toNum(b.opening_stock, 'المخزون الافتتاحي');
    r.updated_at = now();
    audit(d, 'update', 'warehouse', id, ctx.user, ctx.role);
    store.save(d);
    return { data: r };
  },
  deleteWarehouse(id, ctx) {
    const d = store.load();
    const i = d.warehouses.findIndex(x => x.id === id);
    if (i < 0) throw Object.assign(new Error('غير موجود'), { code: 404 });
    if (d.warehouses[i].fixed) throw Object.assign(new Error('ممنوع حذف المخزنين الثابتين: المواد الأولية والمنتج النهائي'), { code: 400 });
    d.warehouses.splice(i, 1);
    audit(d, 'delete', 'warehouse', id, ctx.user, ctx.role);
    store.save(d);
    return { ok: true };
  },

  // ---- التركيبات: رقم ثابت TRK + تاريخ سريان + نسخ جديدة دائماً (لا تعديل مباشر) ----
  _nextFormulaNum(d) {
    const n = d.seq.formula_num++;
    return 'TRK-' + String(n).padStart(3, '0');
  },
  _validEffDate(v) {
    const s = String(v || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
      throw Object.assign(new Error('تاريخ السريان مطلوب بصيغة صحيحة (سنة-شهر-يوم)'), { code: 400 });
    }
    return s;
  },
  _cleanFormulaItems(d, items) {
    if (!Array.isArray(items)) throw Object.assign(new Error('مكونات التركيبة مطلوبة'), { code: 400 });
    const out = [];
    for (const it of items) {
      const item = d.items.find(x => x.id === Number(it.item_id));
      if (!item) throw Object.assign(new Error('مادة غير موجودة في البيانات الأساسية'), { code: 400 });
      const qty = toNum(it.qty, 'كمية ' + item.name);
      if (qty < 0) throw Object.assign(new Error('الكمية لا تكون سالبة'), { code: 400 });
      if (qty > 0 && !out.some(o => o.item_id === item.id)) {
        out.push({ item_id: item.id, item_name: item.name, qty, unit: item.unit });
      }
    }
    if (!out.length) throw Object.assign(new Error('اختر مادة واحدة على الأقل بكمية أكبر من صفر'), { code: 400 });
    return out;
  },
  _formulaUsed(d, id) {
    return (d.production_orders || []).some(o => o.formula_id === id);
  },
  addFormula(b, ctx) {
    if (!hasText(b.name)) throw Object.assign(new Error('اسم التركيبة مطلوب'), { code: 400 });
    const d = store.load();
    const date = this._validEffDate(b.date);
    const comps = this._cleanFormulaItems(d, b.items);
    const row = {
      id: d.seq.formula++, num: this._nextFormulaNum(d), name: b.name.trim(), date,
      status: b.status === 'متوقفة' ? 'متوقفة' : 'نشطة',
      note: String(b.note || '').trim(), parent_num: null,
      created_at: now(), updated_at: now()
    };
    d.formulas_ref.push(row);
    for (const c of comps) d.formula_items.push({ id: d.seq.formula_item++, formula_id: row.id, ...c });
    audit(d, 'add', 'formula_ref', row.id, ctx.user, ctx.role);
    store.save(d);
    return { data: { ...row, items: comps } };
  },
  newFormulaVersion(id, b, ctx) {
    const d = store.load();
    const src = d.formulas_ref.find(x => x.id === id);
    if (!src) throw Object.assign(new Error('التركيبة الأصلية غير موجودة'), { code: 404 });
    const date = this._validEffDate(b.date !== undefined ? b.date : new Date().toISOString().slice(0, 10));
    const srcItems = d.formula_items.filter(x => x.formula_id === id).map(x => ({ item_id: x.item_id, qty: x.qty }));
    const comps = this._cleanFormulaItems(d, b.items !== undefined ? b.items : srcItems);
    const row = {
      id: d.seq.formula++, num: this._nextFormulaNum(d),
      name: hasText(b.name) ? b.name.trim() : src.name, date,
      status: b.status === 'متوقفة' ? 'متوقفة' : 'نشطة',
      note: String(b.note !== undefined ? b.note : ('نسخة من ' + src.num)).trim(),
      parent_num: src.num, created_at: now(), updated_at: now()
    };
    d.formulas_ref.push(row);
    for (const c of comps) d.formula_items.push({ id: d.seq.formula_item++, formula_id: row.id, ...c });
    audit(d, 'version', 'formula_ref', row.id, ctx.user, ctx.role);
    store.save(d);
    return { data: { ...row, items: comps } };
  },
  getFormula(id) {
    const d = store.load();
    const r = d.formulas_ref.find(x => x.id === id);
    if (!r) throw Object.assign(new Error('غير موجود'), { code: 404 });
    return { data: { ...r, items: d.formula_items.filter(x => x.formula_id === id) } };
  },
  listFormulas() {
    const d = store.load();
    const data = d.formulas_ref.map(f => {
      const items = d.formula_items.filter(x => x.formula_id === f.id);
      return { ...f, items_count: items.length, total_qty: Math.round(items.reduce((s, x) => s + Number(x.qty || 0), 0) * 100) / 100 };
    }).sort((a, b) => (a.num < b.num ? 1 : -1));
    return { data };
  },
  updateFormula() {
    throw Object.assign(new Error('التعديل المباشر ممنوع — أنشئ نسخة جديدة برقم ثابت جديد'), { code: 400 });
  },
  deleteFormula(id, ctx) {
    const d = store.load();
    const i = d.formulas_ref.findIndex(x => x.id === id);
    if (i < 0) throw Object.assign(new Error('غير موجود'), { code: 404 });
    if (this._formulaUsed(d, id)) throw Object.assign(new Error('ممنوع الحذف: التركيبة مستعملة في إنتاج — أوقفها بدل الحذف'), { code: 400 });
    d.formula_items = d.formula_items.filter(x => x.formula_id !== id);
    d.formulas_ref.splice(i, 1);
    audit(d, 'delete', 'formula_ref', id, ctx.user, ctx.role);
    store.save(d);
    return { ok: true };
  }
};

module.exports = Master;
