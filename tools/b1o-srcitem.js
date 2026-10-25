#!/usr/bin/env node
'use strict';
/**
 * b1o-srcitem.js — 批 1 `[data-overflowing]` / `.src-item` 拉伸链接的**定点复验**。
 *
 * 上一版（b1o-file2.js）在 390 宽下做 elementFromPoint，但首页的 .src-item 全都在首屏
 * 之外（y 超出视口），命中测试必然返回 null —— 这是探针口径问题。这里先把条目
 * scrollIntoView，再点在其 .src-sum 文本上，验证拉伸链接（::after inset:0）真的覆盖整行。
 *
 * 用法：node tools/b1o-srcitem.js [--json=$env:TEMP\b1o\srcitem.json] [--proto=file|http]
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const OUT_JSON = path.resolve(opt('json', path.join(require("os").tmpdir() || '.', 'b1o', 'srcitem.json')));
const PROTO = opt('proto', 'file');

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean);
function browserPath() { for (const c of CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch { /* */ } } return null; }

const REL = 'index.html';

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome found'); process.exit(2); }
  const url = PROTO === 'file' ? pathToFileURL(path.join(REPO, REL)).href : 'http://127.0.0.1:8787/' + REL;
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'] });
  const out = { tool: 'tools/b1o-srcitem.js', generatedAt: new Date().toISOString(), url, proto: PROTO, widths: [] };

  for (const w of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: w <= 820, hasTouch: w <= 820 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(600);

    const rec = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.src-item'));
      const res = { count: items.length, probes: [], stretchFullWidth: 0, stretchPartial: 0, hoverWorks: 0 };
      const seen = new Set();
      for (const it of items) {
        if (seen.size >= 8) break;
        const link = it.querySelector('a.src-link');
        const sum = it.querySelector('.src-sum');
        const rel2 = it.querySelector('.src-rel');
        if (!link) continue;
        // 保证条目在视口中央
        it.scrollIntoView({ block: 'center', behavior: 'instant' });
        const itemR = it.getBoundingClientRect();
        if (itemR.height < 8 || itemR.width < 20) continue;
        if (itemR.top < 0 || itemR.bottom > innerHeight) continue;
        seen.add(it);
        const cs = getComputedStyle(link, '::after');
        const linkR = link.getBoundingClientRect();
        // ::after 的覆盖范围：用 link 的定位上下文推断（inset:0 + 最近定位祖先 = .src-item）
        const itemPos = getComputedStyle(it).position;
        const linkPos = getComputedStyle(link).position;
        const coversItem = cs.top === '0px' && cs.right === '0px' && cs.bottom === '0px' && cs.left === '0px' && itemPos === 'relative' && linkPos === 'static';
        if (coversItem) res.stretchFullWidth++; else res.stretchPartial++;
        const hits = [];
        for (const [name, el] of [['sum', sum], ['rel', rel2]]) {
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) { hits.push({ name, skipped: 'zero-size' }); continue; }
          // 取文本区域内一点（避开行首 4px 边界）
          const x = Math.round(r.left + Math.min(30, Math.max(4, r.width / 2)));
          const y = Math.round(r.top + r.height / 2);
          if (y < 1 || y > innerHeight - 1) { hits.push({ name, skipped: 'out-of-viewport', y }); continue; }
          const hit = document.elementFromPoint(x, y);
          const a = hit && hit.closest ? hit.closest('a') : null;
          hits.push({
            name, x, y,
            hitTag: hit ? hit.tagName : null,
            hitClass: hit ? String(hit.className).slice(0, 32) : null,
            resolvesToLink: !!(a && a === link),
            href: a ? a.getAttribute('href') : null,
          });
        }
        res.probes.push({
          itemW: Math.round(itemR.width), itemH: Math.round(itemR.height),
          itemPos, linkPos,
          afterInset: [cs.top, cs.right, cs.bottom, cs.left].join(' '),
          coversItem,
          sumPE: sum ? getComputedStyle(sum).pointerEvents : null,
          relPE: rel2 ? getComputedStyle(rel2).pointerEvents : null,
          linkW: Math.round(linkR.width),
          hits,
        });
      }
      // 全量统计：多少条目满足「::after inset:0 + item relative + link static」
      let all = 0, full = 0;
      for (const it of items) {
        const l = it.querySelector('a.src-link');
        if (!l) continue;
        all++;
        const c = getComputedStyle(l, '::after');
        if (c.top === '0px' && c.right === '0px' && c.bottom === '0px' && c.left === '0px'
          && getComputedStyle(it).position === 'relative' && getComputedStyle(l).position === 'static') full++;
      }
      res.allItems = all;
      res.allStretchOk = full;
      res.stretchPct = all ? Math.round(full / all * 1000) / 10 : null;
      return res;
    });
    rec.width = w;
    rec.errors = errs.slice(0, 4);
    out.widths.push(rec);
    console.log('\n=== width ' + w + '  items=' + rec.count + '  stretchOk=' + rec.allStretchOk + '/' + rec.allItems + ' (' + rec.stretchPct + '%)');
    for (const p of rec.probes) {
      console.log('   item ' + p.itemW + 'x' + p.itemH + ' itemPos=' + p.itemPos + ' linkPos=' + p.linkPos + ' after=' + p.afterInset +
        ' covers=' + p.coversItem + ' sumPE=' + p.sumPE +
        ' hits=' + JSON.stringify(p.hits.map((h) => h.name + ':' + (h.skipped || (h.resolvesToLink + '/' + h.hitTag + '.' + h.hitClass)))));
    }
    if (errs.length) console.log('   ERRORS ' + JSON.stringify(errs));
    await ctx.close();
  }

  await browser.close();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
  console.log('\nWROTE ' + OUT_JSON);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
