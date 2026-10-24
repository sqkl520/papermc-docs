'use strict';
/**
 * b1a-keyboard.js — 批 1 改动的键盘 / 无障碍树 / 锚点遮挡实测（阶段 B）
 *
 * 产出 reports/_b1a-keyboard.json
 * 覆盖审查项 1（AX 树里的 role/name/expanded/重复 announce）、2（桌面能否折叠 + resize 强制回开）、
 * 3（真实 Tab 序列 + ::before 是否进可访问名）、4（拉伸链接的命中/选择/右键）、
 * 5（sticky TOC 遮挡锚点与焦点环）、6（相邻目标间距）、9（reduced-motion 实测）。
 *
 * 对比度单独在 b1a-contrast.js：那里用可靠的 hex 解析。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'reports', '_b1a-keyboard.json');

function chromePath() {
  const cands = [];
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH);
  if (process.env.LOCALAPPDATA) {
    cands.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'));
    cands.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'));
  }
  if (process.env.PROGRAMFILES) cands.push(path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  throw new Error('no chrome found; tried: ' + cands.join(' | '));
}

const NEW = 8787;
const OLD = 8788;
const TOC_PAGE = '/paper/aikars-flags/';   // 5 条 TOC + 3 个代码块（1 个溢出）+ 拉伸链接

// ---------- 1) AX 树：<details>/<summary> 的真实语义 ----------
async function axTree(browser, port, viewport, urlPath) {
  const page = await browser.newPage({ viewport });
  await page.goto(`http://127.0.0.1:${port}${urlPath}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');

  // 只保留我们关心的子集，避免 2MB 的树
  const keep = [];
  for (const n of nodes) {
    const role = n.role && n.role.value;
    const name = n.name && n.name.value;
    if (!role) continue;
    if (['button', 'complementary', 'navigation', 'region', 'list', 'listitem', 'link', 'heading'].includes(role)) {
      keep.push({
        nodeId: n.nodeId,
        role,
        name: (name || '').slice(0, 90),
        ignored: !!n.ignored,
        expanded: n.properties ? (function () {
          const p = n.properties.find((x) => x.name === 'expanded');
          return p ? p.value.value : undefined;
        })() : undefined,
        level: n.properties ? (function () {
          const p = n.properties.find((x) => x.name === 'level');
          return p ? p.value.value : undefined;
        })() : undefined,
        focusable: n.properties ? (function () {
          const p = n.properties.find((x) => x.name === 'focusable');
          return p ? p.value.value : undefined;
        })() : undefined,
      });
    }
  }
  // 找「本页目录」相关节点
  const tocNodes = keep.filter((n) => /本页目录|目录/.test(n.name || '') || n.role === 'complementary');
  // 折叠态下目录链接是否还在树里
  const tocLinkNodes = keep.filter((n) => n.role === 'link' && /Recommended JVM|Aikar|内存|flags/i.test(n.name || ''));
  // region 节点（代码块）
  const regions = keep.filter((n) => n.role === 'region');
  const summaryLike = keep.filter((n) => n.role === 'button' && /本页目录|目录/.test(n.name || ''));

  await page.close();
  return {
    port, viewport, urlPath,
    tocNodes,
    tocLinkCount: tocLinkNodes.length,
    tocLinkNames: tocLinkNodes.slice(0, 4).map((n) => n.name),
    regions: regions.slice(0, 5).map((n) => ({ role: n.role, name: n.name, focusable: n.focusable })),
    regionCount: regions.length,
    summaryLike,
    complementaryCount: keep.filter((n) => n.role === 'complementary').length,
    navigationCount: keep.filter((n) => n.role === 'navigation').length,
    navNames: keep.filter((n) => n.role === 'navigation').map((n) => n.name),
    // 所有 button 的名字，用来看 ::before 是否污染可访问名
    buttons: keep.filter((n) => n.role === 'button').map((n) => ({ name: n.name, expanded: n.expanded })).slice(0, 12),
  };
}

// ---------- 2) 真实 Tab 序列 ----------
async function tabOrder(browser, port, viewport, maxTabs) {
  const page = await browser.newPage({ viewport });
  await page.goto(`http://127.0.0.1:${port}${TOC_PAGE}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  const seq = [];
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const inToc = !!el.closest('.toc-side');
      // 焦点环是否被某祖先的 overflow 裁掉
      let clipped = false;
      let n = el.parentElement;
      while (n && n !== document.documentElement) {
        const s = getComputedStyle(n);
        if (s.overflowY === 'hidden' || s.overflowY === 'auto' || s.overflowY === 'scroll') {
          const nr = n.getBoundingClientRect();
          if (r.top - 2 < nr.top || r.bottom + 2 > nr.bottom) { clipped = true; break; }
        }
        n = n.parentElement;
      }
      return {
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 46),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 46),
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) },
        outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
        inToc,
        clippedByScrollParent: clipped,
        ariaExpanded: el.getAttribute && el.getAttribute('aria-expanded'),
        // summary 的展开状态
        detailsOpen: (el.tagName === 'SUMMARY' && el.parentElement && el.parentElement.tagName === 'DETAILS') ? el.parentElement.open : undefined,
      };
    });
    seq.push(info);
    if (info && info.inToc && info.tag === 'A') break; // 进到 TOC 第一个链接即停
    if (i > 40) break;
  }
  await page.close();
  return { port, viewport, seq };
}

// ---------- 3) 桌面能否折叠 TOC + resize 是否强制回开 ----------
async function collapseControl(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}${TOC_PAGE}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  // 老版本没有 <details>（右栏是裸可见列表）：先记录形态，后续步骤全部做空值防护
  const shape = await page.evaluate(() => ({
    hasDetails: !!document.querySelector('.toc-side .toc-fold'),
    summaryTabIndex: (function () { const s = document.querySelector('.toc-side .toc-title'); return s ? s.tabIndex : null; })(),
    tocLinkCount: document.querySelectorAll('.toc-side a').length,
  }));
  const state = () => page.evaluate(() => {
    const d = document.querySelector('.toc-side .toc-fold');
    if (!d) return null;
    const ol = d.querySelector('ol');
    return { open: d.open, has: d.hasAttribute('open'), olVisible: ol ? ol.getBoundingClientRect().height > 0 : null };
  });
  const before = await state();
  const clicked = await page.evaluate(() => {
    const s = document.querySelector('.toc-side .toc-title');
    if (!s) return null;
    s.click();
    return true;
  });
  const afterClick = await state();
  // 调整窗口 1px（用户拖一下窗口 / 手机旋转）看是否被硬拉回 open
  await page.setViewportSize({ width: 1439, height: 900 });
  await page.waitForTimeout(250);
  const afterResize = await state();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  // 键盘：聚焦 summary 后按 Enter / Space 能否切换
  const kbFocusable = await page.evaluate(() => {
    const s = document.querySelector('.toc-side .toc-title');
    if (!s) return null;
    s.focus();
    return { focused: document.activeElement === s, tabIndex: s.tabIndex };
  });
  const kbBefore = await state();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(140);
  const kbAfterEnter = await state();
  await page.keyboard.press('Space');
  await page.waitForTimeout(140);
  const kbAfterSpace = await state();
  // resize 触发强制回开（键盘折叠后再 resize）
  await page.setViewportSize({ width: 1441, height: 900 });
  await page.waitForTimeout(250);
  const afterResize2 = await state();
  // 滚动不触发 syncToc：验证「折叠后滚动仍保持折叠」
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  const scrollKeep = await page.evaluate(async () => {
    const d = document.querySelector('.toc-side .toc-fold');
    if (!d) return null;
    d.open = false;
    window.scrollTo(0, 600);
    await new Promise((r) => setTimeout(r, 220));
    const opened = d.open;
    window.scrollTo(0, 0);
    return opened;
  });
  await page.close();
  return { port, shape, before, clicked, afterClick, afterResize, kbFocusable, kbBefore, kbAfterEnter, kbAfterSpace, afterResize2, scrollKeep };
}

// ---------- 3b) 移动端折叠 TOC 的键盘操作 ----------
async function mobileTocKeyboard(browser, port) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}${TOC_PAGE}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  const shape = await page.evaluate(() => {
    const d = document.querySelector('.toc-side .toc-fold');
    const s = document.querySelector('.toc-side .toc-title');
    return {
      hasDetails: !!d,
      initiallyOpen: d ? d.open : null,
      summaryTabIndex: s ? s.tabIndex : null,
      summaryVisible: s ? !!(s.offsetWidth || s.offsetHeight) : null,
      tocLinkTabIndexes: Array.from(document.querySelectorAll('.toc-side .toc-fold a')).slice(0, 3).map((a) => a.tabIndex),
      // 折叠态下链接是否 display:none（即 sr/键盘都到不了）
      firstLinkDisplay: (function () {
        const a = document.querySelector('.toc-side .toc-fold a');
        if (!a) return null;
        const cs = getComputedStyle(a);
        return { display: cs.display, visibility: cs.visibility, rectH: Math.round(a.getBoundingClientRect().height) };
      })(),
    };
  });
  // 键盘：聚焦 summary → Enter 展开 → 再 Tab 能进链接
  const kb = await page.evaluate(() => {
    const s = document.querySelector('.toc-side .toc-title');
    if (s) s.focus();
    return { focused: document.activeElement === (s || null), tag: document.activeElement ? document.activeElement.tagName : null };
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(160);
  const afterEnter = await page.evaluate(() => {
    const d = document.querySelector('.toc-side .toc-fold');
    return { open: d ? d.open : null, hasOpenAttr: d ? d.hasAttribute('open') : null };
  });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  const afterTab = await page.evaluate(() => {
    const el = document.activeElement;
    const r = el ? el.getBoundingClientRect() : null;
    const toc = document.querySelector('.toc-side');
    const tr = toc ? toc.getBoundingClientRect() : null;
    // 焦点链接是否落在 sticky TOC 之下被盖住
    const covered = (r && tr) ? (r.top < tr.bottom) : null;
    const hit = (r && r.width) ? document.elementFromPoint(Math.min(r.left + 6, innerWidth - 1), Math.max(r.top + 4, 0)) : null;
    return {
      tag: el ? el.tagName : null,
      text: el ? el.textContent.trim().slice(0, 30) : null,
      rect: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null,
      tocRect: tr ? { top: Math.round(tr.top), bottom: Math.round(tr.bottom), h: Math.round(tr.height) } : null,
      coveredByToc: covered,
      hitAtFocusTop: hit ? { tag: hit.tagName, cls: String(hit.className || '').slice(0, 40) } : null,
      inToc: el && el.closest ? !!el.closest('.toc-side') : null,
    };
  });
  // 收集 Enter 展开后 ::before 的旋转与提示
  const marker = await page.evaluate(() => {
    const s = document.querySelector('.toc-side .toc-title');
    if (!s) return null;
    const b = getComputedStyle(s, '::before');
    return { content: b.content, transform: b.transform, transition: b.transitionDuration };
  });
  await page.close();
  return { port, shape, kb, afterEnter, afterTab, marker };
}

// ---------- 4) 锚点跳转是否被 sticky TOC / topbar 遮挡 ----------
async function anchorOcclusion(browser, port, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(`http://127.0.0.1:${port}${TOC_PAGE}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  // 先展开移动端 TOC（模拟键盘用户 Enter 展开后点链接）
  const openState = await page.evaluate(() => {
    const d = document.querySelector('.toc-side .toc-fold');
    if (d && !d.open) { d.open = true; }
    return d ? d.open : null;
  });
  await page.waitForTimeout(250);
  const res = await page.evaluate(async () => {
    const out = { steps: [] };
    const toc = document.querySelector('.toc-side');
    const tocR = toc.getBoundingClientRect();
    out.tocRect = { top: Math.round(tocR.top), bottom: Math.round(tocR.bottom), h: Math.round(tocR.height) };
    out.tocPosition = getComputedStyle(toc).position;
    out.tocZ = getComputedStyle(toc).zIndex;
    // 点 TOC 第 2 条链接
    const links = Array.from(document.querySelectorAll('.toc-side .toc-fold a'));
    if (links.length < 2) return out;
    const a = links[1];
    const id = a.getAttribute('href').slice(1);
    a.click();
    await new Promise((r) => setTimeout(r, 700)); // smooth scroll 完
    const target = document.getElementById(id);
    if (!target) return out;
    const tr = target.getBoundingClientRect();
    const topbar = document.querySelector('.topbar').getBoundingClientRect();
    out.targetId = id;
    out.targetTop = Math.round(tr.top);
    out.targetBottom = Math.round(tr.bottom);
    out.topbarBottom = Math.round(topbar.bottom);
    out.scrollPaddingTop = getComputedStyle(document.documentElement).scrollPaddingTop;
    out.scrollY = Math.round(scrollY);
    // 目标标题顶部是否被 sticky TOC 盖住
    out.tocBottom = Math.round(toc.getBoundingClientRect().bottom);
    out.coveredByTocPx = Math.max(0, Math.round(toc.getBoundingClientRect().bottom - tr.top));
    out.coveredByTopbarPx = Math.max(0, Math.round(topbar.bottom - tr.top));
    // 命中测试：标题中心点上方是否被 toc 拦截
    const probeX = Math.min(Math.max(tr.left + 30, 1), innerWidth - 2);
    const probeY = Math.max(tr.top + 4, 1);
    const hit = document.elementFromPoint(probeX, probeY);
    out.hitAtTargetTop = hit ? { tag: hit.tagName, cls: String(hit.className || '').slice(0, 40), inToc: !!hit.closest('.toc-side') } : null;
    // 目标标题文本是否真的可见（视口内）
    out.targetTopInViewport = tr.top >= 0 && tr.top < innerHeight;
    return out;
  });
  await page.close();
  return { port, viewport, openState, ...res };
}

// ---------- 5) 拉伸链接：命中 / 选择 / 右键 ----------
async function stretchedLink(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // src-tree 在首页与分区页；用 /paper/ 分区首页
  await page.goto(`http://127.0.0.1:${port}/paper/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  const geom = await page.evaluate(() => {
    const item = document.querySelector('.src-item');
    if (!item) return { missing: true };
    item.scrollIntoView({ block: 'center' });
    const r = item.getBoundingClientRect();
    const link = item.querySelector('.src-link');
    const lr = link.getBoundingClientRect();
    const sum = item.querySelector('.src-sum');
    const rel = item.querySelector('.src-rel');
    const sr = sum ? sum.getBoundingClientRect() : null;
    // 摘要中心点的命中元素
    const hitSum = sr ? document.elementFromPoint(sr.left + Math.min(30, sr.width / 2), sr.top + sr.height / 2) : null;
    const rr = rel ? rel.getBoundingClientRect() : null;
    const hitRel = rr ? document.elementFromPoint(rr.left + Math.min(10, rr.width / 2), rr.top + rr.height / 2) : null;
    return {
      item: { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) },
      link: { top: Math.round(lr.top), h: Math.round(lr.height), w: Math.round(lr.width), left: Math.round(lr.left) },
      linkCoveragePct: Math.round((lr.height / r.height) * 100),
      sumRect: sr ? { w: Math.round(sr.width), h: Math.round(sr.height), left: Math.round(sr.left) } : null,
      relRect: rr ? { w: Math.round(rr.width), h: Math.round(rr.height), left: Math.round(rr.left) } : null,
      hitOnSummary: hitSum ? { tag: hitSum.tagName, cls: String(hitSum.className || '').slice(0, 40) } : null,
      hitOnRel: hitRel ? { tag: hitRel.tagName, cls: String(hitRel.className || '').slice(0, 40) } : null,
      sumPointerEvents: sum ? getComputedStyle(sum).pointerEvents : null,
      relPointerEvents: rel ? getComputedStyle(rel).pointerEvents : null,
      sumUserSelect: sum ? getComputedStyle(sum).userSelect : null,
      itemUserSelect: getComputedStyle(item).userSelect,
      sumText: sum ? sum.textContent.trim().slice(0, 40) : null,
    };
  });

  // 真实鼠标：双击摘要文字是否选中了摘要（而不是选中链接文本）
  const dbl = await page.evaluate(() => {
    const sum = document.querySelector('.src-item .src-sum');
    if (!sum) return null;
    const r = sum.getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2), text: sum.textContent.trim().slice(0, 30) };
  });
  let selection = null;
  if (dbl) {
    await page.mouse.click(dbl.x, dbl.y, { clickCount: 2 });
    await page.waitForTimeout(200);
    selection = await page.evaluate(() => ({
      selectedText: String(window.getSelection() || '').slice(0, 60),
      anchorTag: (function () { const s = window.getSelection(); return s && s.anchorNode ? (s.anchorNode.parentElement ? s.anchorNode.parentElement.tagName : s.anchorNode.nodeName) : null; })(),
    }));
    // 单击同一位置：会导航（链接覆盖）。用 CDP 拦截导航以避免离开页面
    await page.evaluate(() => { window.__navGuard = true; document.addEventListener('click', (e) => { if (window.__navGuard) { e.preventDefault(); window.__lastPrevented = { tag: e.target.tagName, cls: String(e.target.className || '') }; } }, true); });
    await page.mouse.click(dbl.x, dbl.y);
    await page.waitForTimeout(150);
    selection.singleClickTarget = await page.evaluate(() => window.__lastPrevented || null);
  }
  // 右键菜单目标：contextmenu 事件的 target 是不是链接
  const ctx = await page.evaluate(() => {
    const sum = document.querySelector('.src-item .src-sum');
    if (!sum) return null;
    const r = sum.getBoundingClientRect();
    return new Promise((resolve) => {
      const handler = (e) => {
        document.removeEventListener('contextmenu', handler, true);
        e.preventDefault();
        resolve({ tag: e.target.tagName, cls: String(e.target.className || '').slice(0, 40), isSrcLink: e.target.classList && e.target.classList.contains('src-link') });
      };
      document.addEventListener('contextmenu', handler, true);
      // 合成一个真实右键
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + r.height / 2 });
      // 用 elementFromPoint 的节点派发，模拟浏览器命中
      const targetEl = document.elementFromPoint(r.left + 20, r.top + r.height / 2) || sum;
      targetEl.dispatchEvent(ev);
    });
  });
  // 键盘可达：Tab 到 .src-link 时焦点环是否被 .src-item 裁掉
  const kb = await page.evaluate(() => {
    const link = document.querySelector('.src-item .src-link');
    if (!link) return null;
    link.focus();
    const r = link.getBoundingClientRect();
    const cs = getComputedStyle(link);
    return {
      focused: document.activeElement === link,
      rect: { top: Math.round(r.top), h: Math.round(r.height) },
      outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor + ' offset ' + cs.outlineOffset,
      // DOM 文本顺序：链接 → 摘要 → 路径，sr 会读成一句
      domOrder: Array.from(link.parentElement.children).map((el) => ({ tag: el.tagName, cls: String(el.className || ''), text: el.textContent.trim().slice(0, 34) })),
    };
  });
  await page.close();
  return { port, geom, selection, contextMenu: ctx, keyboard: kb };
}

// ---------- 6) 相邻目标间距（2.5.8 间距例外） ----------
async function targetSpacing(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/paper/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  const data = await page.evaluate(() => {
    // 所有 side-home + code-copy 的矩形，算最近邻间距（圆周法：两目标外接矩形之间的最小距离）
    function gap(a, b) {
      const dx = Math.max(a.left - b.right, b.left - a.right, 0);
      const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
      return Math.sqrt(dx * dx + dy * dy);
    }
    function collect(sel) {
      return Array.from(document.querySelectorAll(sel)).map((el) => {
        const r = el.getBoundingClientRect();
        return { el, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, text: el.textContent.trim().slice(0, 20) };
      });
    }
    const homes = collect('.side-home');
    // 同组内相邻（按 top 排序后，间距最小的那一对）
    const sorted = homes.slice().sort((a, b) => a.top - b.top);
    let minPair = null;
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const g = gap(sorted[i], sorted[j]);
        if (!minPair || g < minPair.gap) {
          minPair = { gap: Number(g.toFixed(2)), a: { w: Math.round(sorted[i].w), h: Math.round(sorted[i].h), text: sorted[i].text }, b: { w: Math.round(sorted[j].w), h: Math.round(sorted[j].h), text: sorted[j].text } };
        }
      }
    }
    const copies = collect('.code-copy');
    const cpSorted = copies.slice().sort((a, b) => a.top - b.top);
    let cpMin = null;
    for (let i = 1; i < cpSorted.length; i++) {
      const g = gap(cpSorted[i - 1], cpSorted[i]);
      if (!cpMin || g < cpMin.gap) cpMin = { gap: Number(g.toFixed(2)) };
    }
    // TOC 链接（桌面 25px 高，垂直相邻 gap ≈ 0）
    const tocLinks = collect('.toc-side .toc-fold a');
    let tocGap = null;
    for (let i = 1; i < tocLinks.length; i++) {
      const g = gap(tocLinks[i - 1], tocLinks[i]);
      if (!tocGap || g < tocGap.gap) tocGap = { gap: Number(g.toFixed(2)) };
    }
    return {
      sideHome: {
        count: homes.length,
        sizes: homes.slice(0, 4).map((h) => ({ w: Number(h.w.toFixed(1)), h: Number(h.h.toFixed(1)) })),
        minNeighbourGap: minPair,
      },
      codeCopy: { count: copies.length, sizes: copies.slice(0, 3).map((c) => ({ w: Number(c.w.toFixed(1)), h: Number(c.h.toFixed(1)) })), minNeighbourGap: cpMin },
      tocLinks: { count: tocLinks.length, sizes: tocLinks.slice(0, 3).map((t) => ({ w: Number(t.w.toFixed(1)), h: Number(t.h.toFixed(1)) })), minNeighbourGap: tocGap },
    };
  });
  await page.close();
  return { port, ...data };
}

// ---------- 7) reduced-motion 实测 ----------
async function reducedMotion(browser, port) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${port}${TOC_PAGE}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  const data = await page.evaluate(() => {
    const html = getComputedStyle(document.documentElement);
    const toc = document.querySelector('.toc-side');
    const tocs = toc ? getComputedStyle(toc) : null;
    const side = document.querySelector('.sidebar');
    return {
      matchesReduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      scrollBehavior: html.scrollBehavior,
      tocPosition: tocs ? tocs.position : null,
      tocStickyStillOn: tocs ? tocs.position === 'sticky' : null,
      sidebarTransition: side ? getComputedStyle(side).transitionDuration : null,
      skipTransition: (function () { const s = document.querySelector('.skip'); return s ? getComputedStyle(s).transitionDuration : null; })(),
      tocBeforeTransition: (function () {
        const s = document.querySelector('.toc-side .toc-title');
        return s ? getComputedStyle(s, '::before').transitionDuration : null;
      })(),
      // smooth scroll 是否真的关掉：点击锚点后一帧内的 scrollY 变化
      scrollBehaviorAnchorTest: null,
    };
  });
  // 实测：点锚点后立即读 scrollY（smooth 会中途；auto 会一次到位）
  data.anchorJump = await page.evaluate(async () => {
    const a = document.querySelector('.toc-side .toc-fold a');
    const d = document.querySelector('.toc-side .toc-fold');
    if (!a) return null;
    d.open = true;
    await new Promise((r) => setTimeout(r, 60));
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (!target) return null;
    const expected = Math.round(target.getBoundingClientRect().top + scrollY);
    a.click();
    const immediate = Math.round(scrollY);
    await new Promise((r) => setTimeout(r, 700));
    const settled = Math.round(scrollY);
    return { expected: Math.round(expected), immediate, settled, jumpedInOneFrame: Math.abs(immediate - settled) < 2 };
  });
  await page.close();
  return { port, ...data };
}

// ---------- 8) :has() 不支持时的提示丢失 ----------
async function noHasSupport(browser, port) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // 在文档注入前把 CSS.supports 打桩不可行；改为直接验证「文字提示」在两个通道上的归属：
  //   (a) CSS content 生成的文字 —— 不可被 sr 读到、不可被选中、不进 AX 树
  //   (b) JS 写在 .code-scroll 的 aria-label —— 可被 sr 读到
  await page.goto(`http://127.0.0.1:${port}${TOC_PAGE}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(400);
  const data = await page.evaluate(() => {
    const hosts = Array.from(document.querySelectorAll('.code-scroll'));
    const over = hosts.filter((h) => h.hasAttribute('data-overflowing'));
    return {
      total: hosts.length,
      overflowing: over.length,
      supportsHas: (function () { try { return CSS.supports('selector(:has(*))'); } catch (e) { return null; } })(),
      samples: over.slice(0, 3).map((h) => {
        const fig = h.closest('.code-block');
        const title = fig ? fig.querySelector('.code-title') : null;
        return {
          ariaLabel: h.getAttribute('aria-label'),
          ariaLabelHasHint: /可横向滚动/.test(h.getAttribute('aria-label') || ''),
          cssAfterContent: title ? getComputedStyle(title, '::after').content : null,
          cssAfterText: title ? getComputedStyle(title, '::after').content.replace(/^"|"$/g, '') : null,
          // 该文字是否成为 .code-title 的 textContent（否 → 不可被 sr 选中/读到）
          titleTextContentHasHint: title ? /可横向滚动/.test(title.textContent) : null,
          fadePseudoContent: getComputedStyle(h, '::after').content,
        };
      }),
      // 表格同理
      tableWraps: Array.from(document.querySelectorAll('.table-wrap')).slice(0, 3).map((w) => ({
        ariaLabel: w.getAttribute('aria-label'),
        overflowing: w.hasAttribute('data-overflowing'),
        hasHint: /可横向滚动/.test(w.getAttribute('aria-label') || ''),
      })),
    };
  });
  await page.close();
  return { port, ...data };
}

(async () => {
  const exe = chromePath();
  const browser = await chromium.launch({ executablePath: exe });
  const out = { chrome: exe, generatedAt: new Date().toISOString() };

  out.ax = [];
  for (const port of [NEW, OLD]) {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      out.ax.push(await axTree(browser, port, vp, TOC_PAGE));
    }
  }
  out.tabs = [];
  for (const port of [NEW, OLD]) {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      out.tabs.push(await tabOrder(browser, port, vp, 18));
    }
  }
  out.collapse = [];
  for (const port of [NEW, OLD]) out.collapse.push(await collapseControl(browser, port));
  out.mobileKb = [];
  for (const port of [NEW, OLD]) out.mobileKb.push(await mobileTocKeyboard(browser, port));

  out.occlusion = [];
  for (const port of [NEW, OLD]) {
    for (const vp of [{ width: 390, height: 844 }, { width: 1025, height: 800 }]) {
      out.occlusion.push(await anchorOcclusion(browser, port, vp));
    }
  }
  out.stretched = [];
  for (const port of [NEW, OLD]) out.stretched.push(await stretchedLink(browser, port));
  out.spacing = [];
  for (const port of [NEW, OLD]) out.spacing.push(await targetSpacing(browser, port));
  out.motion = [];
  for (const port of [NEW, OLD]) out.motion.push(await reducedMotion(browser, port));
  out.hasSupport = [];
  for (const port of [NEW, OLD]) out.hasSupport.push(await noHasSupport(browser, port));

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('wrote ' + OUT);

  console.log('\n===== AX =====');
  for (const a of out.ax) {
    console.log(` [${a.port}@${a.viewport.width}] complementary=${a.complementaryCount} nav=${a.navigationCount} regions=${a.regionCount} tocLinkCount=${a.tocLinkCount}`);
    console.log('   tocNodes=' + JSON.stringify(a.tocNodes));
    console.log('   summaryLike=' + JSON.stringify(a.summaryLike));
    console.log('   tocLinks=' + JSON.stringify(a.tocLinkNames));
    console.log('   navNames=' + JSON.stringify(a.navNames));
    console.log('   regions=' + JSON.stringify(a.regions));
    console.log('   buttons=' + JSON.stringify(a.buttons));
  }
  console.log('\n===== TABS =====');
  for (const t of out.tabs) {
    console.log(` [${t.port}@${t.viewport.width}] steps=${t.seq.length}`);
    t.seq.forEach((s, i) => { if (s) console.log(`   ${i}: ${s.tag}.${s.cls} "${s.text}" top=${s.rect.top} h=${s.rect.h} outline=${s.outline} inToc=${s.inToc} exp=${s.ariaExpanded} dopen=${s.detailsOpen} clip=${s.clippedByScrollParent}`); });
  }
  console.log('\n===== COLLAPSE =====');
  for (const c of out.collapse) console.log(' ', JSON.stringify(c));
  console.log('\n===== MOBILE KB =====');
  for (const c of out.mobileKb) console.log(' ', JSON.stringify(c));
  console.log('\n===== OCCLUSION =====');
  for (const o of out.occlusion) console.log(' ', JSON.stringify(o));
  console.log('\n===== STRETCHED =====');
  for (const s of out.stretched) console.log(' ', JSON.stringify(s));
  console.log('\n===== SPACING =====');
  for (const s of out.spacing) console.log(' ', JSON.stringify(s));
  console.log('\n===== MOTION =====');
  for (const m of out.motion) console.log(' ', JSON.stringify(m));
  console.log('\n===== HAS =====');
  for (const h of out.hasSupport) console.log(' ', JSON.stringify(h));
})().catch((e) => { console.error(e); process.exit(1); });
