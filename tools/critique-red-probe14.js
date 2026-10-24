'use strict';
/** critique-red-probe14.js — 校验 critique-desktop.md 的四条可证伪主张
 *  A) `.article{max-width:44rem}` 到底等于多少 ch / 多少真实字符一行（在其自身口径下）
 *  B) world-configuration 的 12.48px 元素究竟是谁（是不是正文段）
 *  C) `.code-copy` 在 1440 的真实命中区
 *  D) 正文真实色值
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = process.cwd();
const EXE = [process.env.CHROME_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'), process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));

const PROBE = () => {
  const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
  const meas = (root, maxN) => {
    const lines = new Map();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n = 0, stop = false; const rg = document.createRange();
    while (!stop && w.nextNode()) {
      const t = w.currentNode, s = t.nodeValue || '';
      for (let i = 0; i < s.length; i++) {
        if (n >= maxN) { stop = true; break; }
        const ch = s[i]; if (ch === '\n' || ch === '\r' || ch === '\t') continue;
        rg.setStart(t, i); rg.setEnd(t, i + 1);
        const rr = rg.getClientRects(); n++;
        if (!rr.length) continue;
        const bb = rr[0]; if (!bb.width && !bb.height) continue;
        const k = Math.round(bb.top / 2) * 2;
        let e = lines.get(k); if (!e) { e = { chars: 0, cjk: 0, left: bb.left, right: bb.right, w: 0 }; lines.set(k, e); }
        e.chars++; if (CJK.test(ch)) e.cjk++;
        e.left = Math.min(e.left, bb.left); e.right = Math.max(e.right, bb.right); e.w = e.right - e.left;
      }
    }
    return [...lines.values()].map((e) => ({ chars: e.chars, cjk: e.cjk, w: Math.round(e.w) }));
  };
  const chUnit = (() => {
    // 用一个 0 宽度的探针元素量 '0' 的 advance
    const p = document.querySelector('.article p');
    if (!p) return null;
    const s = document.createElement('span');
    s.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + getComputedStyle(p).font;
    s.textContent = '0'.repeat(100);
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width / 100;
    s.textContent = 'x'.repeat(100);
    const wx = s.getBoundingClientRect().width / 100;
    s.remove();
    return { zeroAdvance: Math.round(w * 1e4) / 1e4, xAdvance: Math.round(wx * 1e4) / 1e4, fs: getComputedStyle(p).fontSize };
  })();

  const r = { chUnit, before: null, after44rem: null, twelveFortyEight: [], codeCopy: null, bodyColor: null, articleW: null };
  const art = document.querySelector('.article');
  const bodyP = art ? [...art.querySelectorAll('p')].find((x) => !x.className && (x.textContent || '').trim().length > 120) : null;
  if (bodyP) {
    r.bodyColor = getComputedStyle(bodyP).color;
    const L = meas(bodyP, 2500);
    const mx = Math.max(...L.map((x) => x.w));
    const full = L.filter((x) => x.w >= mx * 0.94 && x.chars > 5);
    const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
    r.before = { pW: Math.round(bodyP.getBoundingClientRect().width), fs: getComputedStyle(bodyP).fontSize, maxLineW: mx, medCharsPerFullLine: med(full.map((x) => x.chars)) };
  }
  if (art) r.articleW = Math.round(art.getBoundingClientRect().width);
  // 5) 模拟 critique-desktop 的 H1 改法
  if (art) {
    art.style.maxWidth = '44rem';
    const p2 = [...art.querySelectorAll('p')].find((x) => !x.className && (x.textContent || '').trim().length > 120) || bodyP;
    if (p2) {
      const L = meas(p2, 2500);
      const mx = Math.max(...L.map((x) => x.w));
      const full = L.filter((x) => x.w >= mx * 0.94 && x.chars > 5);
      const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
      r.after44rem = { artW: Math.round(art.getBoundingClientRect().width), pW: Math.round(p2.getBoundingClientRect().width), maxLineW: mx, medCharsPerFullLine: med(full.map((x) => x.chars)), chAtMeasuredZero: Math.round(art.getBoundingClientRect().width / (r.chUnit ? r.chUnit.zeroAdvance : 1)) };
    }
    art.style.maxWidth = '';
  }
  // 3) 谁在 12.48px
  for (const el of document.querySelectorAll('.article *')) {
    const r0 = el.getBoundingClientRect();
    if (r0.width < 100) continue;
    const fs = Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
    if (Math.abs(fs - 12.48) < 0.02) r.twelveFortyEight.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 30), w: Math.round(r0.width), x: Math.round(r0.x), t: (el.textContent || '').trim().slice(0, 40) });
  }
  r.twelveFortyEight = r.twelveFortyEight.slice(0, 6);
  // 4) code-copy
  const cc = document.querySelector('.code-copy');
  if (cc) { const b = cc.getBoundingClientRect(); r.codeCopy = { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, ariaLabel: cc.getAttribute('aria-label'), text: (cc.textContent || '').trim() }; }
  return r;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  for (const p of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/']) {
    await page.goto('http://127.0.0.1:8787' + p, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(350);
    const d = await page.evaluate(PROBE);
    out[p] = d;
    console.log('=== ' + p);
    console.log('  chUnit=' + JSON.stringify(d.chUnit) + '  articleW=' + d.articleW + '  bodyColor=' + d.bodyColor);
    console.log('  改前 body=' + JSON.stringify(d.before));
    console.log('  44rem后 ' + JSON.stringify(d.after44rem));
    console.log('  12.48px 元素(' + d.twelveFortyEight.length + ')= ' + JSON.stringify(d.twelveFortyEight.slice(0, 3)));
    if (d.codeCopy) console.log('  .code-copy=' + JSON.stringify(d.codeCopy));
  }
  await ctx.close();
  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe14.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('写出 reports/critique-red-probe14.json');
})();
