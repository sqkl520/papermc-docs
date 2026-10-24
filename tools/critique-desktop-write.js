/* critique-desktop-write.js — assemble reports/critique-desktop.md (skeleton + increments) */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'reports', 'critique-desktop.md');
const PARTS = path.join(ROOT, 'reports', '_critique-desktop-parts');
const write = (p, s) => fs.writeFileSync(p, s, 'utf8');
const read = p => fs.readFileSync(p, 'utf8');

const mode = process.argv[2] || 'skeleton';
const section = process.argv[3];
if (mode === 'skeleton') {
  fs.mkdirSync(PARTS, { recursive: true });
  write(REPORT, read(path.join(PARTS, '00-head.md')));
  console.log('skeleton ->', REPORT, fs.statSync(REPORT).size, 'bytes');
} else if (mode === 'append' || mode === 'replace-section') {
  const names = fs.readdirSync(PARTS).filter(f => /^\d\d-/.test(f)).sort();
  const body = names.map(n => read(path.join(PARTS, n))).join('\n');
  write(REPORT, body);
  console.log('assembled', names.length, 'parts ->', fs.statSync(REPORT).size, 'bytes');
} else if (mode === 'write-part') {
  const src = process.argv[4];
  const dst = path.join(PARTS, section);
  write(dst, read(src));
  console.log('part written', dst, fs.statSync(dst).size);
}
