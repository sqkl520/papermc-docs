'use strict';
/**
 * fa2-c3.js 鈥?鏈€缁堥獙鏀?路 B 缁勶細鏂█ #9/#10/#11 + 蹇呮煡 1锛圕3 閿氱偣閬尅锛? 蹇呮煡 7锛堢Щ鍔ㄧ锛? 涓?old 瀵规瘮
 *
 * 鍙銆傛祴閲忎袱涓熀鍧€锛歨ead=8787 (4ce8407) / old=8788 (a19a6c2)銆? *
 * 瀛愬懡浠わ紙--only=锛夛細
 *   cliff    1021鈫?300 閫?1px 鎵弿 article 瀹藉害锛屽垪 |螖|鈮?0px 鐨勫彴闃讹紙涓ゅ熀鍧€鍚勮窇涓€娆★級
 *   key      1024 / 1200 / 1440 涓変釜鍏抽敭鐐归€愰」鍑犱綍
 *   anchor   1025 / 1100 / 1199 鐐圭洰褰曠 2 椤癸紝閲忔爣棰樿鍚搁《鍏冪礌閬尅姣斾緥锛堝繀椤?0锛? *   overflow 8 妗?脳 6 椤垫í鍚戞孩鍑猴紙鏂█ #11锛? *   mobile   320 / 390 / 768锛氭孩鍑恒€乀OC 鍙敤銆佹娊灞夊紑鍚? *   all      鍏ㄩ儴
 *
 * 鐢ㄦ硶: node tools/fa2-c3.js [--only=all] [--json=<path>]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = { head: 'http://127.0.0.1:8787', old: 'http://127.0.0.1:8788' };
const TMP = path.join(os.tmpdir(), 'fa2');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const ONLY = opt('only', 'all');
const want = (name) => ONLY === 'all' || ONLY.split(',').map((s) => s.trim()).includes(name);
const JSONOUT = opt('json', path.join(TMP, 'fa2-c3.json'));

const OV_PAGES = ['/', '/paper/', '/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/all-pages.html'];
const OV_VPS = [320, 390, 768, 1024, 1100, 1199, 1200, 1440];

const GEOM = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = q('article.article') || q('article');
  const toc = q('.toc-side');
  const side = q('#sidebar') || q('.sidebar');
  const layout = q('.layout');
  const ab = art ? art.getBoundingClientRect() : null;
  const tb = toc ? toc.getBoundingClientRect() : null;
  const tocVis = !!(toc && cs(toc, 'display') !== 'none' && tb.width > 0);
  let mode = 'hidden';
  if (tocVis) {
    if (tb.width < 400 && tb.width < window.innerWidth * 0.5 && ab && tb.x >= ab.x + ab.width - 2) mode = 'rail';
    else mode = 'top-block';
  }
  const de = document.documentElement;
  return {
    vw: window.innerWidth,
    artW: ab ? r2(ab.width) : null,
    artClientW: art ? art.clientWidth : null,
    tocMode: mode,
    tocW: tb ? r2(tb.width) : null,
    tocPos: cs(toc, 'position'),
    tocOpenClass: toc ? toc.classList.contains('toc-open') : null,
    cols: cs(layout, 'gridTemplateColumns'),
    sideW: side ? r2(side.getBoundingClientRect().width) : null,
    hOverflow: de.scrollWidth - de.clientWidth,
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    tocOffset: getComputedStyle(de).getPropertyValue('--toc-offset').trim(),
    scrollPadTop: cs(de, 'scrollPaddingTop'),
    topbarH: q('.topbar') ? r2(q('.topbar').getBoundingClientRect().height) : null,
  };
};

const COVER = () => {
  const q = (s) => document.querySelector(s);
  const vis = (el) => {
    if (!el) return false;
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const h = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
  const target = h ? document.getElementById(h) : null;
  const tr = target ? target.getBoundingClientRect() : null;
  const covers = [];
  const topbar = q('.topbar');
  if (vis(topbar)) covers.push({ name: 'topbar', r: topbar.getBoundingClientRect() });
  const toc = q('.toc-side');
  if (vis(toc)) {
    const pos = getComputedStyle(toc).position;
    if (pos === 'sticky' || pos === 'fixed') covers.push({ name: 'toc-side(' + pos + ')', r: toc.getBoundingClientRect() });
  }
  let coverH = 0;
  const detail = [];
  if (tr) {
    for (const c of covers) {
      const top = Math.max(tr.top, c.r.top);
      const bot = Math.min(tr.bottom, c.r.bottom);
      const left = Math.max(tr.left, c.r.left);
      const right = Math.min(tr.right, c.r.right);
      if (bot > top && right > left) {
        const hh = bot - top;
        coverH = Math.max(coverH, hh);
        detail.push(c.name + '=' + Math.round(hh * 10) / 10);
      }
    }
  }
  const coveredPct = tr && tr.height > 0 ? Math.round((Math.min(coverH, tr.height) / tr.height) * 1000) / 10 : null;
  return {
    hash: h, found: !!target,
    headingTop: tr ? Math.round(tr.top * 10) / 10 : null,
    headingH: tr ? Math.round(tr.height * 10) / 10 : null,
    coveredPct, coverDetail: detail,
    scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
    tocOffset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    tocPos: toc ? getComputedStyle(toc).position : null,
  };
};

const DRAWER = () => {
  const q = (s) => document.querySelector(s);
  const vis = (el) => {
    if (!el) return false;
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const body = document.body;
  const side = q('#sidebar') || q('.sidebar');
  const toc = q('.toc-side');
  return {
    vw: window.innerWidth,
    navToggleVisible: vis(q('#nav-toggle')),
    sidebarVisible: vis(side),
    sidebarX: side ? Math.round(side.getBoundingClientRect().x) : null,
    sidebarW: side ? Math.round(side.getBoundingClientRect().width) : null,
    bodyClass: body.className,
    bodyOverflow: getComputedStyle(body).overflow,
    tocVisible: vis(toc),
    tocPos: toc ? getComputedStyle(toc).position : null,
    tocHeight: toc ? Math.round(toc.getBoundingClientRect().height) : null,
    tocFoldOpen: toc ? !!toc.querySelector('.toc-fold[open]') : null,
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

const settle = (page, k) => page.evaluate((n) => new Promise((res) => {
  let i = 0;
  const step = () => { if (++i >= n) res(); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), k || 2);

const newCtx = (browser, w, h) => browser.newContext({
  viewport: { width: w, height: h || 900 }, deviceScaleFactor: 1,
  colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
});

(async () => {
  if (!EXE) throw new Error('no chrome executable found');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), chrome: EXE, cliff: {}, key: {}, anchor: [], overflow: [], mobile: [], drawer: [] };
  try {
    /* ---------------- cliff: 1021..1300 閫?1px ---------------- */
    if (want('cliff')) {
      for (const base of ['head', 'old']) {
        const ctx = await newCtx(browser, 1021, 900);
        const page = await ctx.newPage();
        await page.goto(BASE[base] + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(120);
        const rows = [];
        for (let w = 1021; w <= 1300; w++) {
          await page.setViewportSize({ width: w, height: 900 });
          await settle(page, 1);
          const g = await page.evaluate(GEOM);
          rows.push(g);
        }
        await ctx.close();
        const steps = [];
        for (let i = 1; i < rows.length; i++) {
          const d = rows[i].artW - rows[i - 1].artW;
          if (Math.abs(d) >= 20) steps.push({ at: rows[i].vw, from: rows[i - 1].artW, to: rows[i].artW, d: Math.round(d * 100) / 100, cols: rows[i].cols, tocMode: rows[i].tocMode });
        }
        out.cliff[base] = { steps, rows: rows.map((r) => ({ vw: r.vw, artW: r.artW, tocMode: r.tocMode, cols: r.cols, sideW: r.sideW, tocW: r.tocW })) };
        console.log('=== CLIFF ' + base + ' (dialogs, 1021..1300 閫?1px, |螖|鈮?0) ===');
        if (!steps.length) console.log('  (鏃犲彴闃?');
        for (const s of steps) console.log('  ' + s.at + ': ' + s.from + ' -> ' + s.to + '  螖=' + s.d + '  toc=' + s.tocMode + '  cols=' + s.cols);
      }
    }

    /* ---------------- key: 1024 / 1200 / 1440 ---------------- */
    if (want('key')) {
      for (const base of ['head', 'old']) {
        out.key[base] = {};
        for (const w of [1024, 1200, 1440]) {
          const ctx = await newCtx(browser, w, 900);
          const page = await ctx.newPage();
          const rec = {};
          for (const p of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
            await page.goto(BASE[base] + p, { waitUntil: 'load', timeout: 60000 });
            await page.waitForTimeout(120);
            await settle(page, 2);
            rec[p] = await page.evaluate(GEOM);
          }
          await ctx.close();
          out.key[base][w] = rec;
          console.log('KEY ' + base + ' @' + w + ': dialogs artW=' + rec['/paper/dev/dialogs/'].artW + ' toc=' + rec['/paper/dev/dialogs/'].tocMode + ' cols=' + rec['/paper/dev/dialogs/'].cols);
        }
      }
    }

    /* ---------------- anchor: coveredPct ---------------- */
    if (want('anchor')) {
      for (const base of ['head', 'old']) {
        for (const w of [1025, 1100, 1199]) {
          const ctx = await newCtx(browser, w, 900);
          const page = await ctx.newPage();
          await page.goto(BASE[base] + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(160);
          await settle(page, 2);
          const pick = await page.evaluate(() => {
            const links = [...document.querySelectorAll('.toc-side a[href^="#"]')]
              .filter((a) => { const c = getComputedStyle(a); return c.display !== 'none' && a.getBoundingClientRect().height > 0; });
            if (links.length < 2) return null;
            const a = links[1];
            return { href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 40), total: links.length };
          });
          let rec = { base, vw: w, picked: pick, coveredPct: null };
          if (pick) {
            await page.evaluate((href) => {
              const a = [...document.querySelectorAll('.toc-side a[href="' + href + '"]')][0];
              if (a) a.click();
            }, pick.href);
            await page.waitForTimeout(1400);
            await settle(page, 3);
            rec = Object.assign(rec, await page.evaluate(COVER));
          }
          await ctx.close();
          out.anchor.push(rec);
          console.log('ANCHOR ' + base + ' @' + w + ' hash=' + (rec.hash || '-') + ' coveredPct=' + rec.coveredPct +
            ' top=' + rec.headingTop + ' pad=' + rec.scrollPadTop + ' tocOffset=' + rec.tocOffset + ' tocPos=' + rec.tocPos);
        }
      }
    }

    /* ---------------- overflow: 8 脳 6 ---------------- */
    if (want('overflow')) {
      for (const base of ['head', 'old']) {
        out.overflow[base] = [];
        for (const w of OV_VPS) {
          const ctx = await newCtx(browser, w, 900);
          const page = await ctx.newPage();
          for (const p of OV_PAGES) {
            await page.goto(BASE[base] + p, { waitUntil: 'load', timeout: 60000 });
            await page.waitForTimeout(90);
            await settle(page, 2);
            const m = await page.evaluate(() => ({
              hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              scrollW: document.documentElement.scrollWidth,
              clientW: document.documentElement.clientWidth,
            }));
            out.overflow[base].push(Object.assign({ vw: w, page: p }, m));
          }
          await ctx.close();
        }
        console.log('OVERFLOW ' + base + ':');
        for (const w of OV_VPS) {
          const row = out.overflow[base].filter((r) => r.vw === w);
          console.log('  ' + String(w).padEnd(6) + 'max=' + String(Math.max(...row.map((r) => r.hOverflow))).padEnd(5) + ' per-page=[' + row.map((r) => r.hOverflow).join(',') + ']');
        }
      }
    }

    /* ---------------- mobile: 320/390/768 ---------------- */
    if (want('mobile')) {
      for (const base of ['head', 'old']) {
        for (const w of [320, 390, 768]) {
          const ctx = await newCtx(browser, w, 844);
          const page = await ctx.newPage();
          await page.goto(BASE[base] + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(140);
          await settle(page, 2);
          const before = await page.evaluate(DRAWER);
          /* 寮€鎶藉眽 */
          let after = null;
          if (before.navToggleVisible) {
            await page.evaluate(() => { const t = document.querySelector('#nav-toggle'); if (t) t.click(); });
            await page.waitForTimeout(320);
            await settle(page, 2);
            after = await page.evaluate(DRAWER);
            /* 鍏冲洖鍘伙紙Esc锛?*/
            await page.keyboard.press('Escape');
            await page.waitForTimeout(280);
          }
          const closed = await page.evaluate(DRAWER);
          /* 妯悜婧㈠嚭锛堟粴鍒板簳锛屾姄 lazy 鍥惧悗鐨勭湡瀹炲锛?*/
          const ov = await page.evaluate(async () => {
            const imgs = [...document.images];
            for (const im of imgs) { im.loading = 'eager'; try { await im.decode(); } catch (e) {} }
            const de = document.documentElement;
            window.scrollTo(0, de.scrollHeight);
            await new Promise((r) => setTimeout(r, 120));
            window.scrollTo(0, 0);
            await new Promise((r) => setTimeout(r, 120));
            return de.scrollWidth - de.clientWidth;
          });
          await ctx.close();
          out.mobile.push({ base, vw: w, closed, open: after, ovAfterImages: ov });
          console.log('MOBILE ' + base + ' @' + w + ' hOv=' + closed.hOverflow + ' (imgs loaded=' + ov + ') navToggle=' + closed.navToggleVisible +
            ' sidebarVis=' + closed.sidebarVisible + (after ? ' | opened: sidebarVis=' + after.sidebarVisible + ' x=' + after.sidebarX + ' bodyOverflow=' + after.bodyOverflow : '') +
            ' | tocVis=' + closed.tocVisible + ' tocPos=' + closed.tocPos + ' foldOpen=' + closed.tocFoldOpen);
        }
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(JSONOUT, JSON.stringify(out, null, 1), 'utf8');
    console.log('\nJSON: ' + JSONOUT);
  }
})().catch((e) => { console.error(e); process.exit(1); });

