'use strict';
/**
 * c23-cliff.js — 批 3 断崖预演（只读）
 *
 * 在 /paper/dev/dialogs/ 上做 1021→1300 逐 1px 扫描，比较 4 个变体：
 *   base      无注入（复核基线：应见 1023/1024/1025 = 972/693/434 两级台阶）
 *   b3css     只 addStyleTag 注入目标态 CSS（≥1200 不加 !important，避免掩盖缺陷）
 *   b3full    route 内存改写 site.css + site.js（= 真实补丁逐字节等价预演）
 *   b2b3      b3full + `.article p{max-width:40rem}`（C 段叠加）
 *
 * 输出：台阶（|Δ artW| ≥ 20px）位置/幅度、关键点 artW、代码块宽。
 *
 * 用法：node tools/c23-cliff.js
 */
const L = require('./c23-lib');

const PAGE = L.PAGE_BY_KEY.dialogs;
const W0 = 1021;
const W1 = 1300;

async function scanVariant(browser, name, opts) {
  const ctx = await L.newCtx(browser, { width: W0, height: 900, jsPatch: opts.jsPatch, cssPatch: opts.cssPatch, cssPatchFn: opts.cssPatchFn });
  const page = await ctx.newPage();
  await L.gotoPage(page, PAGE);
  if (opts.css) await page.addStyleTag({ content: opts.css });
  await L.settle(page, 2);

  const rows = [];
  for (let w = W0; w <= W1; w++) {
    await page.setViewportSize({ width: w, height: 900 });
    await L.settle(page, 1);
    const m = await page.evaluate(L.SCAN_FN);
    rows.push(m);
  }
  await ctx.close();

  /* 台阶：相邻两档 |Δ artW| >= 20px */
  const steps = [];
  for (let i = 1; i < rows.length; i++) {
    const d = L.r2(rows[i].artW - rows[i - 1].artW);
    if (Math.abs(d) >= 20) {
      steps.push({
        from: rows[i - 1].vw, to: rows[i].vw,
        before: rows[i - 1].artW, after: rows[i].artW, delta: d,
        tocBefore: rows[i - 1].tocMode, tocAfter: rows[i].tocMode,
        colsAfter: rows[i].cols,
      });
    }
  }
  const pick = (w) => {
    const r = rows.find((x) => x.vw === w);
    return r ? { artW: r.artW, tocMode: r.tocMode, cols: r.cols, contentW: r.contentW, codePreWmax: r.codePreWmax, codeScrollCwmax: r.codeScrollCwmax } : null;
  };
  return { variant: name, steps, stepCount: steps.length, keys: { 1023: pick(1023), 1024: pick(1024), 1025: pick(1025), 1199: pick(1199), 1200: pick(1200), 1201: pick(1201), 1300: pick(1300) }, rows };
}

(async () => {
  const browser = await L.launch();
  const out = [];
  try {
    out.push(await scanVariant(browser, 'base', {}));
    out.push(await scanVariant(browser, 'b3css', { css: L.CSS_B3 }));
    out.push(await scanVariant(browser, 'b3full', { jsPatch: true, cssPatch: true }));
    out.push(await scanVariant(browser, 'b3nocap', { jsPatch: true, cssPatch: true, cssPatchFn: L.patchSiteCssNoCap }));
    out.push(await scanVariant(browser, 'b2b3', { jsPatch: true, cssPatch: true, css: L.CSS_B2 }));
  } finally {
    await browser.close();
  }

  console.log('=== 台阶（|Δ artW| ≥ 20px，1021→1300 逐 1px）===');
  for (const v of out) {
    console.log(`\n[${v.variant}] 台阶数=${v.stepCount}`);
    for (const s of v.steps) {
      console.log(`  ${s.from}→${s.to}: ${s.before} → ${s.after}  (${s.delta > 0 ? '+' : ''}${s.delta})  TOC ${s.tocBefore}→${s.tocAfter}  cols=${s.colsAfter}`);
    }
    if (!v.steps.length) console.log('  (none)');
  }

  console.log('\n=== 关键点 artW / TOC / cols / 代码块 max 宽 ===');
  console.log('variant   vw     artW     TOC        contentW  codePreW  codeScrollCw');
  for (const v of out) {
    for (const w of ['1023', '1024', '1025', '1199', '1200', '1201', '1300']) {
      const k = v.keys[w];
      if (!k) continue;
      console.log(`${v.variant.padEnd(9)} ${w.padEnd(6)} ${String(k.artW).padEnd(8)} ${String(k.tocMode).padEnd(10)} ${String(k.contentW).padEnd(9)} ${String(k.codePreWmax).padEnd(9)} ${k.codeScrollCwmax}`);
    }
  }

  const f = L.save('cliff.json', out.map((v) => ({ variant: v.variant, steps: v.steps, keys: v.keys, rows: v.rows })));
  console.log('\nWROTE ' + f);
})().catch((e) => { console.error(e); process.exit(1); });
