'use strict';
/**
 * b1a-stretch.js — P0-4「拉伸链接」三方案对照实测（决定"该不该保留"的证据）
 *
 *  A  现状：.src-link::after{inset:0} + .src-sum/.src-rel{pointer-events:none}
 *  B  整行包 <a>（把 <li> 内容全塞进链接）
 *  C  保留 ::after 整行拉伸，但把摘要/路径改回 pointer-events:auto + user-select:text
 *     （空白区仍可点，文字区可选中/可右键"复制"）
 *
 * 对每个方案测：摘要正上方 elementFromPoint / 双击选词 / 右键菜单 target / 整行点击命中率。
 * href 都是同页锚点，不会导航，无需拦截点击。
 *
 * 证据只写系统临时目录。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(os.tmpdir(), 'dsh-b1a');
fs.mkdirSync(TMP, { recursive: true });
const OUT = path.join(TMP, 'stretch.json');

function chromePath() {
  const cands = [];
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH);
  if (process.env.LOCALAPPDATA) {
    cands.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'));
    cands.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'));
  }
  if (process.env.PROGRAMFILES) cands.push(path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  throw new Error('no chrome: ' + cands.join(' | '));
}

const HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
body{font:16px/1.7 system-ui,"Microsoft YaHei";margin:24px;max-width:1000px}
h3{font-size:15px;margin:26px 0 8px;color:#333}
ul{list-style:none;padding:0;margin:0}
.row{display:flex;gap:8px;align-items:baseline;padding:6px 8px;position:relative;border:1px solid #ddd;margin:0 0 10px;border-radius:8px}
.lbl{font-weight:600;color:#1d4ed8}
.sum{flex:1 1 320px;color:#5c6470;font-size:.8rem}
.rel{font-family:ui-monospace,Consolas,monospace;font-size:.7rem;color:#5c6470;opacity:.75}

/* ---- A：现状（伪元素拉伸 + 文本 pointer-events:none） ---- */
.A .lbl::after{content:"";position:absolute;inset:0;border-radius:8px}
.A .sum,.A .rel{position:relative;pointer-events:none}

/* ---- B：整行包 <a> ---- */
a.rowlink{display:flex;gap:8px;align-items:baseline;padding:6px 8px;border:1px solid #ddd;margin:0 0 10px;border-radius:8px;text-decoration:none;color:inherit}

/* ---- C：保留 ::after，但文字区恢复可命中/可选中 ---- */
.C .lbl::after{content:"";position:absolute;inset:0;border-radius:8px}
.C .sum,.C .rel{position:relative;pointer-events:auto;user-select:text}
.C .lbl{position:relative;z-index:1}
</style></head><body>

<h3>A　现状：::after 拉伸 + 摘要/路径 pointer-events:none</h3>
<ul class="A"><li class="row"><a class="lbl" href="#a">Getting started</a><span class="sum">从下载 Paper 到首次启动服务端的完整流程，含 Java 版本要求</span><span class="rel">getting-started/index</span></li></ul>

<h3>B　整行包 &lt;a&gt;</h3>
<a class="rowlink" href="#b"><span class="lbl">Getting started</span><span class="sum">从下载 Paper 到首次启动服务端的完整流程，含 Java 版本要求</span><span class="rel">getting-started/index</span></a>

<h3>C　保留 ::after，文字区 pointer-events:auto</h3>
<ul class="C"><li class="row"><a class="lbl" href="#c">Getting started</a><span class="sum">从下载 Paper 到首次启动服务端的完整流程，含 Java 版本要求</span><span class="rel">getting-started/index</span></li></ul>

</body></html>`;

(async () => {
  const file = path.join(TMP, 'stretch-abc.html');
  fs.writeFileSync(file, HTML, 'utf8');
  const exe = chromePath();
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForTimeout(250);

  const result = {};

  const cases = [
    { key: 'A', label: 'A ::after + pointer-events:none（现状）', sumSel: '.A .sum', rowSel: '.A .row' },
    { key: 'B', label: 'B 整行 <a>', sumSel: 'a.rowlink .sum', rowSel: 'a.rowlink' },
    { key: 'C', label: 'C ::after + 文字 pointer-events:auto', sumSel: '.C .sum', rowSel: '.C .row' },
  ];

  for (const c of cases) {
    const geo = await page.evaluate((sel) => {
      const s = document.querySelector(sel);
      if (!s) return null;
      const r = s.getBoundingClientRect();
      const x = Math.round(r.left + 24), y = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      return {
        rect: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) },
        probe: { x, y },
        hit: hit ? hit.tagName + (hit.className ? '.' + String(hit.className).slice(0, 20) : '') : null,
        hitIsLink: !!(hit && hit.closest && hit.closest('a')),
        userSelect: getComputedStyle(s).userSelect,
        pointerEvents: getComputedStyle(s).pointerEvents,
      };
    }, c.sumSel);
    if (!geo) { result[c.key] = { label: c.label, missing: true }; continue; }

    // 双击摘要正上方一个词 → 看是否产生选区
    await page.mouse.click(geo.probe.x, geo.probe.y, { clickCount: 2 });
    await page.waitForTimeout(180);
    const dbl = await page.evaluate(() => {
      const s = window.getSelection();
      const node = s && s.anchorNode;
      const el = node ? (node.nodeType === 3 ? node.parentElement : node) : null;
      return {
        selectedText: String(s || '').slice(0, 40),
        hasSelection: !!(s && s.rangeCount > 0 && String(s).length > 0),
        selectionIn: el ? el.tagName + (el.className ? '.' + String(el.className).slice(0, 20) : '') : null,
      };
    });

    // 右键摘要 → contextmenu 的 target 是文本还是链接
    const ctx = await page.evaluate((sel) => {
      const s = document.querySelector(sel);
      const r = s.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + 24, r.top + r.height / 2) || s;
      let cap = null;
      const h = (e) => {
        e.preventDefault();
        const el = e.target;
        cap = {
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 20),
          isLink: !!(el.closest && el.closest('a')),
          // 右键菜单会给出"复制"还是"在新标签页打开链接"
          menuKind: (el.closest && el.closest('a')) ? 'link-menu' : 'text-menu',
        };
      };
      document.addEventListener('contextmenu', h, true);
      t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      document.removeEventListener('contextmenu', h, true);
      return cap;
    }, c.sumSel);

    // 整行点击命中率（沿行扫描，看多少点会命中链接）
    const coverage = await page.evaluate((rowSel) => {
      const row = document.querySelector(rowSel);
      if (!row) return null;
      const r = row.getBoundingClientRect();
      let hit = 0, total = 0;
      for (let x = r.left + 6; x < r.right - 6; x += 30) {
        for (let y = r.top + 4; y < r.bottom - 4; y += 8) {
          total++;
          const el = document.elementFromPoint(x, y);
          if (el && el.closest && el.closest('a')) hit++;
        }
      }
      return { pct: Number((hit / total * 100).toFixed(1)), samples: total };
    }, c.rowSel);

    // 空白区（行右端）点击是否仍能进链接
    const emptyZone = await page.evaluate((rowSel) => {
      const row = document.querySelector(rowSel);
      const r = row.getBoundingClientRect();
      // 找行内最右侧一段没有文字的 x
      for (let x = r.right - 10; x > r.left + 10; x -= 6) {
        const el = document.elementFromPoint(x, r.top + r.height / 2);
        if (el && el.closest && el.closest('a')) {
          return { x: Math.round(x), hit: el.tagName, linkable: true };
        }
      }
      return { linkable: false };
    }, c.rowSel);

    result[c.key] = { label: c.label, geo, doubleClick: dbl, contextMenu: ctx, rowCoverage: coverage, rightEdge: emptyZone };
    // 清掉选区，避免污染下一轮
    await page.evaluate(() => window.getSelection().removeAllRanges());
  }

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ file, result }, null, 2) + '\n', 'utf8');
  for (const k of ['A', 'B', 'C']) {
    const r = result[k];
    if (!r || r.missing) { console.log(k + ': missing'); continue; }
    console.log('\n===== ' + r.label + ' =====');
    console.log(' 摘要区命中: ' + r.geo.hit + '  isLink=' + r.geo.hitIsLink + '  pointer-events=' + r.geo.pointerEvents + '  user-select=' + r.geo.userSelect);
    console.log(' 双击选词: ' + JSON.stringify(r.doubleClick));
    console.log(' 右键菜单: ' + JSON.stringify(r.contextMenu));
    console.log(' 整行命中率: ' + JSON.stringify(r.rowCoverage));
    console.log(' 行右端空白仍可点: ' + JSON.stringify(r.rightEdge));
  }
  console.log('\nartifact: ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
