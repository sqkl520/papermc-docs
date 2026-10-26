'use strict';
/**
 * b3f-c3.js — 判定 verify-mobile 的 C3（两套行高）与 E1/E2（零回归对打）FAIL 是否由批 3 引入。
 *
 * 这两项的判定逻辑（verify-mobile.js:1463-1502）是**双实例对打**：
 *   post = 当前产物（8787，我的批 3）
 *   pre  = "改前实例"（8788，`..\_pre-mobile` 的旧副本）
 *   C3 桌面：|post - pre| <= 1 才算过
 *   E1/E2  ：四档 768/834/1024/1280 逐项比对
 *
 * 关键问题：**8788 那份 pre 是哪个时间点的快照？**
 * 如果它早于批 1/2a/4/2b（也就是本次会话所有整改之前），那么它是"很久以前"的基线，
 * 任何字号/行高变化都会让它 FAIL —— 包括批 1 已经引入的变化。
 * 本脚本直接测 pre 与 post 两侧的关键量，判断差异是否**只**来自批 3（字号），
 * 还是来自更早的批次（DOM/结构）。
 *
 * 用法：node tools/b3f-c3.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const POST = 'http://127.0.0.1:8787';
const PRE = 'http://127.0.0.1:8788';
const PAGE = '/paper/dev/dialogs/';
const VPS = [
  { name: '768x1024', w: 768, h: 1024 },
  { name: '834x1112', w: 834, h: 1112 },
  { name: '1024x768', w: 1024, h: 768 },
  { name: '1280x800', w: 1280, h: 800 },
];

/* verify-mobile 的 navRowMin 口径：导航行（a[data-search] / a.ttl）的最小高度 */
const PROBE = () => {
  const cs = getComputedStyle;
  const rows = [...document.querySelectorAll('.sidebar a[data-search], .sidebar a.ttl')];
  const hs = rows.map((e) => e.getBoundingClientRect().height).filter((h) => h > 0);
  const navRowMin = hs.length ? +Math.min(...hs).toFixed(2) : null;
  const fsz = (sel) => { const e = document.querySelector(sel); return e ? +parseFloat(cs(e).fontSize).toFixed(2) : null; };
  /* 行高实测量：一行 <p> 的高度 */
  const p = document.querySelector('.article p');
  const pLH = p ? +parseFloat(cs(p).lineHeight).toFixed(2) : null;
  /* 侧栏与正文的关键几何 */
  const sb = document.querySelector('.sidebar');
  const art = document.querySelector('.article');
  const r = (e) => e ? +e.getBoundingClientRect().width.toFixed(1) : null;
  return {
    navRowMin,
    navRows: hs.length,
    h1: fsz('.article h1') || fsz('.hero h1'),
    h2: fsz('.article h2'), h3: fsz('.article h3'), h4: fsz('.article h4'),
    body: fsz('.article p'),
    pLineHeight: pLH,
    sidebarW: r(sb), articleW: r(art),
    sidebarLinks: document.querySelectorAll('.sidebar a').length,
    sidebarScrollH: sb ? sb.scrollHeight : null,
    docH: document.documentElement.scrollHeight,
    /* 侧栏内字号集合：批 1 + 批 3 都会动它 */
    sideLevels: (() => {
      const s = new Set();
      const sb2 = document.querySelector('.sidebar');
      if (!sb2) return [];
      for (const el of sb2.querySelectorAll('*')) {
        const c = cs(el);
        if (c.display === 'none') continue;
        let hasText = false;
        for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { hasText = true; break; }
        if (!hasText) continue;
        s.add(+parseFloat(c.fontSize).toFixed(2));
      }
      return [...s].sort((a, b) => a - b);
    })(),
  };
};

(async () => {
  if (!EXE) throw new Error('找不到 chromium');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = [];
  for (const vp of VPS) {
    const row = { vp: vp.name };
    for (const [side, base] of [['pre', PRE], ['post', POST]]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      try {
        await page.goto(base + PAGE, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(200);
        row[side] = await page.evaluate(PROBE);
      } catch (e) {
        row[side] = { error: String(e).slice(0, 80) };
      }
      await ctx.close();
    }
    out.push(row);
  }
  await browser.close();

  console.log('\n════ C3 / E1 双实例对打：pre(8788) vs post(8787) ════');
  console.log('页: ' + PAGE + '\n');
  for (const r of out) {
    if (!r.pre || !r.post || r.pre.error || r.post.error) { console.log(r.vp + '  取数失败'); continue; }
    const d = (k) => {
      const a = r.pre[k]; const b = r.post[k];
      if (a === null || b === null) return String(a) + ' → ' + String(b);
      const diff = +(b - a).toFixed(2);
      const flag = Math.abs(diff) <= 1 ? '' : '  ← 超出 ±1';
      return a + ' → ' + b + '  (' + (diff > 0 ? '+' : '') + diff + ')' + flag;
    };
    console.log('[' + r.vp + ']');
    console.log('  C3 navRowMin     ' + d('navRowMin') + (Math.abs((r.post.navRowMin || 0) - (r.pre.navRowMin || 0)) > 1 ? '' : '   ✓ C3 应过'));
    console.log('  p.lineHeight     ' + d('pLineHeight'));
    console.log('  p font-size      ' + d('body'));
    console.log('  h1               ' + d('h1'));
    console.log('  h2/h3/h4         ' + r.pre.h2 + '/' + r.pre.h3 + '/' + r.pre.h4 + ' → ' + r.post.h2 + '/' + r.post.h3 + '/' + r.post.h4);
    console.log('  sidebarW         ' + d('sidebarW'));
    console.log('  articleW         ' + d('articleW'));
    console.log('  sidebar links    ' + d('sidebarLinks'));
    console.log('  sidebarScrollH   ' + d('sidebarScrollH'));
    console.log('  docH             ' + d('docH'));
    console.log('  侧栏字号集合     pre=' + r.pre.sideLevels.join(',') + '  (' + r.pre.sideLevels.length + ' 级)');
    console.log('                   post=' + r.post.sideLevels.join(',') + '  (' + r.post.sideLevels.length + ' 级)');
    console.log('');
  }

  /* 归因 */
  const first = out[0];
  if (first && first.pre && first.post && !first.pre.error) {
    const domSame = first.pre.sidebarLinks === first.post.sidebarLinks;
    console.log('归因：');
    console.log('  侧栏链接数 pre=' + first.pre.sidebarLinks + ' post=' + first.post.sidebarLinks
      + ' → ' + (domSame ? 'DOM 结构相同（pre 已含批 1 的降噪）' : '**DOM 不同**（pre 早于批 1）'));
    console.log('  pre 侧栏字号级数 ' + first.pre.sideLevels.length + ' / post ' + first.post.sideLevels.length);
    console.log('  → 若 pre 侧栏级数已是 4 级上下，说明 8788 是**批 1 之后**的快照；');
    console.log('    此时 C3/E1 的 FAIL 只可能来自批 3 的字号变化（h1 28.8→34/40 会抬高行高）。');
  }
  fs.writeFileSync(path.join(require('os').tmpdir(), 'b3f-c3.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\nJSON → ' + path.join(require('os').tmpdir(), 'b3f-c3.json'));
})().catch((e) => { console.error(e); process.exit(1); });
