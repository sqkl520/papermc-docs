'use strict';
/**
 * b1a-deep.js — 阶段 B：焦点顺序 / sticky TOC 遮挡锚点 / 拉伸链接 交互实测 / 显式深色 / reduce-motion
 *
 * 证据只写系统临时目录。8787 = 改后，8788 = 改前。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(os.tmpdir(), 'dsh-b1a');
fs.mkdirSync(TMP, { recursive: true });
const OUT = path.join(TMP, 'deep.json');

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
  if (m) { let h = m[1]; if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 }; }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const p = m[1].split(/[,\/\s]+/).filter(Boolean).map(Number); if (p.length >= 3) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  return null;
}
function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
function ratio(fg, bg) {
  let f = parseColor(fg), b = parseColor(bg);
  if (!f || !b) return null;
  const L1 = lum(f), L2 = lum(b);
  return Number(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2));
}

// ---------- 1) Tab 顺序 vs 视觉顺序（2.4.3） ----------
async function tabOrderMap(browser, port, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(350);
  const map = await page.evaluate(() => {
    const sel = 'a[href],button,summary,input,select,textarea,[tabindex="0"]';
    const all = Array.from(document.querySelectorAll(sel)).filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (el.closest('[inert]') || el.hasAttribute('inert')) return false;
      return true;
    });
    const labels = all.map((el, i) => {
      const r = el.getBoundingClientRect();
      return {
        i,
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 34),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
        top: Math.round(r.top + scrollY),
        left: Math.round(r.left),
        region: el.closest('.toc-side') ? 'toc' : (el.closest('.content') ? 'content' : (el.closest('.sidebar') ? 'sidebar' : 'chrome')),
      };
    });
    const tocIdx = labels.filter((l) => l.region === 'toc').map((l) => l.i);
    const contentIdx = labels.filter((l) => l.region === 'content').map((l) => l.i);
    const sidebarIdx = labels.filter((l) => l.region === 'sidebar').map((l) => l.i);
    return {
      total: labels.length,
      tocPositions: tocIdx,
      contentRange: contentIdx.length ? [Math.min(...contentIdx), Math.max(...contentIdx)] : null,
      sidebarCount: sidebarIdx.length,
      firstToc: labels.find((l) => l.region === 'toc') || null,
      tocAfterContent: tocIdx.length && contentIdx.length ? Math.min(...tocIdx) > Math.max(...contentIdx) : null,
      // 视觉顺序：toc 在 390 时是 sticky 吸顶在正文上方
      order: labels.filter((l) => ['toc', 'content'].includes(l.region)).slice(0, 3).map((l) => ({ region: l.region, tag: l.tag, text: l.text, top: l.top })),
      sample: labels.slice(0, 5).map((l) => l.region + ':' + l.tag + '.' + l.cls),
    };
  });
  await page.close();
  return { port, viewport, ...map };
}

// ---------- 2) sticky TOC 遮挡锚点（移动端展开态） ----------
async function anchorOcclusion(browser, port, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(350);
  const res = await page.evaluate(async () => {
    const out = {};
    const det = document.querySelector('.toc-side details.toc-fold, .toc-side');
    const isDetails = det && det.tagName === 'DETAILS';
    if (isDetails && !det.open) det.open = true;
    await new Promise((r) => setTimeout(r, 200));
    const toc = document.querySelector('.toc-side');
    const tocR = toc.getBoundingClientRect();
    const topbar = document.querySelector('.topbar').getBoundingClientRect();
    out.pre = {
      tocPos: getComputedStyle(toc).position,
      tocZ: getComputedStyle(toc).zIndex,
      tocTop: Math.round(tocR.top), tocBottom: Math.round(tocR.bottom), tocH: Math.round(tocR.height),
      topbarBottom: Math.round(topbar.bottom),
      scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
      open: isDetails ? det.open : null,
    };
    // 取 TOC 第 2 条锚点，用真实 hash 导航（模拟点击链接 + 地址栏直达）
    const link = toc.querySelectorAll('a[href^="#"]')[1];
    if (!link) { out.error = 'no toc anchor'; return out; }
    const id = link.getAttribute('href').slice(1);
    out.hash = id;
    location.hash = '#' + id;
    await new Promise((r) => setTimeout(r, 900)); // smooth scroll 完成
    const target = document.getElementById(id);
    const tr = target.getBoundingClientRect();
    const tocR2 = document.querySelector('.toc-side').getBoundingClientRect();
    const tb2 = document.querySelector('.topbar').getBoundingClientRect();
    out.post = {
      scrollY: Math.round(scrollY),
      headingTop: Math.round(tr.top),
      headingBottom: Math.round(tr.bottom),
      tocTop: Math.round(tocR2.top), tocBottom: Math.round(tocR2.bottom),
      topbarBottom: Math.round(tb2.bottom),
      // 关键：标题顶部是否落在 sticky 区内
      coveredByTocPx: Math.max(0, Math.round(tocR2.bottom - tr.top)),
      coveredByTopbarPx: Math.max(0, Math.round(tb2.bottom - tr.top)),
      headingVisibleHeight: Math.round(Math.max(0, Math.min(innerHeight, tr.bottom) - Math.max(0, tr.top))),
      headingTotalHeight: Math.round(tr.height),
    };
    // 命中测试：标题第一行文字处，是不是被 TOC 盖住
    const probeY = Math.max(tr.top + 6, 0);
    const probeX = Math.min(tr.left + 40, innerWidth - 2);
    const hit = document.elementFromPoint(probeX, probeY);
    out.post.hitAtHeadingTop = hit ? { tag: hit.tagName, cls: String(hit.className || '').slice(0, 40), inToc: !!(hit.closest && hit.closest('.toc-side')) } : null;
    out.post.occluded = !!(hit && hit.closest && hit.closest('.toc-side'));
    // 标题文字本身是否在可视区内（非裁切）
    out.post.headingTextVisibleAboveToc = tr.top >= document.querySelector('.toc-side').getBoundingClientRect().bottom;
    return out;
  });
  await page.close();
  return { port, viewport, ...res };
}

// ---------- 3) 拉伸链接：鼠标选中 / 右键 / 命中 ----------
async function stretchedLink(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/paper/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(400);
  const geom = await page.evaluate(() => {
    const item = document.querySelector('.src-item');
    if (!item) return { missing: true };
    item.scrollIntoView({ block: 'center' });
    const ir = item.getBoundingClientRect();
    const link = item.querySelector('.src-link');
    const lr = link.getBoundingClientRect();
    const sum = item.querySelector('.src-sum');
    const rel = item.querySelector('.src-rel');
    const sr = sum ? sum.getBoundingClientRect() : null;
    const rr = rel ? rel.getBoundingClientRect() : null;
    const hit = (x, y) => { const e = document.elementFromPoint(x, y); return e ? { tag: e.tagName, cls: String(e.className || '').slice(0, 30) } : null; };
    return {
      item: { w: Math.round(ir.width), h: Math.round(ir.height) },
      link: { w: Math.round(lr.width), h: Math.round(lr.height) },
      linkSharePct: Number(((lr.width * lr.height) / (ir.width * ir.height) * 100).toFixed(1)),
      sum: sr ? { w: Math.round(sr.width), h: Math.round(sr.height), x: Math.round(sr.left + 24), y: Math.round(sr.top + sr.height / 2) } : null,
      rel: rr ? { w: Math.round(rr.width), h: Math.round(rr.height), x: Math.round(rr.left + 8), y: Math.round(rr.top + rr.height / 2) } : null,
      hitOnSumCenter: sr ? hit(sr.left + Math.min(30, sr.width / 2), sr.top + sr.height / 2) : null,
      hitOnRel: rr ? hit(rr.left + Math.min(8, rr.width / 2), rr.top + rr.height / 2) : null,
      sumUserSelect: sum ? getComputedStyle(sum).userSelect : null,
      sumPointerEvents: sum ? getComputedStyle(sum).pointerEvents : null,
      relPointerEvents: rel ? getComputedStyle(rel).pointerEvents : null,
      linkDisplay: getComputedStyle(link).display,
      afterInset: (function () { const a = getComputedStyle(link, '::after'); return { top: a.top, right: a.right, bottom: a.bottom, left: a.left, position: a.position }; })(),
      // DOM 顺序：sr 读到的是一句连读还是分开
      siblings: Array.from(item.children).map((c) => c.tagName + '.' + String(c.className || '')),
    };
  });
  const out = { port, geom };
  if (geom.missing) { await page.close(); return out; }

  // 双击摘要 → 选中的是摘要文字？还是链接文字？
  await page.mouse.click(geom.sum.x, geom.sum.y, { clickCount: 2 });
  await page.waitForTimeout(200);
  out.dblclickOnSummary = await page.evaluate(() => ({
    selected: String(window.getSelection() || '').slice(0, 70),
    selInLink: (function () { const s = window.getSelection(); if (!s || !s.anchorNode) return null; const el = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode; return !!(el.closest && el.closest('a')); })(),
  }));

  // 单击摘要空白处：是否会导航（拦截导航，看 click target 是否是链接）
  await page.evaluate(() => {
    window.__clicks = [];
    document.addEventListener('click', (e) => {
      window.__clicks.push({ tag: e.target.tagName, cls: String(e.target.className || '').slice(0, 30), defaultPrevented: e.defaultPrevented });
    }, true);
    document.addEventListener('click', (e) => { e.preventDefault(); }, false);
  });
  await page.mouse.click(geom.sum.x, geom.sum.y);
  await page.waitForTimeout(150);
  out.clickOnSummary = await page.evaluate(() => window.__clicks);

  // 右键菜单目标（contextmenu 的 target 是不是链接）
  out.contextMenu = await page.evaluate(() => {
    const sum = document.querySelector('.src-item .src-sum');
    if (!sum) return null;
    const r = sum.getBoundingClientRect();
    const target = document.elementFromPoint(r.left + 20, r.top + r.height / 2) || sum;
    let captured = null;
    const h = (e) => { e.preventDefault(); captured = { tag: e.target.tagName, cls: String(e.target.className || '').slice(0, 30), isLink: !!(e.target.closest && e.target.closest('a')) }; };
    document.addEventListener('contextmenu', h, true);
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + r.height / 2 }));
    document.removeEventListener('contextmenu', h, true);
    return captured;
  });

  // 键盘焦点：Tab 到 .src-link，焦点环是否被行容器裁切 + 焦点是否能到摘要（不可）
  out.keyboard = await page.evaluate(() => {
    const link = document.querySelector('.src-item .src-link');
    link.focus();
    const r = link.getBoundingClientRect();
    const cs = getComputedStyle(link);
    const itemR = link.closest('.src-item').getBoundingClientRect();
    return {
      focused: document.activeElement === link,
      linkH: Math.round(r.height),
      itemH: Math.round(itemR.height),
      // 焦点环只在 25px 高的链接文字上，不是整行
      ringHeight: Math.round(r.height) + 4,
      itemOverflow: getComputedStyle(link.closest('.src-item')).overflow,
      outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
      accessibleName: link.textContent.trim(),
    };
  });
  await page.close();
  return out;
}

// ---------- 4) 显式深色（data-theme=dark）对比度 ----------
async function explicitDark(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  const d = await page.evaluate(async () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'dark');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const grab = (el) => {
      if (!el) return null;
      let n = el, bg = null;
      while (n && n !== document.documentElement) {
        const c = getComputedStyle(n).backgroundColor;
        const m = c.match(/^rgba?\(([^)]+)\)$/);
        if (m) { const p = m[1].split(/[,\/\s]+/).filter(Boolean).map(Number); if (p.length < 4 || p[3] > 0.5) { bg = c; break; } }
        n = n.parentElement;
      }
      if (!bg) bg = getComputedStyle(document.body).backgroundColor;
      const cs = getComputedStyle(el);
      return { color: cs.color, bg, fontSize: cs.fontSize, fontWeight: cs.fontWeight, border: cs.borderTopColor, outline: cs.outlineColor };
    };
    const q = (s) => document.querySelector(s);
    const tok = (name) => { const d = document.createElement('div'); d.style.color = 'var(' + name + ')'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    const out = {
      themeAttr: root.getAttribute('data-theme'),
      colorScheme: getComputedStyle(root).colorScheme,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      tokens: {},
      snap: {
        body: grab(document.body),
        contentP: grab(q('.article p, .content p')),
        link: grab(q('.article a:not(.heading-anchor)')),
        tocLink: grab(q('.toc-side a')),
        tocTitle: grab(q('.toc-side .toc-title')),
        srcSum: grab(q('.src-item .src-sum')),
        srcRel: grab(q('.src-item .src-rel')),
        sideHome: grab(q('.side-home')),
        codeCopy: grab(q('.code-copy')),
        codeLang: grab(q('.code-title .code-lang')),
        codePlain: grab(q('pre code')),
        sideGroupTitle: grab(q('.side-group-title')),
        sideCount: grab(q('.side-count')),
        tocCount: grab(q('.toc-count')),
      },
      hljs: {},
    };
    for (const t of ['--bg', '--bg-soft', '--bg-elev', '--fg', '--fg-muted', '--border', '--border-strong', '--accent', '--code-bg', '--hl-comment', '--hl-keyword', '--hl-string', '--hl-number', '--hl-title', '--hl-builtin', '--hl-variable', '--hl-deletion']) {
      out.tokens[t] = tok(t);
    }
    for (const tc of ['hljs-comment', 'hljs-keyword', 'hljs-string', 'hljs-number', 'hljs-title', 'hljs-built_in', 'hljs-variable', 'hljs-attr', 'hljs-tag', 'hljs-meta', 'hljs-params', 'hljs-property', 'hljs-type', 'hljs-literal', 'hljs-symbol', 'hljs-name', 'hljs-section', 'hljs-deletion', 'hljs-addition']) {
      const el = q('pre code .' + tc);
      if (el) out.hljs[tc] = grab(el);
    }
    // 提示条渐隐伪元素在深色下用的变量
    const over = q('.code-scroll[data-overflowing]');
    out.fade = over ? { after: getComputedStyle(over, '::after').backgroundImage, codeBg: tok('--code-bg') } : null;
    return out;
  });
  await page.close();
  return { port, ...d };
}

// ---------- 5) reduce-motion ----------
async function motion(browser, port) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  const d = await page.evaluate(async () => {
    const toc = document.querySelector('.toc-side');
    const det = document.querySelector('.toc-side details.toc-fold');
    const out = {
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      tocPosition: toc ? getComputedStyle(toc).position : null,
      tocSticky: toc ? getComputedStyle(toc).position === 'sticky' : null,
      markerTransition: (function () { const s = document.querySelector('.toc-side .toc-title'); return s ? getComputedStyle(s, '::before').transitionDuration : null; })(),
      sidebarTransition: (function () { const s = document.querySelector('.sidebar'); return s ? getComputedStyle(s).transitionDuration : null; })(),
      skipTransition: (function () { const s = document.querySelector('.skip'); return s ? getComputedStyle(s).transitionDuration : null; })(),
    };
    // 实测：hash 跳转是否一帧到位（auto）还是渐进（smooth）
    const link = toc ? toc.querySelector('a[href^="#"]') : null;
    if (link) {
      if (det && det.tagName === 'DETAILS') det.open = true;
      await new Promise((r) => setTimeout(r, 120));
      const id = link.getAttribute('href').slice(1);
      location.hash = '#' + id;
      const a = Math.round(scrollY);
      await new Promise((r) => requestAnimationFrame(r));
      const b = Math.round(scrollY);
      await new Promise((r) => setTimeout(r, 600));
      const c = Math.round(scrollY);
      out.jump = { frame1: a, frame2: b, settled: c, oneFrame: Math.abs(b - c) <= 2 };
    }
    return out;
  });
  await page.close();
  return { port, ...d };
}

// ---------- 6) AX：<summary> 的 role/状态 ----------
async function axDetail(browser, port, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(350);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const pick = (n) => ({
    role: n.role ? n.role.value : null,
    name: n.name ? String(n.name.value || '').slice(0, 80) : null,
    ignored: !!n.ignored,
    props: (n.properties || []).filter((p) => ['expanded', 'focusable', 'level', 'hasPopup', 'readonly'].includes(p.name))
      .map((p) => p.name + '=' + p.value.value),
  });
  const all = nodes.map(pick);
  const tocDetail = all.filter((n) => /本页目录/.test(n.name || '') || n.role === 'DisclosureTriangle');
  const codeRegion = all.filter((n) => n.role === 'region');
  const complement = all.filter((n) => n.role === 'complementary');
  // 折叠态：在 390 下再取一次，看链接是否从树里消失
  const closedState = await page.evaluate(() => {
    const d = document.querySelector('.toc-side details.toc-fold');
    return d ? { open: d.open } : null;
  });
  await page.close();
  return { port, viewport, closedState, tocDetail, codeRegion: codeRegion.slice(0, 4), complement, totalNodes: nodes.length };
}

(async () => {
  const exe = chromePath();
  const browser = await chromium.launch({ executablePath: exe, chromiumSandbox: false });
  const out = { chrome: exe, at: new Date().toISOString(), tabOrder: [], occlusion: [], stretched: [], dark: [], motion: [], ax: [] };

  for (const port of [8787, 8788]) {
    out.tabOrder.push(await tabOrderMap(browser, port, { width: 390, height: 844 }));
    out.tabOrder.push(await tabOrderMap(browser, port, { width: 1440, height: 900 }));
  }
  for (const port of [8787, 8788]) {
    out.occlusion.push(await anchorOcclusion(browser, port, { width: 390, height: 844 }));
    out.occlusion.push(await anchorOcclusion(browser, port, { width: 1025, height: 800 }));
  }
  for (const port of [8787, 8788]) out.stretched.push(await stretchedLink(browser, port));
  for (const port of [8787, 8788]) out.dark.push(await explicitDark(browser, port));
  for (const port of [8787, 8788]) out.motion.push(await motion(browser, port));
  for (const port of [8787, 8788]) {
    out.ax.push(await axDetail(browser, port, { width: 390, height: 844 }));
    out.ax.push(await axDetail(browser, port, { width: 1440, height: 900 }));
  }
  await browser.close();

  console.log('===== TAB ORDER（2.4.3 焦点顺序 vs 视觉顺序） =====');
  for (const t of out.tabOrder) {
    console.log(` [${t.port}@${t.viewport.width}] total=${t.total} tocPositions=${JSON.stringify(t.tocPositions)} contentRange=${JSON.stringify(t.contentRange)} tocAfterContent=${t.tocAfterContent} sidebar=${t.sidebarCount}`);
    console.log('   firstToc=' + JSON.stringify(t.firstToc));
    console.log('   visual=' + JSON.stringify(t.order));
  }
  console.log('\n===== OCCLUSION（sticky TOC 遮挡锚点） =====');
  for (const o of out.occlusion) console.log(' [' + o.port + '@' + o.viewport.width + '] ' + JSON.stringify({ pre: o.pre, post: o.post }));
  console.log('\n===== STRETCHED LINK（P0-4） =====');
  for (const s of out.stretched) console.log(' [' + s.port + '] ' + JSON.stringify(s));
  console.log('\n===== EXPLICIT DARK =====');
  for (const d of out.dark) {
    console.log(` [${d.port}] theme=${d.themeAttr} scheme=${d.colorScheme} bodyBg=${d.bodyBg}`);
    for (const k of Object.keys(d.snap)) {
      const v = d.snap[k];
      if (!v) continue;
      const need = (parseFloat(v.fontSize) >= 24 || (parseInt(v.fontWeight, 10) >= 700 && parseFloat(v.fontSize) >= 18.66)) ? 3 : 4.5;
      const r = ratio(v.color, v.bg);
      console.log(`   ${r >= need ? 'PASS' : 'FAIL'} ${String(r).padStart(5)} (need ${need}) ${k} [${v.color} on ${v.bg}] ${v.fontSize}/${v.fontWeight}`);
    }
    for (const k of Object.keys(d.hljs)) {
      const v = d.hljs[k];
      const r = ratio(v.color, v.bg);
      console.log(`   ${r >= 4.5 ? 'PASS' : 'FAIL'} ${String(r).padStart(5)} (need 4.5) hljs.${k} [${v.color} on ${v.bg}]`);
    }
    console.log('   UI: --border vs --bg ' + ratio(d.tokens['--border'], d.bodyBg) + ' ; --border-strong ' + ratio(d.tokens['--border-strong'], d.bodyBg) + ' ; --accent ' + ratio(d.tokens['--accent'], d.bodyBg));
    console.log('   fade=' + JSON.stringify(d.fade));
  }
  console.log('\n===== MOTION =====');
  for (const m of out.motion) console.log(' [' + m.port + '] ' + JSON.stringify(m));
  console.log('\n===== AX（summary 语义） =====');
  for (const a of out.ax) {
    console.log(` [${a.port}@${a.viewport.width}] total=${a.totalNodes} closed=${JSON.stringify(a.closedState)}`);
    console.log('   tocDetail=' + JSON.stringify(a.tocDetail));
    console.log('   complement=' + JSON.stringify(a.complement));
    console.log('   regions=' + JSON.stringify(a.codeRegion));
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('\nartifact: ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
