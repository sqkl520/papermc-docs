'use strict';
/**
 * c23-combo.js — 批 2 + 批 3 同时注入的叠加影响（只读）
 *
 * 回答三个问题：
 *   1) 批 2 的 40rem 会不会把批 3 的 artW 断崖「吃掉」？（正文恒 640，但容器仍跳）
 *   2) 代码块可见宽在 1199/1200 处跳多少？（这是 40rem 吃不掉的部分）
 *   3) 组合后有没有新的横向溢出 / 对齐异常 / 页高异常？
 *
 * 4 个变体 × 关键视口 × 5 张正文页。
 * 用法：node tools/c23-combo.js
 */
const L = require('./c23-lib');

const PAGES = ['paper', 'dialogs', 'worldcfg', 'tuning',
  { key: 'particles', path: '/paper/dev/particles/' }];
const VPS = [1199, 1200, 1201, 1024, 1025, 1440];

async function run(browser, variant, opts) {
  const ctx = await L.newCtx(browser, { width: 1440, height: 900, jsPatch: opts.jsPatch, cssPatch: opts.cssPatch });
  const page = await ctx.newPage();
  const out = {};
  for (const key of PAGES) {
    const p = typeof key === 'string' ? L.PAGE_BY_KEY[key] : key;
    await L.gotoPage(page, p);
    if (opts.css) await page.addStyleTag({ content: opts.css });
    out[p.key || key.key] = {};
    for (const w of VPS) {
      await page.setViewportSize({ width: w, height: 900 });
      await L.settle(page, 2);
      out[p.key || key.key][w] = await page.evaluate(L.MEASURE_FN);
    }
  }
  await ctx.close();
  return { variant, data: out };
}

(async () => {
  const browser = await L.launch();
  const variants = [];
  try {
    variants.push(await run(browser, 'base', {}));
    variants.push(await run(browser, 'b2', { css: L.CSS_B2 }));
    variants.push(await run(browser, 'b3', { jsPatch: true, cssPatch: true }));
    variants.push(await run(browser, 'b2b3', { jsPatch: true, cssPatch: true, css: L.CSS_B2 }));
  } finally { await browser.close(); }

  const byName = Object.fromEntries(variants.map((v) => [v.variant, v.data]));
  const keys = Object.keys(byName.b2b3);

  console.log('=== C1. 1199 / 1200 处各指标（4 变体）===');
  console.log('page      vp    variant  artW      lineW     codeVisW   codeOv   pageH    hOv');
  for (const k of keys) {
    for (const w of [1199, 1200]) {
      for (const v of ['base', 'b2', 'b3', 'b2b3']) {
        const r = byName[v][k][w];
        const cv = r.codeScrollCw ? r.codeScrollCw.join('~') : 'n/a';
        console.log([
          k.padEnd(9), String(w).padEnd(5), v.padEnd(8),
          String(r.artW).padEnd(9), String(r.lineW).padEnd(9), cv.padEnd(10),
          `${r.codeOverflow}/${r.codeBlocks}`.padEnd(8),
          String(r.pageHeight).padEnd(8), String(r.hOverflow),
        ].join(' '));
      }
    }
    console.log('');
  }

  console.log('=== C2. 1199→1200 的跳变（每变体、每页）===');
  for (const v of ['base', 'b2', 'b3', 'b2b3']) {
    for (const k of keys) {
      const a = byName[v][k][1199];
      const b = byName[v][k][1200];
      const d = (x, y) => (x == null || y == null ? 'n/a' : L.r2(y - x));
      const codeA = a.codeScrollCw ? a.codeScrollCw[1] : null;
      const codeB = b.codeScrollCw ? b.codeScrollCw[1] : null;
      console.log(`${v.padEnd(6)} ${k.padEnd(9)} artW ${String(d(a.artW, b.artW)).padEnd(9)} lineW ${String(d(a.lineW, b.lineW)).padEnd(9)} codeVis ${String(d(codeA, codeB)).padEnd(9)} pageH ${d(a.pageHeight, b.pageHeight)}`);
    }
  }

  console.log('\n=== C3. 组合态异常检查（b2b3 全 6 视口 × 5 页）===');
  const problems = [];
  for (const k of keys) {
    for (const w of VPS) {
      const r = byName.b2b3[k][w];
      const base = byName.base[k][w];
      if (r.hOverflow > 0) problems.push(`${k}@${w}: 横向溢出 ${r.hOverflow}px（基线 ${base.hOverflow}）`);
      if (r.uniqLeftDirect > 1) problems.push(`${k}@${w}: 直接子段落左边缘不齐 ${r.uniqLeftDirect}`);
      if (r.codeOverflow > base.codeOverflow) problems.push(`${k}@${w}: 代码横滚增加 ${base.codeOverflow}→${r.codeOverflow}`);
      if (r.tableOverflow > base.tableOverflow) problems.push(`${k}@${w}: 表格横滚增加 ${base.tableOverflow}→${r.tableOverflow}`);
    }
  }
  console.log(problems.length ? problems.join('\n') : 'none');

  console.log('\n=== C4. 正文行宽是否真的恒定（b2b3，跨 1024/1025/1199/1200/1440）===');
  for (const k of keys) {
    const vals = VPS.map((w) => byName.b2b3[k][w].lineW);
    const chs = VPS.map((w) => byName.b2b3[k][w].lineCh);
    const artWs = VPS.map((w) => byName.b2b3[k][w].artW);
    console.log(`${k.padEnd(9)} lineW=[${vals.join(', ')}]  ch=[${chs.join(', ')}]  artW=[${artWs.join(', ')}]`);
  }

  console.log('\nWROTE ' + L.save('combo.json', variants));
})().catch((e) => { console.error(e); process.exit(1); });
