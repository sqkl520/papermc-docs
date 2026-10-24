'use strict';
/**
 * b1r-elemdiff.js — 元素级归因：无 TOC / 无代码页（worldcfg, system-properties）的 -238 / -21 从哪来
 * 用法: node tools/b1r-elemdiff.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const LOGP = path.join(ROOT, 'reports', '.b1r-elemdiff.log');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787', OLD = 'http://127.0.0.1:8788';
function log(s) { try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {} console.log(s); }

(async () => {
  try { fs.unlinkSync(LOGP); } catch (e) {}
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = {};
  for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '768x1024', w: 768, h: 1024 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const u of ['/paper/reference/world-configuration/', '/paper/reference/system-properties/']) {
      const collect = async (base) => {
        await page.goto(base + u, { waitUntil: 'load' });
        await page.waitForTimeout(500);
        return page.evaluate(() => {
          const agg = {};
          document.querySelectorAll('.article > *, .content > *').forEach((e, i) => {
            const sig = e.tagName + '#' + i;
            const b = e.getBoundingClientRect();
            agg[sig] = { tag: e.tagName, h: +b.height.toFixed(1), w: Math.round(b.width), txt: (e.textContent || '').trim().slice(0, 30) };
          });
          // 段落行数（Range rects）
          let lines = 0;
          document.querySelectorAll('.article p, .article li, .table-wrap td').forEach((e) => {
            const r = document.createRange(); r.selectNodeContents(e);
            lines += r.getClientRects().length;
          });
          return { docH: Math.round(document.documentElement.scrollHeight), blocks: agg, lineBoxes: lines,
            articleH: Math.round(document.querySelector('.article').getBoundingClientRect().height) };
        });
      };
      const n = await collect(NEW); const o = await collect(OLD);
      const diffs = [];
      for (const k of Object.keys(n.blocks)) {
        const a = n.blocks[k], b = o.blocks[k];
        if (!a || !b) continue;
        const d = +(a.h - b.h).toFixed(1);
        if (Math.abs(d) >= 1) diffs.push({ tag: a.tag, txt: a.txt, hNew: a.h, hOld: b.h, d });
      }
      diffs.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
      const rec = { vp: vp.n, page: u, docDelta: n.docH - o.docH, lineBoxesNew: n.lineBoxes, lineBoxesOld: o.lineBoxes, articleHNew: n.articleH, articleHOld: o.articleH, top: diffs.slice(0, 8) };
      out[vp.n + '|' + u] = rec;
      log('ELEMDIFF ' + JSON.stringify(rec));
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-elemdiff.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE');
})();
