'use strict';
/** critique-red-probe9.js — 侧栏「分组标题 + 组首页 pill」截断精查 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const EXE = [process.env.CHROME_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'), process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));

const PROBE = () => {
  const out = { summaries: [], pills: [], treeLabels: [] };
  for (const s of document.querySelectorAll('.sidebar .side-cat > summary, .sidebar .side-group > summary, .sidebar .side-section-title')) {
    const r = s.getBoundingClientRect(); if (!r.width) continue;
    const cs = getComputedStyle(s);
    // 找到承载标题文字的子元素
    const ttl = s.querySelector('.ttl') || s;
    out.summaries.push({
      txt: (s.textContent || '').trim().slice(0, 46), w: Math.round(r.width), h: Math.round(r.height),
      ttlCls: String(ttl.className), ttlCW: ttl.clientWidth, ttlSW: ttl.scrollWidth,
      overPx: ttl.scrollWidth - ttl.clientWidth, isTruncated: ttl.scrollWidth > ttl.clientWidth + 1 && getComputedStyle(ttl).textOverflow === 'ellipsis',
      summaryOverflow: cs.overflow, summaryTextOverflow: cs.textOverflow, fs: cs.fontSize,
    });
  }
  for (const p of document.querySelectorAll('.sidebar .side-home, .sidebar .tg-home, .sidebar .side-count')) {
    const r = p.getBoundingClientRect();
    out.pills.push({ cls: String(p.className), txt: (p.textContent || '').trim().slice(0, 18), w: Math.round(r.width), h: Math.round(r.height), fs: getComputedStyle(p).fontSize, disp: getComputedStyle(p).display, lh: getComputedStyle(p).lineHeight });
  }
  for (const t of document.querySelectorAll('.sidebar .tg-name, .sidebar .tg-zh, .sidebar .grp-zh')) {
    const r = t.getBoundingClientRect(); if (!r.width) continue;
    out.treeLabels.push({ cls: String(t.className), txt: (t.textContent || '').trim().slice(0, 30), cw: t.clientWidth, sw: t.scrollWidth, over: t.scrollWidth - t.clientWidth, fs: getComputedStyle(t).fontSize });
  }
  return out;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const vp of [{ n: '1440x900', w: 1440, h: 900, m: false }, { n: '1280x800', w: 1280, h: 800, m: false }, { n: '390x844', w: 390, h: 844, m: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.m, hasTouch: vp.m, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8787/paper/dev/dialogs/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(300);
    if (vp.m) { await page.evaluate(() => { const b = document.querySelector('#nav-toggle'); if (b) b.click(); }); await page.waitForTimeout(400); }
    const d = await page.evaluate(PROBE);
    out[vp.n] = d;
    const trunc = d.summaries.filter((x) => x.isTruncated);
    console.log('=== ' + vp.n + ' summaries=' + d.summaries.length + ' 截断=' + trunc.length + ' pills=' + d.pills.length);
    for (const t of trunc.slice(0, 10)) console.log('   TRUNC "' + t.txt + '"  ttl.' + t.ttlCls + ' ' + t.ttlCW + '→' + t.ttlSW + ' (' + t.overPx + 'px) fs=' + t.fs);
    const uniq = {};
    for (const p of d.pills) { const k = p.cls + '|' + p.w + 'x' + p.h + '|' + p.fs; uniq[k] = (uniq[k] || 0) + 1; }
    console.log('   pills: ' + JSON.stringify(uniq));
    console.log('   treeLabels 截断=' + d.treeLabels.filter((x) => x.over > 1).length + '/' + d.treeLabels.length + '  e.g. ' + JSON.stringify(d.treeLabels.filter((x) => x.over > 1).slice(0, 3)));
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe9.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('写出 reports/critique-red-probe9.json');
})();
