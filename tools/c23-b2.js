'use strict';
/**
 * c23-b2.js — 批 2 注入复核：10 视口 × 6 页 = 60 格（只读）
 *
 * 对每页注入 `.article p{max-width:40rem}`（只限叶段落），逐格对比 base / patched：
 *   正文行宽 px + 字符数（canvas 实测 '0' advance，基线口径 8.63px）
 *   代码块宽度（关键：worldcfg 必须保持 850.81~874.81）
 *   代码横滚数/总数、表格横滚、pageHeight、左边缘 uniqLeftCount、横向溢出
 *
 * 用法：node tools/c23-b2.js
 */
const L = require('./c23-lib');

async function measurePage(browser, p, inject) {
  const ctx = await L.newCtx(browser, { width: 1440, height: 900 });
  const page = await ctx.newPage();
  await L.gotoPage(page, p);
  if (inject) await page.addStyleTag({ content: L.CSS_B2 });
  const rows = {};
  for (const w of L.VPS) {
    await page.setViewportSize({ width: w, height: 900 });
    await L.settle(page, 2);
    rows[w] = await page.evaluate(L.MEASURE_FN);
  }
  await ctx.close();
  return rows;
}

(async () => {
  const browser = await L.launch();
  const out = { pages: L.PAGES.map((p) => p.key), vps: L.VPS, data: {} };
  try {
    for (const p of L.PAGES) {
      const base = await measurePage(browser, p, false);
      const patched = await measurePage(browser, p, true);
      out.data[p.key] = { base, patched };
      console.log('done ' + p.key);
    }
  } finally {
    await browser.close();
  }

  const f = L.save('b2.json', out);
  const n = (v) => (v == null ? 'n/a' : String(v));

  /* ---------- 60 格全表（patched） ---------- */
  console.log('\n=== B. 批 2 注入后 60 格（lineW / ch / artW / pageHeight）===');
  console.log('vp    ' + out.pages.map((k) => k.padEnd(26)).join(''));
  for (const w of L.VPS) {
    const cells = out.pages.map((k) => {
      const r = out.data[k].patched[w];
      if (r.artW == null) return 'n/a'.padEnd(26);
      return `${r.lineW}/${r.lineCh}/${r.artW}/${r.pageHeight}`.padEnd(26);
    });
    console.log(String(w).padEnd(6) + cells.join(''));
  }

  /* ---------- 逐格 delta 摘要 ---------- */
  console.log('\n=== 逐格 lineW 变化（base → patched）===');
  for (const k of out.pages) {
    for (const w of L.VPS) {
      const b = out.data[k].base[w];
      const q = out.data[k].patched[w];
      if (b.lineW == null) continue;
      const d = L.r2(q.lineW - b.lineW);
      if (Math.abs(d) > 0.5) {
        console.log(`${k.padEnd(9)} ${String(w).padEnd(6)} ${b.lineW} → ${q.lineW}  (${d > 0 ? '+' : ''}${d})   ch ${b.lineCh}→${q.lineCh}`);
      }
    }
  }

  /* ---------- 代码块 / 横滚 / 表格 / 溢出 / 左边缘 ---------- */
  console.log('\n=== 代码块**可见宽**(.code-scroll clientWidth min~max) / 横滚 / 表格 / 溢出 / 对齐 ===');
  console.log('page      vp     base codeVisW      patched codeVisW    codeOv        tblOv  hOv  leftsDirect  pageH(base→patched)');
  for (const k of out.pages) {
    for (const w of L.VPS) {
      const b = out.data[k].base[w];
      const q = out.data[k].patched[w];
      const pb = b.codeScrollCw ? b.codeScrollCw.join('~') : 'n/a';
      const pq = q.codeScrollCw ? q.codeScrollCw.join('~') : 'n/a';
      const same = pb === pq;
      console.log([
        k.padEnd(9), String(w).padEnd(6), pb.padEnd(16), (same ? '' : '→ ') + pq.padEnd(17),
        `${b.codeOverflow}/${b.codeBlocks}→${q.codeOverflow}/${q.codeBlocks}`.padEnd(13),
        `${q.tableOverflow}/${q.tableBlocks}`.padEnd(6),
        String(q.hOverflow).padEnd(4),
        String(q.uniqLeftDirect).padEnd(12),
        `${b.pageHeight}→${q.pageHeight}`,
      ].join(' '));
    }
  }

  /* ---------- 异常检查 ---------- */
  console.log('\n=== 异常检查 ===');
  const problems = [];
  for (const k of out.pages) {
    for (const w of L.VPS) {
      const b = out.data[k].base[w];
      const q = out.data[k].patched[w];
      if (q.hOverflow > 0 && b.hOverflow <= 0) problems.push(`${k}@${w}: 新增横向溢出 ${q.hOverflow}px`);
      if (q.codeOverflow !== b.codeOverflow) problems.push(`${k}@${w}: 代码横滚 ${b.codeOverflow}→${q.codeOverflow}`);
      if (q.tableOverflow !== b.tableOverflow) problems.push(`${k}@${w}: 表格横滚 ${b.tableOverflow}→${q.tableOverflow}`);
      if (q.uniqLeftDirect > 1) problems.push(`${k}@${w}: 直接子段落左边缘不齐 uniqLeftDirect=${q.uniqLeftDirect}`);
      if (q.uniqLeftDirect !== b.uniqLeftDirect) problems.push(`${k}@${w}: 对齐档数变化 ${b.uniqLeftDirect}→${q.uniqLeftDirect}`);
      const viz = (x) => (x.codeScrollCw ? x.codeScrollCw.join('~') : 'n/a');
      if (viz(b) !== viz(q)) problems.push(`${k}@${w}: 代码块可见宽变化 ${viz(b)} → ${viz(q)}`);
    }
  }
  console.log(problems.length ? problems.join('\n') : 'none');
  console.log('\nWROTE ' + f);
})().catch((e) => { console.error(e); process.exit(1); });
