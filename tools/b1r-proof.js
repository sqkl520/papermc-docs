'use strict';
/**
 * b1r-proof.js — 取证：截图 + 无 JS 降级 + 正确的二维遮挡判定 + 拉伸链接右键菜单 + 1440 元素级归因
 * 用法: node tools/b1r-proof.js   （日志 reports/.b1r-proof.log，图 reports/b1r-shots/*.png）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'reports', 'b1r-shots');
const LOGP = path.join(ROOT, 'reports', '.b1r-proof.log');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';
const PAGE = '/paper/dev/particles/';

function log(s) { try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {} console.log(s); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  try { fs.unlinkSync(LOGP); } catch (e) {}
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = {};

  // ---------- 1) 无 JS 降级：桌面右栏目录是否变空 ----------
  {
    const jsOff = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, javaScriptEnabled: false });
    const page = await jsOff.newPage();
    for (const [tag, base] of [['new-noJS', NEW], ['old-noJS', OLD]]) {
      await page.goto(base + '/paper/dev/particles/', { waitUntil: 'load' });
      await page.waitForTimeout(500);
      const r = await page.evaluate(() => {
        const t = document.querySelector('.toc-side');
        if (!t) return { present: false };
        const d = t.querySelector('details');
        const ol = t.querySelector('ol');
        const links = t.querySelectorAll('ol a');
        return {
          present: true, display: getComputedStyle(t).display,
          detailsOpen: d ? d.open : null,
          tocH: Math.round(t.getBoundingClientRect().height),
          olDisplay: ol ? getComputedStyle(ol).display : null,
          linkCount: links.length,
          linkVisible: links.length ? links[0].getBoundingClientRect().height > 0 : false,
          railEmpty: links.length > 0 && links[0].getBoundingClientRect().height === 0,
        };
      });
      out['jsOff_' + tag] = r;
      log('NOJS ' + tag + ' ' + JSON.stringify(r));
    }
    // 无 JS 时 768 档：面板是否还折叠（layout.js 默认无 open → 折叠）
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    out.jsOff_768 = await page.evaluate(() => {
      const t = document.querySelector('.toc-side');
      const d = t.querySelector('details');
      return { detailsOpen: d.open, tocH: Math.round(t.getBoundingClientRect().height), h1Top: Math.round(document.querySelector('h1').getBoundingClientRect().top) };
    });
    log('NOJS 768 ' + JSON.stringify(out.jsOff_768));
    // 截图：桌面右栏无 JS
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-nojs-1440.png'), clip: { x: 1190, y: 0, width: 250, height: 500 } });
    await jsOff.close();
  }

  // ---------- 2) 正确的二维遮挡判定 + 截图 ----------
  {
    out.cover = [];
    for (const vp of [{ n: '768x1024', w: 768, h: 1024 }, { n: '390x844', w: 390, h: 844 }, { n: '1440x900', w: 1440, h: 900 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(NEW + PAGE, { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.waitForTimeout(250);
      // 折叠态（默认）：点目录项后目标标题是否被折叠条遮住
      const collapsed = await (async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(150);
        const id = await page.evaluate(() => {
          const a = document.querySelectorAll('.toc-side ol li a');
          return a.length > 2 ? a[2].getAttribute('href').slice(1) : null;
        });
        if (!id) return null;
        await page.evaluate((h) => { location.hash = '#' + h; }, id);
        await page.waitForTimeout(500);
        return page.evaluate((h) => {
          const el = document.getElementById(h);
          const b = el.getBoundingClientRect();
          const t = document.querySelector('.toc-side').getBoundingClientRect();
          const overlapX = b.left < t.right && b.right > t.left;
          const overlapY = b.top < t.bottom && b.bottom > t.top;
          // 命中测试：标题中心点是谁
          const cx = Math.min(b.left + 20, b.right - 1), cy = b.top + Math.min(8, b.height / 2);
          const hitEl = document.elementFromPoint(cx, cy);
          return {
            id: h, headingTop: Math.round(b.top), headingBottom: Math.round(b.bottom),
            tocTop: Math.round(t.top), tocBottom: Math.round(t.bottom),
            overlapX, overlapY, reallyCovered: overlapX && overlapY,
            hitElementAtHeading: hitEl ? (hitEl.tagName + '.' + (hitEl.className || '')) : null,
            hitIsToc: !!(hitEl && hitEl.closest && hitEl.closest('.toc-side')),
            scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
          };
        }, id);
      })();
      out.cover.push({ vp: vp.n, state: 'collapsed-hashJump', ...collapsed });
      log('COVER ' + JSON.stringify({ vp: vp.n, state: 'collapsed', ...collapsed }));

      // 截图取证：折叠态 hash 跳转后首屏
      await page.screenshot({ path: path.join(SHOTS, 'collapsed-hashjump-' + vp.n + '.png') });

      // 展开态：滚动到中段后截图 + 遮挡统计
      await page.evaluate(() => { document.querySelector('.toc-side details').open = true; });
      await page.waitForTimeout(250);
      await page.evaluate(() => window.scrollTo(0, 1200));
      await page.waitForTimeout(200);
      const expanded = await page.evaluate(() => {
        const t = document.querySelector('.toc-side');
        const tb = t.getBoundingClientRect();
        const blocks = Array.from(document.querySelectorAll('.article p, .article h2, .article h3, .article li, .article pre'));
        let covered = 0;
        for (const el of blocks) {
          const b = el.getBoundingClientRect();
          if (b.width <= 0 || b.height <= 0) continue;
          if (b.bottom > tb.top && b.top < tb.bottom && b.left < tb.right && b.right > tb.left) covered++;
        }
        return {
          tocTop: Math.round(tb.top), tocBottom: Math.round(tb.bottom), tocH: Math.round(tb.height),
          pctVh: +(100 * tb.height / window.innerHeight).toFixed(1),
          coveredBlocks2D: covered,
          contentVisibleAreaPct: +(100 * Math.max(0, (window.innerHeight - tb.bottom)) / window.innerHeight).toFixed(1),
        };
      });
      out.cover.push({ vp: vp.n, state: 'expanded-scrolled', ...expanded });
      log('COVER ' + JSON.stringify({ vp: vp.n, state: 'expanded', ...expanded }));
      await page.screenshot({ path: path.join(SHOTS, 'expanded-scrolled-' + vp.n + '.png') });
      await ctx.close();
    }
  }

  // ---------- 3) 拉伸链接：右键菜单目标 + 复制文本可达性 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const target = await page.evaluate(() => {
      const item = document.querySelector('.src-item');
      const sum = item.querySelector('.src-sum');
      const rel = item.querySelector('.src-rel');
      item.scrollIntoView({ block: 'center' });
      return { sum: (() => { const b = sum.getBoundingClientRect(); return { x: b.left + 40, y: b.top + b.height / 2 }; })(),
               rel: (() => { const b = rel.getBoundingClientRect(); return { x: b.left + 10, y: b.top + b.height / 2 }; })(),
               link: (() => { const b = item.querySelector('.src-link').getBoundingClientRect(); return { x: b.left + 10, y: b.top + b.height / 2 }; })(),
               emptyRight: (() => { const b = item.getBoundingClientRect(); return { x: b.right - 12, y: b.top + b.height / 2 }; })() };
    });
    const hits = {};
    for (const [k, pt] of Object.entries(target)) {
      hits[k] = await page.evaluate((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        if (!el) return null;
        const a = el.closest ? el.closest('a') : null;
        return { tag: el.tagName, cls: String(el.className || ''), closestAnchor: a ? a.getAttribute('href') : null, isLink: !!a };
      }, pt);
    }
    out.stretchHits = hits;
    log('STRETCHHITS ' + JSON.stringify(hits));
    await page.screenshot({ path: path.join(SHOTS, 'src-item-1440.png'), clip: await page.evaluate(() => { const b = document.querySelector('.src-item').getBoundingClientRect(); return { x: Math.max(0, b.left - 8), y: Math.max(0, b.top - 8), width: Math.min(1400, b.width + 16), height: b.height + 16 }; }) });
    await ctx.close();
  }

  // ---------- 4) 1440 档元素级归因：哪些元素高度变了 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const u of ['/paper/reference/world-configuration/', '/paper/dev/particles/', '/paper/dev/dialogs/']) {
      const collect = async (base) => {
        await page.goto(base + u, { waitUntil: 'load' });
        await page.waitForTimeout(450);
        return page.evaluate(() => {
          const acc = {};
          document.querySelectorAll('.article *, .page-head *').forEach((e) => {
            const sig = e.tagName + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '');
            const b = e.getBoundingClientRect();
            const k = sig + '|' + (e.textContent || '').trim().slice(0, 24);
            if (!acc[k]) acc[k] = { sig, h: 0, w: Math.round(b.width), n: 0 };
            acc[k].h += b.height; acc[k].n++;
          });
          return acc;
        });
      };
      const n = await collect(NEW); const o = await collect(OLD);
      const diffs = [];
      const keys = new Set([...Object.keys(n), ...Object.keys(o)]);
      for (const k of keys) {
        const a = n[k], b = o[k];
        const hn = a ? a.h : 0, ho = b ? b.h : 0;
        const d = hn - ho;
        if (Math.abs(d) >= 1) {
          const sig = (a && a.sig) || (b && b.sig);
          diffs.push({ sig, key: k.slice(-40), n: a ? a.n : 0, oldN: b ? b.n : 0, hNew: +hn.toFixed(1), hOld: +ho.toFixed(1), d: +d.toFixed(1) });
        }
      }
      diffs.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
      out['elemDiff_' + u.replace(/\W+/g, '_')] = diffs.slice(0, 12);
      log('ELEMDIFF ' + u + ' top=' + JSON.stringify(diffs.slice(0, 8)));
    }
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-proof.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE');
})();
