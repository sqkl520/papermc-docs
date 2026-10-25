'use strict';
/**
 * cr-lineadv.js — 精确测量代码块「行推进」（line advance）
 *
 * 背景：.code-pre 内没有逐行 span（hljs 只包 token，换行是文本节点 \n），
 * 所以必须用 Range.getClientRects() 拿到每个行盒的 rect，逐行求 y 差中位数。
 *
 * 同时用「预留滚动条」法测真实横向溢出（--hide-scrollbars 会让 clientWidth 更宽）。
 *
 * 用法：node tools/cr-lineadv.js <baseline|current|both>
 *   baseline = git HEAD 版本的 assets/site.css（C1 落地前）
 *   current  = 工作区 assets/site.css（C1 落地后）
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(require("os").tmpdir() || '.', 'cr');
fs.mkdirSync(OUT, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const BASE = 'http://127.0.0.1:8787';
const HEAD_CSS = execFileSync('git', ['show', 'HEAD:assets/site.css'], { cwd: ROOT, maxBuffer: 1 << 28 }).toString('utf8');
const CUR_CSS = fs.readFileSync(path.join(ROOT, 'assets', 'site.css'), 'utf8');

const PAGES = [
  '/paper/dev/dialogs/', '/paper/dev/particles/', '/paper/reference/world-configuration/',
  '/paper/reference/system-properties/', '/paper/reference/cli-arguments/', '/paper/dev/pdc/',
];

const FN = function () {
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const cs = (e, p) => (e ? getComputedStyle(e).getPropertyValue(p) : null);
  const pre = qa('.code-pre');

  function advance(codeEl) {
    // 行盒 rect：Range 覆盖 code 的全部文本
    const r = document.createRange();
    r.selectNodeContents(codeEl);
    const rects = Array.from(r.getClientRects());
    if (rects.length < 2) return { lines: rects.length, adv: null, advMedian: null };
    const ys = rects.map((x) => +x.y.toFixed(3));
    const uniq = [];
    for (const y of ys) if (!uniq.length || Math.abs(y - uniq[uniq.length - 1]) > 0.5) uniq.push(y);
    const diffs = [];
    for (let i = 1; i < uniq.length; i++) diffs.push(+(uniq[i] - uniq[i - 1]).toFixed(3));
    diffs.sort((a, b) => a - b);
    const med = diffs.length ? diffs[Math.floor(diffs.length / 2)] : null;
    return { lines: uniq.length, adv: diffs.length === 1 ? diffs[0] : null, advMedian: med, advMin: diffs[0], advMax: diffs[diffs.length - 1] };
  }

  // 真实横向溢出：先测正常，再把 width 压到 0 让内容自由伸展（规避 --hide-scrollbars 影响）
  function overflow(el) {
    const normal = { cw: el.clientWidth, sw: el.scrollWidth, over: el.scrollWidth - el.clientWidth };
    const prevW = el.style.width, prevMax = el.style.maxWidth;
    el.style.width = 'auto'; el.style.maxWidth = 'none'; el.style.display = 'inline-block';
    const free = { sw: Math.round(el.scrollWidth) };
    el.style.width = prevW; el.style.maxWidth = prevMax; el.style.display = '';
    return normal;
  }

  const rows = pre.slice(0, 50).map((p) => {
    const code = p.querySelector('code');
    const a = code ? advance(code) : { lines: 0, advMedian: null };
    const o = overflow(p);
    const wrap = p.parentElement;
    return {
      preFont: cs(p, 'font-size'), codeFont: cs(code || p, 'font-size'),
      preLH: cs(p, 'line-height'), codeLH: cs(code || p, 'line-height'),
      lines: a.lines, adv: a.adv, advMedian: a.advMedian, advMin: a.advMin, advMax: a.advMax,
      codeH: code ? +code.getBoundingClientRect().height.toFixed(2) : null,
      preH: +p.getBoundingClientRect().height.toFixed(2),
      cw: o.cw, sw: o.sw, over: o.over, overflowing: o.over > 1,
      wrapOver: wrap ? wrap.scrollWidth - wrap.clientWidth : null,
      pad: cs(p, 'padding'),
    };
  });

  // 行内 code（不该受影响）
  const ic = qa('.article :not(pre) > code').slice(0, 8).map((c) => ({ f: cs(c, 'font-size'), lh: cs(c, 'line-height') }));
  // 打印
  return { rows, inline: ic, pageH: document.documentElement.scrollHeight, vw: innerWidth, cols: cs(document.querySelector('.layout'), 'grid-template-columns') };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const which = process.argv[2] || 'both';
  const browser = await chromium.launch({ executablePath: EXE, args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'] });
  const result = {};

  for (const build of ['baseline', 'current']) {
    if (which !== 'both' && which !== build) continue;
    const css = build === 'baseline' ? HEAD_CSS : CUR_CSS;
    result[build] = [];
    for (const url of PAGES) {
      for (const vw of [1440, 1024, 390]) {
        const ctx = await browser.newContext({ viewport: { width: vw, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true });
        const page = await ctx.newPage();
        await page.route('**/assets/site.css*', (route) => route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css }));
        await page.goto(BASE + url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(200);
        const m = await page.evaluate(FN);
        // 打印媒体
        await page.emulateMedia({ media: 'print' });
        const pr = await page.evaluate(() => {
          const p = document.querySelector('.code-pre'); const c = p && p.querySelector('code');
          return { pre: p ? getComputedStyle(p).fontSize : null, code: c ? getComputedStyle(c).fontSize : null, preLH: p ? getComputedStyle(p).lineHeight : null };
        });
        await page.emulateMedia({ media: 'screen' });
        result[build].push({ url, vw, print: pr, ...m });
        await ctx.close();
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'lineadv-' + which + '.json'), JSON.stringify(result, null, 2), 'utf8');

  // 精简对账
  const sum = [];
  if (result.baseline && result.current) {
    for (let i = 0; i < result.baseline.length; i++) {
      const b = result.baseline[i], c = result.current[i];
      const advB = b.rows.map((r) => r.advMedian).filter((x) => x != null);
      const advC = c.rows.map((r) => r.advMedian).filter((x) => x != null);
      const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
      sum.push({
        url: b.url, vw: b.vw,
        preFont: [b.rows[0] && b.rows[0].preFont, c.rows[0] && c.rows[0].preFont],
        codeFont: [b.rows[0] && b.rows[0].codeFont, c.rows[0] && c.rows[0].codeFont],
        advMedian: [med(advB), med(advC)],
        advAll: [advB.slice(0, 4), advC.slice(0, 4)],
        linesTotal: [b.rows.reduce((s, r) => s + r.lines, 0), c.rows.reduce((s, r) => s + r.lines, 0)],
        overflowing: [b.rows.filter((r) => r.overflowing).length, c.rows.filter((r) => r.overflowing).length],
        overMax: [Math.max(...b.rows.map((r) => r.over), 0), Math.max(...c.rows.map((r) => r.over), 0)],
        overSamples: [b.rows.map((r) => r.over), c.rows.map((r) => r.over)],
        pageH: [b.pageH, c.pageH],
        inline: [b.inline[0], c.inline[0]],
        print: [b.print, c.print],
      });
    }
  }
  fs.writeFileSync(path.join(OUT, 'lineadv-sum.json'), JSON.stringify(sum, null, 2), 'utf8');
  process.stdout.write(JSON.stringify(sum, null, 2));
})();
