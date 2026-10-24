'use strict';
/**
 * b1a-final.js — 阶段 E：四个决定性实验
 *  E1 移动端任何 resize 是否把用户展开的 TOC 打回折叠（用户控制）
 *  E2 sticky TOC 到底遮住锚点目标多少像素（2.4.11 / 2.4.7）
 *  E3 scroll-padding-top 是否覆盖 sticky TOC —— 键盘滚入视野时焦点是否被盖
 *  E4 对照实验：伪元素拉伸层 vs 整行包 <a>，谁能保住「双击选词 / 右键文本菜单」
 *  E5 P0-2 抽屉关闭后焦点归位 + 不滚动
 *
 * 证据只写系统临时目录。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(os.tmpdir(), 'dsh-b1a');
fs.mkdirSync(TMP, { recursive: true });
const OUT = path.join(TMP, 'final.json');

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

// ---------- E1：移动端 resize 打回折叠 ----------
async function e1(browser, port) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(400);
  const hasDetails = await page.evaluate(() => !!document.querySelector('.toc-side details.toc-fold'));
  if (!hasDetails) { await page.close(); return { port, skipped: 'no details (baseline)' }; }
  const st = () => page.evaluate(() => {
    const d = document.querySelector('.toc-side details.toc-fold');
    return d ? { open: d.open, hasOpen: d.hasAttribute('open') } : null;
  });
  const out = { port, initial: await st() };
  // 用户键盘展开
  await page.evaluate(() => document.querySelector('.toc-side .toc-title').focus());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  out.afterUserEnter = await st();
  // 模拟移动端地址栏收起：视口高度变化（真实移动浏览器会发 resize）
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(300);
  out.afterHeightResize = await st();
  // 再试宽度微变（旋转 / 软键盘）
  await page.setViewportSize({ width: 391, height: 780 });
  await page.waitForTimeout(300);
  out.afterWidthResize = await st();
  await page.close();
  return out;
}

// ---------- E2/E3：sticky TOC 遮挡 ----------
async function e2(browser, port) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(400);
  const hasToc = await page.evaluate(() => {
    const t = document.querySelector('.toc-side');
    return t ? getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().height > 0 : false;
  });
  const out = { port, hasTocAt390: hasToc };
  if (!hasToc) {
    // baseline：没有 sticky 目录，仍测一种「顶栏 + scroll-padding」的基准
    out.baseline = await page.evaluate(async () => {
      const links = Array.from(document.querySelectorAll('.toc-side a[href^="#"]'));
      if (!links.length) return null;
      const id = links[1].getAttribute('href').slice(1);
      location.hash = '#' + id;
      await new Promise((r) => setTimeout(r, 800));
      const t = document.getElementById(id);
      const tr = t.getBoundingClientRect();
      const tb = document.querySelector('.topbar').getBoundingClientRect();
      return { id, headingTop: Math.round(tr.top), headingH: Math.round(tr.height), topbarBottom: Math.round(tb.bottom) };
    });
    await page.close();
    return out;
  }

  // 折叠态（键盘用户不展开也能点）
  out.collapsed = await page.evaluate(async () => {
    const det = document.querySelector('.toc-side details.toc-fold');
    if (det) det.open = false;
    await new Promise((r) => setTimeout(r, 150));
    const links = Array.from(document.querySelectorAll('.toc-side .toc-fold a[href^="#"]'));
    const id = links[1].getAttribute('href').slice(1);
    location.hash = '#' + id;
    await new Promise((r) => setTimeout(r, 900));
    const t = document.getElementById(id);
    const tr = t.getBoundingClientRect();
    const toc = document.querySelector('.toc-side').getBoundingClientRect();
    const tb = document.querySelector('.topbar').getBoundingClientRect();
    const hit = document.elementFromPoint(tr.left + 40, Math.max(tr.top + 6, 0));
    const coveredPx = Math.max(0, Math.min(tr.bottom, toc.bottom) - Math.max(tr.top, toc.top));
    return {
      id,
      headingTop: Math.round(tr.top), headingH: Math.round(tr.height),
      tocTop: Math.round(toc.top), tocBottom: Math.round(toc.bottom), tocH: Math.round(toc.height),
      topbarBottom: Math.round(tb.bottom),
      coveredPx, coveredPct: Number((coveredPx / tr.height * 100).toFixed(0)),
      hitAtHeading: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 30) : null,
      occluded: !!(hit && hit.closest && hit.closest('.toc-side')),
      scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
    };
  });

  // 展开态（键盘用户按 Enter 展开后点链接）
  out.expanded = await page.evaluate(async () => {
    const det = document.querySelector('.toc-side details.toc-fold');
    if (det) det.open = true;
    await new Promise((r) => setTimeout(r, 200));
    location.hash = '';
    await new Promise((r) => setTimeout(r, 100));
    const links = Array.from(document.querySelectorAll('.toc-side .toc-fold a[href^="#"]'));
    const id = links[2].getAttribute('href').slice(1);
    location.hash = '#' + id;
    await new Promise((r) => setTimeout(r, 900));
    const t = document.getElementById(id);
    const tr = t.getBoundingClientRect();
    const toc = document.querySelector('.toc-side').getBoundingClientRect();
    const hit = document.elementFromPoint(tr.left + 40, Math.max(tr.top + 6, 0));
    const coveredPx = Math.max(0, Math.min(tr.bottom, toc.bottom) - Math.max(tr.top, toc.top));
    return {
      id, headingTop: Math.round(tr.top), headingH: Math.round(tr.height),
      tocTop: Math.round(toc.top), tocBottom: Math.round(toc.bottom), tocH: Math.round(toc.height),
      coveredPx, coveredPct: Number((coveredPx / tr.height * 100).toFixed(0)),
      hitAtHeading: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 30) : null,
      occluded: !!(hit && hit.closest && hit.closest('.toc-side')),
      // 内容还剩多少可视
      viewportUsableTop: Math.round(toc.bottom),
      usableViewportPct: Number(((innerHeight - toc.bottom) / innerHeight * 100).toFixed(0)),
    };
  });

  // E3：键盘 Tab 反向（Shift+Tab 从正文回到上方）时，焦点是否被 sticky 目录盖住
  out.keyboardScrollIntoView = await page.evaluate(async () => {
    const det = document.querySelector('.toc-side details.toc-fold');
    if (det) det.open = false;
    await new Promise((r) => setTimeout(r, 150));
    // 滚到很深的位置，让正文链接位于视口下半部
    window.scrollTo(0, 2000);
    await new Promise((r) => setTimeout(r, 250));
    const links = Array.from(document.querySelectorAll('.article a[href], .content a[href]'))
      .filter((a) => a.getBoundingClientRect().height > 0);
    // 选一个当前在视口下方的链接，focus 会触发滚动
    const target = links.find((a) => a.getBoundingClientRect().top > innerHeight) || links[links.length - 1];
    if (!target) return null;
    const beforeY = Math.round(scrollY);
    target.focus();
    await new Promise((r) => setTimeout(r, 350));
    const r = target.getBoundingClientRect();
    const toc = document.querySelector('.toc-side').getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 6, Math.max(r.top + 3, 0));
    return {
      text: target.textContent.trim().slice(0, 24),
      beforeY, afterY: Math.round(scrollY),
      focusTop: Math.round(r.top), focusH: Math.round(r.height),
      tocBottom: Math.round(toc.bottom),
      insideStickyBand: r.top < toc.bottom,
      hitAtFocus: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 30) : null,
      obscured: !!(hit && hit.closest && hit.closest('.toc-side')),
      scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
    };
  });
  await page.close();
  return out;
}

// ---------- E4：对照实验（伪元素拉伸 vs 整行 <a>） ----------
async function e4(browser) {
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
  body{font:16px/1.7 system-ui;margin:20px}
  ul{list-style:none;padding:0;margin:0}
  .row{display:flex;gap:8px;align-items:baseline;padding:6px 8px;position:relative;border:1px solid #ddd;margin:0 0 10px}
  .lbl{font-weight:600;color:#1d4ed8}
  .sum{flex:1;color:#5c6470}
  .rel{font-family:monospace;font-size:12px;color:#5c6470}
  /* 方案 A：伪元素拉伸层（现状） */
  .A .lbl::after{content:"";position:absolute;inset:0}
  .A .sum,.A .rel{position:relative;pointer-events:none}
  /* 方案 B：整行包 <a> */
  .B a.rowlink{display:flex;gap:8px;align-items:baseline;padding:6px 8px;border:1px solid #ddd;margin:0 0 10px;text-decoration:none;color:inherit}
  </style></head><body>
  <h3>方案 A：::after 拉伸（现行）</h3>
  <ul class="A"><li class="row"><a class="lbl" href="#a">Getting started</a><span class="sum">从下载 Paper 到首次启动服务端的完整流程</span><span class="rel">getting-started/index</span></li></ul>
  <h3>方案 B：整行包 &lt;a&gt;</h3>
  <a class="rowlink" href="#b"><span class="lbl">Getting started</span><span class="sum">从下载 Paper 到首次启动服务端的完整流程</span><span class="rel">getting-started/index</span></a>
  </body></html>`;
  const file = path.join(TMP, 'stretch-compare.html');
  fs.writeFileSync(file, html, 'utf8');
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForTimeout(200);
  // 拦掉导航，否则双击链接会跳走、丢失测量上下文。注意：只拦 click 的默认行为，
  // 不拦 mousedown/dblclick —— 文本选中行为不受影响，这才是本实验要测的。
  await page.evaluate(() => {
    document.addEventListener('click', (e) => e.preventDefault(), false);
  });

  const probe = async (sumSel, label) => {
    const pt = await page.evaluate((sel) => {
      const s = document.querySelector(sel);
      if (!s) return null;
      const r = s.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 20, r.top + r.height / 2);
      return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2), hit: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 22) : null };
    }, sumSel);
    if (!pt) return { label, missing: true };
    await page.mouse.click(pt.x, pt.y, { clickCount: 2 });
    await page.waitForTimeout(150);
    const sel = await page.evaluate(() => String(window.getSelection() || '').slice(0, 40));
    // 右键菜单 target
    const ctx = await page.evaluate((sel2) => {
      const s = document.querySelector(sel2);
      const r = s.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + 20, r.top + r.height / 2) || s;
      let cap = null;
      const h = (e) => { e.preventDefault(); const el = e.target; cap = { tag: el.tagName, isLink: !!(el.closest && el.closest('a')), linkText: el.closest && el.closest('a') ? el.closest('a').textContent.trim().slice(0, 24) : null }; };
      document.addEventListener('contextmenu', h, true);
      t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      document.removeEventListener('contextmenu', h, true);
      return cap;
    }, sumSel);
    return { label, hitAtSummary: pt.hit, selectedText: sel, doubleClickSelectsSummary: sel.length > 0, contextMenu: ctx };
  };

  const A = await probe('.A .sum', 'A ::after 拉伸');
  const B = await probe('a.rowlink .sum', 'B 整行 <a>');

  // 整行命中率（两种方案都应整行可点）
  const coverage = await page.evaluate(() => {
    function cov(rowSel) {
      const row = document.querySelector(rowSel);
      const r = row.getBoundingClientRect();
      let linkHits = 0, total = 0;
      for (let x = r.left + 6; x < r.right - 6; x += 40) {
        for (let y = r.top + 4; y < r.bottom - 4; y += 10) {
          total++;
          const el = document.elementFromPoint(x, y);
          if (el && el.closest && el.closest('a')) linkHits++;
        }
      }
      return Number((linkHits / total * 100).toFixed(1));
    }
    return { A: cov('.A .row'), B: cov('a.rowlink') };
  });
  await page.close();
  return { A, B, rowClickCoveragePct: coverage, file };
}

// ---------- E5：P0-2 抽屉关闭焦点 ----------
async function e5(browser, port) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(400);
  const toggleSel = '.sidebar-toggle, [data-nav-toggle], .tbtn.sidebar-toggle';
  const has = await page.evaluate((s) => !!document.querySelector(s), toggleSel);
  if (!has) { await page.close(); return { port, skipped: 'no toggle' }; }
  const out = { port };
  out.open = await page.evaluate((s) => {
    const t = document.querySelector(s);
    t.click();
    return { expanded: t.getAttribute('aria-expanded'), navOpen: document.body.classList.contains('nav-open') };
  }, toggleSel);
  await page.waitForTimeout(300);
  // 在抽屉里聚焦一个链接，然后按 Escape
  out.escape = await page.evaluate(async (s) => {
    const side = document.querySelector('.sidebar');
    const link = side ? side.querySelector('a[href]') : null;
    if (link) link.focus();
    const scrollBefore = Math.round(scrollY);
    const focusedBefore = document.activeElement ? document.activeElement.tagName + '.' + String(document.activeElement.className || '').slice(0, 20) : null;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const t = document.querySelector(s);
    return {
      focusedBefore,
      scrollBefore,
      expanded: t.getAttribute('aria-expanded'),
      navOpen: document.body.classList.contains('nav-open'),
      activeAfter: document.activeElement ? document.activeElement.tagName + '.' + String(document.activeElement.className || '').slice(0, 24) : null,
      focusReturnedToToggle: document.activeElement === t,
      toggleVisible: !!(t.offsetWidth || t.offsetHeight),
      scrollAfter: Math.round(scrollY),
      scrollDelta: Math.round(scrollY) - scrollBefore,
      // 焦点环是否可见（toggle 可见 => 环可见）
      toggleRect: (function () { const r = t.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; })(),
    };
  }, toggleSel);
  await page.close();
  return out;
}

(async () => {
  const exe = chromePath();
  const browser = await chromium.launch({ executablePath: exe });
  const out = { at: new Date().toISOString(), e1: [], e2: [], e4: null, e5: [] };
  for (const port of [8787, 8788]) out.e1.push(await e1(browser, port));
  for (const port of [8787, 8788]) out.e2.push(await e2(browser, port));
  out.e4 = await e4(browser);
  for (const port of [8787, 8788]) out.e5.push(await e5(browser, port));
  await browser.close();

  console.log('===== E1 移动端 resize 是否打回折叠（用户控制） =====');
  for (const x of out.e1) console.log(' [' + x.port + '] ' + JSON.stringify(x));
  console.log('\n===== E2 sticky TOC 遮挡锚点（2.4.11 / 2.4.7） =====');
  for (const x of out.e2) console.log(' [' + x.port + '] ' + JSON.stringify(x));
  console.log('\n===== E4 对照实验：谁能保住文字选中 =====');
  console.log(' A(现状 ::after): ' + JSON.stringify(out.e4.A));
  console.log(' B(整行 <a>)   : ' + JSON.stringify(out.e4.B));
  console.log(' 整行命中率: ' + JSON.stringify(out.e4.rowClickCoveragePct));
  console.log(' 对照文件: ' + out.e4.file);
  console.log('\n===== E5 抽屉关闭焦点归位（P0-2） =====');
  for (const x of out.e5) console.log(' [' + x.port + '] ' + JSON.stringify(x));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('\nartifact: ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
