'use strict';
/** critique-red-probe13.js — 抽屉「当前项不可见」/「☰ 能否关闭」/ 落地页假目标 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = process.cwd();
const EXE = [process.env.CHROME_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'), process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
  const page = await ctx.newPage();

  for (const p of ['/paper/dev/dialogs/', '/paper/dev/particles/', '/paper/reference/permissions/', '/paper/reference/world-configuration/']) {
    await page.goto('http://127.0.0.1:8787' + p, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(300);
    // 真实用户路径：滚到 30% 再开抽屉
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.3));
    await page.waitForTimeout(200);
    await page.evaluate(() => { const b = document.querySelector('#nav-toggle'); if (b) b.click(); });
    await page.waitForTimeout(450);
    const d = await page.evaluate(() => {
      const s = document.querySelector('.sidebar');
      const act = s ? s.querySelector('a.active') : null;
      const r = s ? s.getBoundingClientRect() : null;
      const ar = act ? act.getBoundingClientRect() : null;
      return {
        opened: document.body.classList.contains('nav-open'),
        scrollTop: s ? Math.round(s.scrollTop) : null,
        clientH: s ? s.clientHeight : null, scrollH: s ? s.scrollHeight : null,
        activeCount: s ? s.querySelectorAll('a.active').length : null,
        activeTxt: act ? (act.textContent || '').trim().slice(0, 30) : null,
        activeTopRel: ar && r ? Math.round(ar.top - r.top) : null,
        activeVisible: ar && r ? (ar.top >= r.top && ar.bottom <= r.bottom) : null,
        closeButtonsInsideSidebar: s ? s.querySelectorAll('button').length : null,
        topbarToggleVisible: (() => { const b = document.querySelector('#nav-toggle'); if (!b) return null; const rr = b.getBoundingClientRect(); return { w: Math.round(rr.width), h: Math.round(rr.height), ariaExpanded: b.getAttribute('aria-expanded'), visible: rr.width > 0 }; })(),
      };
    });
    // 再点一次 ☰ 看是否关闭
    await page.evaluate(() => { const b = document.querySelector('#nav-toggle'); if (b) b.click(); });
    await page.waitForTimeout(400);
    const closed = await page.evaluate(() => !document.body.classList.contains('nav-open'));
    out[p] = { ...d, toggleClosesDrawer: closed };
    console.log(p.padEnd(42) + ' scrollTop=' + d.scrollTop + '/' + d.scrollH + ' clientH=' + d.clientH + ' active="' + d.activeTxt + '" relTop=' + d.activeTopRel + ' visible=' + d.activeVisible + ' 侧栏内button=' + d.closeButtonsInsideSidebar + ' ☰可关=' + closed + ' ' + JSON.stringify(d.topbarToggleVisible));
  }

  // 落地页假目标
  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(400);
  out.landing = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.src-item')];
    const g = (el) => { const r = el.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; };
    const withHandler = items.filter((li) => li.onclick || li.getAttribute('onclick') || li.tagName === 'A').length;
    const link = items[0] ? items[0].querySelector('.src-link') : null;
    const relRow = items[0] ? items[0].querySelector('.src-rel') : null;
    const footerLinks = [...document.querySelectorAll('.page-footer a, .info-footer a')].map((a) => ({ t: (a.textContent || '').trim().slice(0, 24), ...g(a), display: getComputedStyle(a).display, parentTextLen: (a.parentElement ? a.parentElement.textContent.trim().length : 0) }));
    return {
      srcItemCount: items.length, srcItemHasOwnHandler: withHandler,
      srcItemH: items[0] ? g(items[0]).h : null,
      srcLink: link ? { ...g(link), href: link.getAttribute('href') } : null,
      srcRel: relRow ? g(relRow) : null,
      coverRatio: items[0] && link ? Math.round((1 - g(link).h / g(items[0]).h) * 100) + '%' : null,
      footerLinks,
    };
  });
  console.log('LANDING ' + JSON.stringify({ srcItemCount: out.landing.srcItemCount, srcItemH: out.landing.srcItemH, srcLink: out.landing.srcLink, srcRel: out.landing.srcRel, coverRatio: out.landing.coverRatio, itemHasHandler: out.landing.srcItemHasOwnHandler }));
  console.log('FOOTER ' + JSON.stringify(out.landing.footerLinks));
  await ctx.close();
  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe13.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('写出 reports/critique-red-probe13.json');
})();
