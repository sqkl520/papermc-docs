'use strict';
/**
 * critique-mobile-inspect.js —— 静态 HTML 抽查（锐评取证用，只读）
 * 用法: node tools/critique-mobile-inspect.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const line = (t) => { console.log('======== ' + t + ' ========'); };

/* 1. /paper/ 的 .article 是什么 */
line('/paper/index.html 的 .article 上下文');
{
  const s = read('paper/index.html');
  const i = s.indexOf('class="article"');
  console.log(s.slice(Math.max(0, i - 400), i + 1400).replace(/></g, '>\n<').slice(0, 2600));
}

/* 2. 无 src 的 <img> 出自哪里 */
line('无 src 的 <img>（每页都有一张）');
{
  const s = read('paper/index.html');
  const i = s.indexOf('<img alt="">');
  console.log('context:');
  console.log(s.slice(Math.max(0, i - 700), i + 200));
}

/* 3. particles 上那个 8x8 data-URI 图 */
line('particles 的可疑 data-URI 图');
{
  const s = read('paper/dev/particles/index.html');
  const m = s.match(/<img[^>]*data:image[^>]*>/g) || [];
  console.log('data-uri img 数量: ' + m.length);
  m.forEach((x, i) => console.log(i + ': ' + x.slice(0, 400)));
  const lazy = (s.match(/<img[^>]*loading="lazy"[^>]*>/g) || []);
  console.log('loading=lazy 的 img: ' + lazy.length + ' / 全部 ' + ((s.match(/<img/g) || []).length));
  console.log('带 width= 或 height= 的 img: ' + ((s.match(/<img[^>]*\swidth=/g) || []).length) + ' / ' + ((s.match(/<img[^>]*\sheight=/g) || []).length));
  console.log('示例 img:');
  (s.match(/<img[^>]*>/g) || []).slice(0, 4).forEach((x) => console.log('  ' + x.slice(0, 260)));
  console.log('figure/figcaption: ' + ((s.match(/<figure/g) || []).length) + '/' + ((s.match(/<figcaption/g) || []).length));
}

/* 4. 全站可见文本里 <14px 的规则来源（CSS 层） */
line('CSS 中所有 <14px 的字号声明（assets/site.css）');
{
  const css = fs.readFileSync(path.join(ROOT, 'assets', 'site.css'), 'utf8');
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*font-size:[^;}]+[^}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    const fsDecl = (m[2].match(/font-size:[^;}]+/) || [''])[0];
    const v = parseFloat(fsDecl.replace(/[^0-9.]/g, ''));
    if (!isFinite(v)) continue;
    const isRem = /font-size:\s*[\d.]+rem/.test(fsDecl);
    const px = isRem ? v * 16 : (/%/.test(fsDecl) ? v * 0.16 : v);
    if (px < 14) out.push(px.toFixed(2) + 'px  ' + sel + '  [' + fsDecl.trim() + ']');
  }
  console.log('共 ' + out.length + ' 条：');
  out.forEach((x) => console.log('  ' + x));
}

/* 5. 表格分布（哪些页有表、几张、几列） */
line('全站表格分布');
{
  const rows = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (['node_modules', '.git', 'archive', 'assets', 'data', 'reports', 'tools'].includes(e.name)) continue; walk(p); }
      else if (e.name.endsWith('.html')) {
        const s = fs.readFileSync(p, 'utf8');
        const t = (s.match(/<table/g) || []).length;
        if (!t) continue;
        const cols = (s.match(/<th[^>]*>/g) || []).length;
        rows.push({ f: path.relative(ROOT, p), t, cols });
      }
    }
  };
  walk(ROOT);
  rows.sort((a, b) => b.t - a.t);
  console.log('页面数 ' + rows.length + '，表格总数 ' + rows.reduce((a, b) => a + b.t, 0));
  rows.slice(0, 14).forEach((r) => console.log('  ' + r.t + ' 表  ' + r.f));
}
