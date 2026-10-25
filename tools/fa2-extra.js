'use strict';
/**
 * fa2-extra.js — 必查 2（C2 视觉截图）/ 3（C4 CLS + 变形）/ 4（C5 四条）
 *
 * 只读。截图只写 reports/fa-shots/。
 *
 *   --only=shots   3 张截图（1440 dialogs / 1440 worldcfg / 390 dialogs）
 *   --only=cls     dialogs @1440 CLS + 3 张不同纵横比图的变形校验
 *   --only=c5      C5 四条：h5 字号 / 320px td 词中断 / filter-bar sticky / grp-name 截断
 *   --only=tile    生成 C2 锯齿对比长图（正文列 vs 代码列边界）
 *
 * 用法: node tools/fa2-extra.js [--only=all]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'reports', 'fa-shots');
const TMP = path.join(os.tmpdir(), 'fa2');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const BASE = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const ONLY = opt('only', 'all');
const want = (n) => ONLY === 'all' || ONLY.split(',').map((s) => s.trim()).includes(n);

const settle = (page, k) => page.evaluate((n) => new Promise((res) => {
  let i = 0;
  const step = () => { if (++i >= n) res(); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), k || 2);

const loadAll = async (page) => {
  await page.evaluate(async () => {
    const imgs = [...document.images];
    for (const im of imgs) { im.loading = 'eager'; if (im.decode) { try { await im.decode(); } catch (e) {} } }
    const de = document.documentElement;
    window.scrollTo({ top: de.scrollHeight, left: 0, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 140));
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => {
      im.addEventListener('load', r, { once: true });
      im.addEventListener('error', r, { once: true });
      setTimeout(r, 2000);
    }))));
  });
  await page.waitForTimeout(140);
  await settle(page, 3);
};

/* ---------------------------------------------------------------- shots */
async function doShots(browser, out) {
  const jobs = [
    { name: '1440-dialogs-text-vs-code.png', vw: 1440, vh: 900, path: '/paper/dev/dialogs/', pick: 'adjacent', note: '正文列 637.98 vs 代码块 847（同屏相邻）' },
    { name: '1440-worldcfg-text-vs-code.png', vw: 1440, vh: 900, path: '/paper/reference/world-configuration/', pick: 'adjacent', note: '正文 636.89 vs 代码 851~875（锯齿最大）' },
    { name: '390-dialogs.png', vw: 390, vh: 844, path: '/paper/dev/dialogs/', pick: 'top', note: '移动端 390 档' },
    { name: '1440-dialogs-guides.png', vw: 1440, vh: 900, path: '/paper/dev/dialogs/', pick: 'adjacent', guides: true, note: '注：红=正文右边界 637.98，蓝=代码块右边界 847（叠加为测量辅助，不写盘）' },
  ];
  out.shots = [];
  for (const j of jobs) {
    const ctx = await browser.newContext({
      viewport: { width: j.vw, height: j.vh }, deviceScaleFactor: 1,
      colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
    });
    const page = await ctx.newPage();
    await page.goto(BASE + j.path, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(200);
    await loadAll(page);
    let anchor = null;
    if (j.pick === 'adjacent') {
      /* 找「段落 + 紧随代码块」的最佳组合：优先选代码块最高的那一对，滚动到段落顶部 */
      anchor = await page.evaluate(() => {
        /* pre 在 figure.code-block 内，figure 的前兄弟是 figcaption，所以不能从 pre 往上找兄弟。
           改用文档序：取所有「正文 p」中最后一个 top 小于代码块 top 的，即为最近的上一段。 */
        const art = document.querySelector('article.article') || document.querySelector('article');
        const isProse = (el) => {
          if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer, figcaption, .code-title')) return false;
          return (el.textContent || '').trim().length >= 40;
        };
        const paras = [...art.querySelectorAll('p')].filter(isProse);
        const hosts = [...document.querySelectorAll('pre.code-pre')].map((x) => x.closest('.code-scroll') || x);
        let best = null;
        for (const host of hosts) {
          const hr = host.getBoundingClientRect();
          if (hr.height < 90) continue;
          let pEl = null;
          for (const p of paras) {
            const r = p.getBoundingClientRect();
            if (r.bottom <= hr.top + 2 && (!pEl || r.bottom > pEl.getBoundingClientRect().bottom)) pEl = p;
          }
          if (!pEl) continue;
          const prr = pEl.getBoundingClientRect();
          const codeVisible = Math.min(hr.height, 460);
          const fit = prr.height + codeVisible;
          if (fit > window.innerHeight * 0.84) continue;
          if (!best || fit > best.score) {
            best = {
              score: Math.round(fit),
              y: Math.max(0, window.scrollY + prr.top - 200),
              hostH: Math.round(hr.height), hostW: Math.round(hr.width),
              pW: Math.round(prr.width * 100) / 100, pH: Math.round(prr.height),
              pText: (pEl.textContent || '').trim().slice(0, 40),
            };
          }
        }
        return best;
      });
      if (anchor) {
        await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' }), anchor.y);
        await page.waitForTimeout(220);
        await settle(page, 3);
      }
      if (j.guides) {
        await page.evaluate(() => {
          const art = document.querySelector('article.article') || document.querySelector('article');
          const inView = (r) => r.bottom > 80 && r.top < window.innerHeight - 20;
          const p = [...art.querySelectorAll('p')].find((x) => (x.textContent || '').trim().length >= 40 && inView(x.getBoundingClientRect()));
          const hosts = [...document.querySelectorAll('pre.code-pre')].map((x) => x.closest('.code-scroll') || x);
          const host = hosts.find((h) => inView(h.getBoundingClientRect()));
          if (!p || !host) return;
          const pr = p.getBoundingClientRect();
          const hr = host.getBoundingClientRect();
          const mk = (x, color, label) => {
            const d = document.createElement('div');
            d.style.cssText = 'position:fixed;top:0;bottom:0;width:2px;z-index:99999;pointer-events:none;background:' + color;
            d.style.left = Math.round(x) + 'px';
            document.body.appendChild(d);
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;background:' + color + ';color:#fff;font:11px/1.6 monospace;padding:2px 6px;left:' + Math.round(x) + 'px;top:4px';
            t.textContent = label;
            document.body.appendChild(t);
          };
          mk(pr.right, '#d00', 'p right ' + Math.round(pr.right * 100) / 100);
          mk(hr.right, '#06c', 'code right ' + Math.round(hr.right * 100) / 100);
        });
        await page.waitForTimeout(120);
      }
    }
    const p = path.join(SHOTS, j.name);
    await page.screenshot({ path: p, fullPage: false });
    const scrollY = await page.evaluate(() => Math.round(window.scrollY));
    out.shots.push({ name: j.name, vw: j.vw, vh: j.vh, path: j.path, scrollY, anchor, note: j.note, bytes: fs.statSync(p).size });
    console.log('SHOT ' + j.name + ' scrollY=' + scrollY + ' anchor=' + JSON.stringify(anchor) + ' ' + fs.statSync(p).size + 'B');
    await ctx.close();
  }
}

/* ---------------------------------------------------------------- cls */
async function doCls(browser, out) {
  /* CLS：CDP 冷缓存 + 限速，模拟真实首屏；与 tools/c45-cls.js 同法 */
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 120, downloadThroughput: Math.round(220 * 1024), uploadThroughput: Math.round(220 * 1024) });
  await page.addInitScript(() => {
    window.__cls = { total: 0, max: 0, count: 0, entries: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__cls.total += e.value;
          window.__cls.count += 1;
          if (e.value > window.__cls.max) window.__cls.max = e.value;
          window.__cls.entries.push({
            v: +e.value.toFixed(5), t: Math.round(e.startTime),
            src: (e.sources || []).map((s) => {
              const n = s.node;
              if (!n) return '';
              const t = (n.tagName || '').toLowerCase();
              const src = (n.currentSrc || (n.getAttribute && n.getAttribute('src')) || '');
              return t + (src ? ':' + String(src).split('/').pop().slice(0, 48) : '');
            }).slice(0, 3),
          });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}
  });
  await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 90000 });
  /* 滚到底触 lazy（CLS 主要在图片进视口时发生） */
  await page.evaluate(async () => {
    const de = document.documentElement;
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < de.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 200));
    }
    window.scrollTo(0, de.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });
  const cls = await page.evaluate(() => window.__cls);

  /* 变形校验：3 张不同纵横比的内容图，比较属性比 vs 渲染内容盒比 */
  const imgs = await page.evaluate(() => {
    const all = [...document.querySelectorAll('img.content-img')].filter((i) => {
      const r = i.getBoundingClientRect();
      const aw = parseInt(i.getAttribute('width') || '0', 10);
      const ah = parseInt(i.getAttribute('height') || '0', 10);
      return r.width > 40 && aw > 0 && ah > 0;
    });
    const ratio = (i) => parseInt(i.getAttribute('width'), 10) / parseInt(i.getAttribute('height'), 10);
    const uniq = [];
    const seen = new Set();
    for (const i of all) {
      const k = i.getAttribute('width') + 'x' + i.getAttribute('height');
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(i);
    }
    return uniq.slice(0, 8).map((i) => {
      const r = i.getBoundingClientRect();
      const cs = getComputedStyle(i);
      const bl = parseFloat(cs.borderLeftWidth) || 0;
      const br2 = parseFloat(cs.borderRightWidth) || 0;
      const bt = parseFloat(cs.borderTopWidth) || 0;
      const bb = parseFloat(cs.borderBottomWidth) || 0;
      const aw = parseInt(i.getAttribute('width'), 10);
      const ah = parseInt(i.getAttribute('height'), 10);
      /* 内容盒 = border-box rect 减边框；box-sizing:border-box 时 img 的固有比由内容盒决定 */
      const cw = r.width - bl - br2;
      const ch = r.height - bt - bb;
      return {
        src: String(i.currentSrc || i.src).split('/').pop().slice(0, 56),
        attr: aw + 'x' + ah, attrRatio: Math.round((aw / ah) * 10000) / 10000,
        rect: Math.round(r.width * 100) / 100 + 'x' + Math.round(r.height * 100) / 100,
        contentBox: Math.round(cw * 100) / 100 + 'x' + Math.round(ch * 100) / 100,
        renderRatio: ch > 0 ? Math.round((cw / ch) * 10000) / 10000 : null,
        driftPct: ch > 0 ? Math.round(((cw / ch) / (aw / ah) - 1) * 10000) / 100 : null,
        natW: i.naturalWidth, natH: i.naturalHeight,
        hasDims: !!(i.getAttribute('width') && i.getAttribute('height')),
      };
    });
  });

  /* 对照：同一个 page 上剥掉 width/height 后重载，看 CLS（证明 dims 是原因） */
  await ctx.close();

  const ctx2 = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
  });
  const page2 = await ctx2.newPage();
  await page2.route('**/paper/dev/dialogs/**', async (route) => {
    const resp = await route.fetch();
    let body = await resp.text();
    body = body.replace(/(<img\b[^>]*?class="[^"]*content-img[^"]*"[^>]*?)\swidth="\d+"\sheight="\d+"/g, '$1')
      .replace(/(<img\b[^>]*?)\swidth="(\d+)"\sheight="(\d+)"([^>]*?class="[^"]*content-img[^"]*")/g, '$1$4');
    await route.fulfill({ status: resp.status(), headers: resp.headers(), body });
  });
  const cdp2 = await ctx2.newCDPSession(page2);
  await cdp2.send('Network.enable');
  await cdp2.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp2.send('Network.emulateNetworkConditions', { offline: false, latency: 120, downloadThroughput: Math.round(220 * 1024), uploadThroughput: Math.round(220 * 1024) });
  await page2.addInitScript(() => {
    window.__cls = { total: 0, max: 0, count: 0, entries: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__cls.total += e.value;
          window.__cls.count += 1;
          if (e.value > window.__cls.max) window.__cls.max = e.value;
          window.__cls.entries.push({ v: +e.value.toFixed(5), t: Math.round(e.startTime), src: (e.sources || []).map((s) => (s.node ? (s.node.tagName || '') : '')).slice(0, 3) });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}
  });
  await page2.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 90000 });
  await page2.evaluate(async () => {
    const de = document.documentElement;
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < de.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 200));
    }
    window.scrollTo(0, de.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });
  const clsNoDims = await page2.evaluate(() => window.__cls);
  const dimsStripped = await page2.evaluate(() => [...document.querySelectorAll('img.content-img')].filter((i) => i.getAttribute('width')).length);
  await ctx2.close();

  out.cls = { withDims: cls, withoutDims: clsNoDims, imgsWithDimsAfterStrip: dimsStripped, imgs };
  console.log('CLS dialogs@1440 withDims=' + cls.total.toFixed(5) + ' (entries=' + cls.count + ', max=' + cls.max.toFixed(5) + ')');
  console.log('CLS dialogs@1440 withoutDims=' + clsNoDims.total.toFixed(5) + ' (entries=' + clsNoDims.count + ') afterStrip remainingDims=' + dimsStripped);
  for (const e of (cls.entries || []).slice(0, 6)) console.log('   shift ' + e.v + ' @' + e.t + 'ms  ' + e.src.join(','));
  console.log('变形校验（属性比 vs 渲染内容盒比，drift 应 ≈0）:');
  for (const i of imgs) console.log('   ' + (i.attr + '').padEnd(11) + ' rect=' + i.rect.padEnd(17) + ' content=' + i.contentBox.padEnd(17) + ' attrRatio=' + i.attrRatio + ' render=' + i.renderRatio + ' drift=' + i.driftPct + '%  ' + i.src);
}

/* ---------------------------------------------------------------- c5 */
async function doC5(browser, out) {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 844 }, deviceScaleFactor: 1,
    colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
  });
  const page = await ctx.newPage();

  /* 1) h5 字号（cli-arguments 31 个 h5） */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + '/paper/reference/cli-arguments/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(150);
  const h5 = await page.evaluate(() => {
    const art = document.querySelector('article.article') || document.querySelector('article');
    const hs = [...(art ? art.querySelectorAll('h5') : [])];
    const body = art ? getComputedStyle(art.querySelector('p') || art) : null;
    return {
      count: hs.length,
      fontSizes: [...new Set(hs.map((h) => Math.round(parseFloat(getComputedStyle(h).fontSize) * 100) / 100))],
      colors: [...new Set(hs.map((h) => getComputedStyle(h).color))].slice(0, 4),
      bodyFs: body ? Math.round(parseFloat(body.fontSize) * 100) / 100 : null,
      h4: (() => { const h = art && art.querySelector('h4'); return h ? Math.round(parseFloat(getComputedStyle(h).fontSize) * 100) / 100 : null; })(),
      h6: (() => { const h = art && art.querySelector('h6'); return h ? Math.round(parseFloat(getComputedStyle(h).fontSize) * 100) / 100 : null; })(),
      h3: (() => { const h = art && art.querySelector('h3'); return h ? Math.round(parseFloat(getComputedStyle(h).fontSize) * 100) / 100 : null; })(),
    };
  });

  /* 2) 320px 表格词中断：找「单词被从中间断开」的单元格 */
  const broken = async (w) => {
    await page.setViewportSize({ width: w, height: 844 });
    const pages = ['/paper/reference/world-configuration/', '/paper/reference/cli-arguments/', '/velocity/tuning/', '/paper/dev/dialogs/'];
    const res = [];
    for (const p of pages) {
      await page.goto(BASE + p, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(120);
      await settle(page, 2);
      const r = await page.evaluate(() => {
        const wraps = [...document.querySelectorAll('.table-wrap')];
        let cells = 0;
        const bad = [];
        for (const w2 of wraps) {
          for (const td of w2.querySelectorAll('td,th')) {
            const t = (td.textContent || '').trim();
            if (!t) continue;
            cells++;
            /* 逐字符量：只要一行里出现「左半 + 右半」同属一个不含空格的 token 被折行，就记一处 */
            const rg = document.createRange();
            rg.selectNodeContents(td);
            const rects = [...rg.getClientRects()].filter((x) => x.width > 0.5);
            if (rects.length < 2) continue;
            /* 用 Range 逐字符定位折行点：同一 token 跨两行 = 词中断 */
            const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
            let n;
            const charRects = [];
            while ((n = walker.nextNode())) {
              const s = n.nodeValue || '';
              for (let i = 0; i < s.length; i++) {
                const rr = document.createRange();
                rr.setStart(n, i); rr.setEnd(n, i + 1);
                const b = rr.getBoundingClientRect();
                if (b.width > 0.01) charRects.push({ ch: s[i], top: Math.round(b.top * 10) / 10, left: Math.round(b.left * 10) / 10, right: Math.round(b.right * 10) / 10 });
              }
            }
            /* 找折行：top 增大时，若折行点所在 token（不含空白的连续字符）跨了行边界 -> 词中断 */
            for (let i = 1; i < charRects.length; i++) {
              if (charRects[i].top > charRects[i - 1].top + 1) {
                const a = charRects[i - 1].ch, b2 = charRects[i].ch;
                /* 两侧都不是空白/标点 = 硬断词 */
                const isSpace = (c) => /[\s\u3000]/.test(c);
                const isPunct = (c) => /[，。、；：！？,.;:!?)\]}>|/\\-]/.test(c);
                if (!isSpace(a) && !isSpace(b2) && !isPunct(a) && !isPunct(b2)) {
                  bad.push({ cell: t.slice(0, 26), at: a + '|' + b2, text: t.slice(Math.max(0, 0), 40) });
                  break;
                }
              }
            }
          }
        }
        return { tables: wraps.length, cells, broken: bad.length, samples: bad.slice(0, 5) };
      });
      res.push(Object.assign({ page: p, vw: w }, r));
    }
    return res;
  };
  const broke320 = await broken(320);

  /* 3) filter-bar sticky：滚 5000px 后是否仍可见 + top 值 */
  await page.setViewportSize({ width: 1440, height: 900 });
  const fb = [];
  for (const p of ['/paper/', '/paper/dev/dialogs/', '/velocity/', '/all-pages.html', '/paper/reference/world-configuration/']) {
    await page.goto(BASE + p, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(140);
    const has = await page.evaluate(() => {
      const f = document.querySelector('.filter-bar');
      return f ? { present: true, pos: getComputedStyle(f).position, top: getComputedStyle(f).top, z: getComputedStyle(f).zIndex } : { present: false };
    });
    if (!has.present) { fb.push(Object.assign({ page: p }, has)); continue; }
    const after = await page.evaluate(async () => {
      const f = document.querySelector('.filter-bar');
      const before = f.getBoundingClientRect();
      window.scrollTo({ top: 5000, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 200));
      const b = f.getBoundingClientRect();
      const cs = getComputedStyle(f);
      return {
        y0: Math.round(before.top * 10) / 10,
        y5000: Math.round(b.top * 10) / 10,
        visible: b.height > 0 && b.bottom > 0 && b.top < window.innerHeight,
        pos: cs.position, cssTop: cs.top, z: cs.zIndex,
        topbarH: (() => { const t = document.querySelector('.topbar'); return t ? Math.round(t.getBoundingClientRect().height) : null; })(),
      };
    });
    fb.push(Object.assign({ page: p }, has, after));
  }

  /* 4) grp-name 截断：pill 里的组名有没有被 ellipsis 吃掉 */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + '/all-pages.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(160);
  const grp = await page.evaluate(() => {
    const names = [...document.querySelectorAll('.grp-name')];
    const pills = [...document.querySelectorAll('.grp-zh, .pill, .tag')];
    const trunc = names.filter((n) => n.scrollWidth > n.clientWidth + 1);
    return {
      grpNameCount: names.length,
      truncated: trunc.length,
      samples: trunc.slice(0, 6).map((n) => ({ t: (n.textContent || '').trim().slice(0, 30), sw: n.scrollWidth, cw: n.clientWidth })),
      all: names.slice(0, 32).map((n) => ({ t: (n.textContent || '').trim().slice(0, 24), sw: n.scrollWidth, cw: n.clientWidth, ok: n.scrollWidth <= n.clientWidth + 1 })),
      pillCount: pills.length,
      flexOfName: names.length ? getComputedStyle(names[0]).flex : null,
      minWOfName: names.length ? getComputedStyle(names[0]).minWidth : null,
    };
  });

  out.c5 = { h5, broke320, filterBar: fb, grp };
  console.log('C5-1 h5: ' + JSON.stringify(h5));
  console.log('C5-2 320px 表格词中断:');
  for (const r of broke320) console.log('   ' + r.page.padEnd(40) + 'tables=' + r.tables + ' cells=' + r.cells + ' broken=' + r.broken + (r.samples.length ? '  e.g. ' + JSON.stringify(r.samples[0]) : ''));
  console.log('C5-3 filter-bar sticky:');
  for (const r of fb) console.log('   ' + r.page.padEnd(40) + JSON.stringify(r));
  console.log('C5-4 grp-name: count=' + grp.grpNameCount + ' truncated=' + grp.truncated + ' flex=' + grp.flexOfName + ' minW=' + grp.minWOfName + ' pills=' + grp.pillCount);
  if (grp.samples.length) console.log('   samples=' + JSON.stringify(grp.samples));
  await ctx.close();
}

(async () => {
  if (!EXE) throw new Error('no chrome executable found (set CHROME_PATH)');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), chrome: EXE };
  try {
    if (want('shots')) await doShots(browser, out);
    if (want('cls')) await doCls(browser, out);
    if (want('c5')) await doC5(browser, out);
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(TMP, 'fa2-extra.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(TMP, 'fa2-extra.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
