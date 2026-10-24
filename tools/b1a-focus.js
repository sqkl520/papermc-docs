'use strict';
/**
 * b1a-focus.js — 阶段 D：焦点可见性（2.4.7 / 2.4.11）/ UI 组件边框对比度（1.4.11）/ 焦点环被 sticky 遮挡
 *
 * 证据只写系统临时目录。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(os.tmpdir(), 'dsh-b1a');
fs.mkdirSync(TMP, { recursive: true });
const OUT = path.join(TMP, 'focus.json');

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
function parseColor(s) {
  s = String(s || '').trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }; }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const p = m[1].split(/[,\/\s]+/).filter(Boolean).map(Number); if (p.length >= 3) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  return null;
}
function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
function ratio(fg, bg) {
  const f = parseColor(fg), b = parseColor(bg);
  if (!f || !b) return null;
  const L1 = lum(f), L2 = lum(b);
  return Number(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2));
}

// ---------- 1) 390 下：Tab 到 TOC 内第一个链接，焦点环是否被 sticky TOC 自己遮住 ----------
async function tocFocus390(browser, port) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(350);
  // 展开 TOC（键盘用户第一步就是 Enter）
  await page.evaluate(() => {
    const d = document.querySelector('.toc-side details.toc-fold');
    if (d) d.open = true;
  });
  await page.waitForTimeout(250);
  const out = { port };
  out.beforeTab = await page.evaluate(() => {
    const toc = document.querySelector('.toc-side');
    const tr = toc.getBoundingClientRect();
    return {
      toc: { top: Math.round(tr.top), bottom: Math.round(tr.bottom), h: Math.round(tr.height) },
      overflowY: getComputedStyle(toc).overflowY,
      maxH: getComputedStyle(toc).maxHeight,
      // 展开后 24 项目录高度 vs 视口
      olHeight: (function () { const ol = toc.querySelector('ol'); return ol ? Math.round(ol.getBoundingClientRect().height) : null; })(),
      viewportH: innerHeight,
      listCoversPct: (function () { const ol = toc.querySelector('ol'); return ol ? Math.round(ol.getBoundingClientRect().height / innerHeight * 100) : null; })(),
    };
  });
  // 真实 Tab：从 summary 开始逐步 Tab，抓每个 TOC 链接的焦点环与其相对 sticky 盒的位置
  await page.evaluate(() => document.querySelector('.toc-side .toc-title').focus());
  const steps = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(120);
    const s = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const toc = document.querySelector('.toc-side');
      const tr = toc.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // 焦点环矩形（外扩 2px offset + 2px width = 4px）
      const ring = { top: r.top - 4, bottom: r.bottom + 4, left: r.left - 4, right: r.right + 4 };
      const inToc = !!(el.closest && el.closest('.toc-side'));
      // 环的上/下边是否落在 sticky TOC 的裁切框之外（overflow:auto 会裁掉）
      const clippedTop = inToc && ring.top < tr.top;
      const clippedBottom = inToc && ring.bottom > tr.bottom;
      // 环顶部那一点，实际命中谁
      const hitTop = document.elementFromPoint(Math.min(Math.max(ring.left + 8, 0), innerWidth - 1), Math.max(ring.top + 2, 0));
      return {
        tag: el.tagName, text: (el.textContent || '').trim().slice(0, 26),
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
        tocBox: { top: Math.round(tr.top), bottom: Math.round(tr.bottom) },
        ringVisibleTop: Math.round(ring.top), ringVisibleBottom: Math.round(ring.bottom),
        inToc, clippedTop, clippedBottom,
        hitAtRingTop: hitTop ? hitTop.tagName + '.' + String(hitTop.className || '').slice(0, 30) : null,
        outline: cs.outlineStyle + ' ' + cs.outlineWidth,
      };
    });
    if (s) steps.push(s);
    if (s && s.inToc && s.tag === 'A' && steps.filter((x) => x.inToc && x.tag === 'A').length >= 3) break;
  }
  out.tabSteps = steps;
  await page.close();
  return out;
}

// ---------- 2) 焦点落到被 sticky TOC 覆盖的正文链接：2.4.11 遮挡 ----------
async function focusObscured(browser, port) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(350);
  const out = await page.evaluate(async () => {
    const toc = document.querySelector('.toc-side');
    const det = toc ? toc.querySelector('details.toc-fold') : null;
    if (det) det.open = true;
    await new Promise((r) => setTimeout(r, 250));
    const out = {};
    // 把页面滚到某条正文链接正好落在 sticky TOC 带内
    const links = Array.from(document.querySelectorAll('.article a[href], .content a[href]'));
    const target = links.find((a) => a.getBoundingClientRect().height > 0);
    if (!target) return { missing: true };
    target.focus(); // 浏览器会把它滚进视野
    await new Promise((r) => setTimeout(r, 400));
    const r = target.getBoundingClientRect();
    const tr = toc.getBoundingClientRect();
    const ring = { top: r.top - 4, bottom: r.bottom + 4 };
    const hit = document.elementFromPoint(Math.min(r.left + 6, innerWidth - 1), Math.max(r.top + 4, 0));
    out.target = { text: target.textContent.trim().slice(0, 30), rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } };
    out.toc = { top: Math.round(tr.top), bottom: Math.round(tr.bottom), h: Math.round(tr.height) };
    out.ring = { top: Math.round(ring.top), bottom: Math.round(ring.bottom) };
    out.focusVisible = getComputedStyle(target).outlineStyle + ' ' + getComputedStyle(target).outlineWidth;
    out.coveredTopPx = Math.max(0, Math.round(tr.bottom - ring.top));
    out.fullyObscured = ring.top >= tr.top && ring.top < tr.bottom;
    out.hitAtFocus = hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 34) : null;
    out.obscuredByStickyToc = !!(hit && hit.closest && hit.closest('.toc-side'));
    out.scrollY = Math.round(scrollY);
    out.scrollPaddingTop = getComputedStyle(document.documentElement).scrollPaddingTop;
    return out;
  });
  await page.close();
  return { port, ...out };
}

// ---------- 3) UI 组件边框对比度（1.4.11）：输入框 / 按钮 / 复选框 ----------
async function uiBorders(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(350);
  const d = await page.evaluate(() => {
    const effBg = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = getComputedStyle(n).backgroundColor;
        const m = c.match(/^rgba?\(([^)]+)\)$/);
        if (m) { const p = m[1].split(/[,\/\s]+/).filter(Boolean).map(Number); if (p.length < 4 || p[3] > 0.5) return c; }
        n = n.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const pick = (label, sel) => {
      const el = document.querySelector(sel);
      if (!el) return { label, missing: true };
      const cs = getComputedStyle(el);
      return {
        label,
        borderColor: cs.borderTopColor,
        borderWidth: cs.borderTopWidth,
        bg: effBg(el),
        innerBg: cs.backgroundColor,
        color: cs.color,
        focusOutline: cs.outlineColor,
      };
    };
    return {
      items: [
        pick('搜索框（顶栏）', '.topbar .tbtn[data-search-open], .topbar button'),
        pick('侧栏过滤输入框', '.side-filter'),
        pick('复制按钮', '.code-copy'),
        pick('代码块外框', '.code-block'),
        pick('页内 code', '.article code'),
        pick('chip 胶囊', 'a.chip'),
        pick('组首页 pill', '.side-home'),
        pick('分页链接', '.pager a'),
        pick('TOC 容器', '.toc-side'),
        pick('页脚', '.page-footer'),
        pick('面包屑链接', '.crumbs a'),
      ].filter((x) => !x.missing),
      tokens: {
        border: (function () { const el = document.createElement('div'); el.style.color = 'var(--border)'; document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c; })(),
        borderStrong: (function () { const el = document.createElement('div'); el.style.color = 'var(--border-strong)'; document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c; })(),
        accent: (function () { const el = document.createElement('div'); el.style.color = 'var(--accent)'; document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c; })(),
        bg: getComputedStyle(document.body).backgroundColor,
        bgSoft: (function () { const el = document.createElement('div'); el.style.background = 'var(--bg-soft)'; document.body.appendChild(el); const c = getComputedStyle(el).backgroundColor; el.remove(); return c; })(),
      },
    };
  });
  await page.close();
  const items = d.items.map((it) => ({
    ...it,
    borderRatio: it.borderWidth === '0px' ? null : ratio(it.borderColor, it.bg),
    focusRatio: ratio(it.focusOutline, it.bg),
  }));
  return { port, tokens: d.tokens, items };
}

// ---------- 4) 390 展开 TOC 后 H1 位置（P0-1 目标是否达成）+ 目录可发现性 ----------
async function mobileFold(browser, port) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(400);
  const d = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const toc = document.querySelector('.toc-side');
    const sum = document.querySelector('.toc-side .toc-title');
    return {
      h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
      h1Screens: h1 ? Number((h1.getBoundingClientRect().top / innerHeight).toFixed(2)) : null,
      tocH: toc ? Math.round(toc.getBoundingClientRect().height) : null,
      summaryH: sum ? Math.round(sum.getBoundingClientRect().height) : null,
      summaryHitTarget: sum ? (function () { const r = sum.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
      tocLinks: toc ? toc.querySelectorAll('a').length : 0,
      open: (function () { const dd = toc ? toc.querySelector('details') : null; return dd ? dd.open : null; })(),
    };
  });
  await page.close();
  return { port, ...d };
}

(async () => {
  const exe = chromePath();
  const browser = await chromium.launch({ executablePath: exe });
  const out = { tocFocus: [], obscured: [], borders: [], mobileFold: [] };
  for (const port of [8787, 8788]) out.tocFocus.push(await tocFocus390(browser, port));
  for (const port of [8787, 8788]) out.obscured.push(await focusObscured(browser, port));
  for (const port of [8787, 8788]) out.borders.push(await uiBorders(browser, port));
  for (const port of [8787, 8788]) out.mobileFold.push(await mobileFold(browser, port));
  await browser.close();

  console.log('===== 390 Tab 到 TOC 链接：焦点环是否被 sticky TOC 裁切 =====');
  for (const t of out.tocFocus) {
    console.log(` [${t.port}] beforeTab=${JSON.stringify(t.beforeTab)}`);
    t.tabSteps.forEach((s, i) => console.log('   ' + i + ': ' + JSON.stringify(s)));
  }
  console.log('\n===== 焦点落到 sticky TOC 覆盖区（2.4.11） =====');
  for (const o of out.obscured) console.log(' [' + o.port + '] ' + JSON.stringify(o));
  console.log('\n===== UI 组件边框对比度（1.4.11） =====');
  for (const b of out.borders) {
    console.log(` [${b.port}] tokens=${JSON.stringify(b.tokens)}`);
    for (const it of b.items) {
      console.log(`   ${it.borderRatio === null ? '  n/a' : (it.borderRatio >= 3 ? ' PASS' : ' FAIL')} ${String(it.borderRatio).padStart(5)} border=${it.borderColor} on ${it.bg} w=${it.borderWidth} :: ${it.label}`);
    }
  }
  console.log('\n===== 390 默认折叠后的 H1 位置 =====');
  for (const m of out.mobileFold) console.log(' [' + m.port + '] ' + JSON.stringify(m));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('\nartifact: ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
