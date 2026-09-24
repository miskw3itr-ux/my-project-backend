// مخزن JSON خفيف — صفر اعتماديات، كافٍ لقسم البيانات الأساسية
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'master.json');

const EMPTY = {
  seq: { category: 1, item: 1, supplier: 1, customer: 1, worker: 1, job: 1, warehouse: 1, formula: 1, formula_item: 1, formula_num: 1, opening: 1, audit: 1, item_code_mat: 1, item_code_prd: 1, item_code_pac: 1, supplier_code: 1, customer_code: 1, worker_code: 1, warehouse_code: 3, expcat: 1 },
  categories: [],
  items: [],
  suppliers: [],
  customers: [],
  workers: [],
  jobs: [],
  warehouses: [],
  formulas_ref: [],
  formula_items: [],
  opening_log: [],
  audit: [],
  custom_codes: {},
  expcats: [],
};

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    const d = JSON.parse(JSON.stringify(EMPTY));
    const now = new Date().toISOString();
    // مخزنان ثابتان متفق عليهما — لا يحذفان أبداً (بكودين تلقائيين)
    d.warehouses.push({ id: d.seq.warehouse++, code: 'WH-001', name: 'مخزن المواد الأولية', place: 'رئيسي', type: 'مواد أولية', opening_stock: 0, fixed: true, created_at: now, updated_at: now });
    d.warehouses.push({ id: d.seq.warehouse++, code: 'WH-002', name: 'مخزن المنتج النهائي', place: 'رئيسي', type: 'منتج نهائي', opening_stock: 0, fixed: true, created_at: now, updated_at: now });
    fs.writeFileSync(FILE, JSON.stringify(d, null, 2), 'utf8');
  }
}

function load() {
  ensure();
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    // نسخ عميق للافتراضيات (نفس علة jstore: الإسناد بالمرجع يلوث EMPTY المشترك)
    for (const k of Object.keys(EMPTY)) if (d[k] === undefined) d[k] = JSON.parse(JSON.stringify(EMPTY[k]));
    if (!d.seq || typeof d.seq !== 'object') d.seq = {};
    for (const k of Object.keys(EMPTY.seq)) if (d.seq[k] === undefined || d.seq[k] === null) d.seq[k] = EMPTY.seq[k];
    if (!Array.isArray(d.formula_items)) d.formula_items = [];
    return d;
  } catch {
    return JSON.parse(JSON.stringify(EMPTY));
  }
}

function save(d) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

module.exports = { load, save };
