'use strict';
/* b1v-probe10.js — P0-4 复核：真实鼠标点击一行中间（不只是 elementFromPoint），
 * 并检查拉伸链接在 390 与 1280 的命中与可选中性。
 * 用法: node tools/b1v-probe10.js <port> <outPath>
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const PORT = process.argv[2] || '8787';
const OUT = process.argv[3];
const BASE = 'http://127.0.0.1:' + PORT;

function chromePath() {
  const c = [];
  if (process.env.CHROME_PATH) c.push(process.env.CHROME_PATH);
  if (process.env.LOCALAPPDATA) {
    c.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe');
    c.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win\\chrome.exe');
  }
  if (process.env.PROGRAMFILES) c.push(process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe');
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  throw new Error('no chrome');
}

async function run(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // 选一个带 sum+rel 的行
  const pick = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.src-item'));
    const idx = rows.findIndex((i) => i.querySelector('.src-sum') && i.querySelector('.src-rel'));
    const row = rows[idx];
    row.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rr = row.getBoundingClientRect();
    return { idx, left: rr.left, top: rr.top, w: rr.width, h: rr.height };
  });
  await page.waitForTimeout(250);

  const probes = [];
  for (const f of [0.03, 0.2, 0.5, 0.7, 0.9, 0.97]) {
    const info = await page.evaluate((frac) => {
      const rows = Array.from(document.querySelectorAll('.src-item'));
      const row = rows.find((i) => i.querySelector('.src-sum') && i.querySelector('.src-rel'));
      const rr = row.getBoundingClientRect();
      const x = rr.left + rr.width * frac;
      const y = rr.top + rr.height / 2;
      const el = document.elementFromPoint(x, y);
      const a = el && el.closest ? el.closest('a') : null;
      return {
        frac, x: +x.toFixed(1), y: +y.toFixed(1),
        el: el ? el.tagName + '.' + String(el.className).slice(0, 26) : null,
        closestA: a ? a.className + '|' + a.getAttribute('href') : null,
        // 点这里会去哪
      };
    }, f);
    probes.push(info);
  }

  // 真点 0.9 处，看是否导航
  const before = page.url();
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.src-item'));
    const row = rows.find((i) => i.querySelector('.src-sum') && i.querySelector('.src-rel'));
    const rr = row.getBoundingClientRect();
    window.__clickPoint = { x: rr.left + rr.width * 0.9, y: rr.top + rr.height / 2 };
  });
  const cp = await page.evaluate(() => window.__clickPoint);
  await Promise.race([
    page.mouse.click(cp.x, cp.y).then(() => page.waitForTimeout(900)),
    page.waitForTimeout(1500),
  ]);
  const after = page.url();

  return { width, pick, probes, navigated: before !== after, before, after };
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { port: PORT };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    out.w1280 = await run(page, 1280);
    out.w390 = await run(page, 390);
    await ctx.close();
  } catch (e) { out.error = String((e && e.stack) || e); }
  finally { await browser.close(); }
  const j = JSON.stringify(out, null, 1);
  if (OUT) { fs.writeFileSync(OUT, j, 'utf8'); console.log('wrote ' + OUT); } else console.log(j);
})();
