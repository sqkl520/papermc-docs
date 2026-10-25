'use strict';
/**
 * c5-static.js — 构建产物的静态盘点（不启动浏览器）：
 *   - 全站 <h5> 出现次数 / 涉及页面（P2-1 的"46 处"应能对上）
 *   - 含 .table-wrap 的页面清单（P2-2 的 320px 取样面）
 *   - 侧栏 .side-group-title 的 pill 总数（P1-6 的"29 个 pill"应能对上）
 *   - ::before content 里出现 ▸ / \25B8 的规则数（侧栏 ▸ 的源头清单）
 * 输出 reports/.c5-static.json（UTF-8）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const out = { h5: { total: 0, pages: [] }, tables: [], pills: { total: 0, pages: [] }, triangles: [], builtAt: null };

// 1) 遍历产物 HTML（paper/ velocity/ folia/ + 根 html）
const roots = ['paper', 'velocity', 'folia'];
const htmlFiles = [];
for (const r of roots) {
  const base = path.join(ROOT, r);
  if (!fs.existsSync(base)) continue;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) htmlFiles.push(p);
    }
  })(base);
}
for (const f of ['index.html', 'all-pages.html', 'snapshots.html', '404.html']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) htmlFiles.push(p);
}

for (const f of htmlFiles) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const txt = fs.readFileSync(f, 'utf8');
  const h5 = (txt.match(/<h5[\s>]/g) || []).length;
  if (h5) { out.h5.total += h5; out.h5.pages.push({ page: rel, h5 }); }
  if (txt.indexOf('class="table-wrap"') !== -1) {
    const n = (txt.match(/class="table-wrap"/g) || []).length;
    out.tables.push({ page: rel, wraps: n });
  }
  const pills = (txt.match(/class="side-group-title"/g) || []).length;
  if (pills) { out.pills.total += pills; out.pills.pages.push({ page: rel, pills }); }
}

// 2) 产物 CSS 里的三角规则
const cssPath = path.join(ROOT, 'assets', 'site.css');
const css = fs.readFileSync(cssPath, 'utf8');
const re = /([^\r\n{}]*::before\{[^\r\n{}]*)/g;
let m;
while ((m = re.exec(css))) {
  const sel = m[1].trim();
  if (sel.indexOf('25B8') !== -1 || sel.indexOf('\u25b8') !== -1) {
    const line = css.slice(0, m.index).split('\n').length;
    out.triangles.push({ line, rule: sel.slice(0, 220) });
  }
}
out.trianglesCount = out.triangles.length;

const man = path.join(ROOT, 'data', 'build-manifest.json');
if (fs.existsSync(man)) {
  try { out.builtAt = JSON.parse(fs.readFileSync(man, 'utf8')).generated_at || null; } catch { /* */ }
}

out.pagesScanned = htmlFiles.length;
out.maxH5Page = out.h5.pages.slice().sort((a, b) => b.h5 - a.h5)[0] || null;
fs.writeFileSync(path.join(ROOT, 'reports', '.c5-static.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('h5 total=' + out.h5.total + ' on ' + out.h5.pages.length + ' pages; max=' + JSON.stringify(out.maxH5Page));
console.log('table pages=' + out.tables.length + '; pills total=' + out.pills.total + '; triangle rules=' + out.trianglesCount);
console.log('scanned ' + out.pagesScanned + ' html; builtAt=' + out.builtAt);
