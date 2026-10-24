'use strict';
/**
 * b1g-final.js - three loose ends:
 *  (1) does the plan's "article.y 1317" correspond to an EXPANDED mobile TOC?
 *      (open the after-build <details> at 390 and re-measure)
 *  (2) what sits between .content and <article> on mobile (the +22px gap)
 *  (3) how many pages carry .toc-side (blast radius of the 1025 threshold move)
 *
 * Usage: node tools/b1g-final.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { generated_at: new Date().toISOString() };

  // (3) blast radius: count pages with a toc-side in the built site
  let tocPages = 0; let htmlPages = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'archive' || e.name === 'node_modules' || e.name === '.git' || e.name === 'tools' || e.name === 'reports') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) {
        htmlPages++;
        const s = fs.readFileSync(p, 'utf8');
        if (s.includes('class="toc-side"')) tocPages++;
      }
    }
  };
  walk('.');
  out.blastRadius = { htmlPages, tocPages };

  // (1) + (2)
  const DUMP = () => {
    const q = (s) => document.querySelector(s);
    const bx = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { y: Math.round(b.y * 100) / 100, h: Math.round(b.height * 100) / 100 }; };
    const toc = q('.toc-side');
    const content = q('.content');
    const kids = content ? [...content.children].map((c) => ({
      tag: c.tagName.toLowerCase(),
      cls: typeof c.className === 'string' ? c.className : '',
      y: Math.round(c.getBoundingClientRect().y * 100) / 100,
      h: Math.round(c.getBoundingClientRect().height * 100) / 100,
    })) : [];
    return {
      tocH: toc ? Math.round(toc.getBoundingClientRect().height * 100) / 100 : null,
      tocOpen: toc ? toc.hasAttribute('open') : null,
      article: bx(q('article')), pageH: document.documentElement.scrollHeight,
      contentKids: kids,
    };
  };

  for (const [side, base] of [['after', 'http://127.0.0.1:8787'], ['before', 'http://127.0.0.1:8788']]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(400);
    out[side + ' 390 folded'] = await page.evaluate(DUMP);
    // force-expand the TOC (the state the plan diagnosed as "24 items all open")
    const forced = await page.evaluate(() => {
      const toc = document.querySelector('.toc-side');
      if (!toc) return false;
      toc.setAttribute('open', '');
      return true;
    });
    if (forced) {
      await page.waitForTimeout(350);
      out[side + ' 390 expanded'] = await page.evaluate(DUMP);
    }
    await ctx.close();
  }
  await browser.close();

  fs.writeFileSync(path.join('reports', 'b1-shots', '_final.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('blast radius: ' + JSON.stringify(out.blastRadius));
  for (const k of Object.keys(out)) {
    if (k === 'generated_at' || k === 'blastRadius') continue;
    const v = out[k];
    console.log(k + ' tocH=' + v.tocH + ' open=' + v.tocOpen + ' article=' + JSON.stringify(v.article) + ' pageH=' + v.pageH);
    console.log('   contentKids=' + JSON.stringify(v.contentKids));
  }
})();
