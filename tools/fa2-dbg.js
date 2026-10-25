'use strict';
/* fa2-dbg.js — 临时诊断：dialogs 上「段落 + 代码块」的相邻关系与可同屏性 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--hide-scrollbars'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  for (const url of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
    await p.goto('http://127.0.0.1:8787' + url, { waitUntil: 'load' });
    const r = await p.evaluate(() => {
      const hosts = [...document.querySelectorAll('pre.code-pre')].map((x) => x.closest('.code-scroll') || x);
      const rows = [];
      hosts.forEach((h, i) => {
        const chain = [];
        let n = h.previousElementSibling;
        for (let k = 0; k < 8 && n; k++) {
          chain.push(n.tagName + (n.className ? '.' + String(n.className).split(' ')[0] : ''));
          const inner = n.querySelector && n.querySelector('p');
          if (inner) chain[chain.length - 1] += '>P';
          n = n.previousElementSibling;
        }
        const hr = h.getBoundingClientRect();
        rows.push({ i, h: Math.round(hr.height), w: Math.round(hr.width), chain: chain.join(' | ') });
      });
      /* 兄弟关系：article 的直接子元素序列里 p 与 .code-scroll 的距离 */
      const art = document.querySelector('article.article') || document.querySelector('article');
      const kids = [...art.children].map((e) => e.tagName + (e.className ? '.' + String(e.className).split(' ')[0] : ''));
      return { rows, kids: kids.join(' ').slice(0, 1600) };
    });
    console.log('=== ' + url + ' ===');
    for (const r2 of r.rows) console.log('  pre#' + r2.i + ' h=' + String(r2.h).padEnd(5) + ' w=' + String(r2.w).padEnd(5) + ' prev=' + r2.chain);
    console.log('  article children: ' + r.kids);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
