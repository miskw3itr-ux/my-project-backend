// دار العلف — نسخ احتياطي لبيانات التشغيل (P4)
// الاستعمال: node scripts/backup-data.js [label]
// ينسخ backend/data/*.json إلى backend/data-archive/manual-<ts>-<label>
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const ARCH = path.join(ROOT, 'data-archive');

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function main() {
  const label = String(process.argv[2] || 'manual').replace(/[^a-zA-Z0-9-_ا-ي]/g, '').slice(0, 32) || 'manual';
  if (!fs.existsSync(DATA)) {
    console.log('no data dir — nothing to backup');
    return;
  }
  const dest = path.join(ARCH, stamp() + '-' + label);
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(DATA, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    fs.copyFileSync(path.join(DATA, e.name), path.join(dest, e.name));
    n++;
  }
  fs.writeFileSync(path.join(dest, 'backup.json'), JSON.stringify({ at: new Date().toISOString(), label, files: n }, null, 2));
  console.log('backup OK: ' + dest + ' (' + n + ' files)');
}

main();
