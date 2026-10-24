'use strict';
/**
 * b1a-links.js — 阶段 C：P0-4 拉伸链接交互实测 / 桌面折叠是否被 resize 打回 / 1024 断点盲区 / 嵌套可交互元素
 *
 * 证据只写系统临时目录。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(os.tmpdir(), 'dsh-b1a');
fs.mkdirSync(TMP, { recursive: true });
const OUT = path.join(TMP, 'links.json');

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

// ---------- 1) 拉伸链接（P0-4）真实交互 ----------
async function stretched(browser, port, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(500);
  const found = await page.evaluate(() => !!document.querySelector('.src-item'));
  if (!found) { await page.close(); return { port, url, missing: true }; }

  const geom = await page.evaluate(() => {
    // 挑一个同时有摘要与路径的行，否则测量无意义
    const items = Array.from(document.querySelectorAll('.src-item'));
    const item = items.find((el) => el.querySelector('.src-sum') && el.querySelector('.src-rel')) || items[0];
    if (!item) return { missing: true };
    item.scrollIntoView({ block: 'center' });
    const ir = item.getBoundingClientRect();
    const link = item.querySelector('.src-link');
    const lr = link.getBoundingClientRect();
    const sum = item.querySelector('.src-sum');
    const rel = item.querySelector('.src-rel');
    const sr = sum ? sum.getBoundingClientRect() : null;
    const rr = rel ? rel.getBoundingClientRect() : null;
    const hit = (x, y) => { const e = document.elementFromPoint(x, y); return e ? { tag: e.tagName, cls: String(e.className || '').slice(0, 28) } : null; };
    return {
      item: { w: Math.round(ir.width), h: Math.round(ir.height), x: Math.round(ir.left), y: Math.round(ir.top) },
      linkRect: { w: Math.round(lr.width), h: Math.round(lr.height), x: Math.round(lr.left), y: Math.round(lr.top) },
      linkAreaSharePct: Number(((lr.width * lr.height) / Math.max(1, ir.width * ir.height) * 100).toFixed(1)),
      sum: sr ? { w: Math.round(sr.width), h: Math.round(sr.height), cx: Math.round(sr.left + 30), cy: Math.round(sr.top + sr.height / 2) } : null,
      rel: rr ? { w: Math.round(rr.width), h: Math.round(rr.height), cx: Math.round(rr.left + 10), cy: Math.round(rr.top + rr.height / 2) } : null,
      hitOnSummaryText: sr ? hit(sr.left + 30, sr.top + sr.height / 2) : null,
      hitOnPathText: rr ? hit(rr.left + 10, rr.top + rr.height / 2) : null,
      sumUserSelect: sum ? getComputedStyle(sum).userSelect : null,
      sumPointerEvents: sum ? getComputedStyle(sum).pointerEvents : null,
      relPointerEvents: rel ? getComputedStyle(rel).pointerEvents : null,
      linkAfter: (function () { const a = getComputedStyle(link, '::after'); return { pos: a.position, top: a.top, left: a.left, w: a.width, h: a.height }; })(),
      linkAccessibleNameFromDOM: link.textContent.trim(),
      siblingText: Array.from(item.children).map((c) => ({ tag: c.tagName, cls: String(c.className || ''), text: c.textContent.trim().slice(0, 40) })),
      itemTag: item.tagName,
      itemRole: item.getAttribute('role'),
    };
  });

  const out = { port, url, geom };
  if (geom.missing || !geom.sum) { await page.close(); return out; }

  // 关键：先装「点击拦截」。P0-4 的拉伸层意味着双击/单击摘要文字会命中 <a>，
  // 浏览器会直接导航离开（这本身就是本次要测的行为）。装护栏后才能继续测量。
  await page.evaluate(() => {
    window.__ev = [];
    document.addEventListener('click', (e) => {
      window.__ev.push({
        tag: e.target.tagName,
        cls: String(e.target.className || '').slice(0, 26),
        isLink: !!(e.target.closest && e.target.closest('a')),
        linkText: e.target.closest && e.target.closest('a') ? e.target.closest('a').textContent.trim() : null,
      });
      e.preventDefault(); // 阻止真的跳走，便于后续测量
    }, false);
  });

  // (a) 双击摘要文字 → 选中的是什么（DOM 顺序仍可选中，但视觉层被覆盖）
  await page.mouse.click(geom.sum.cx, geom.sum.cy, { clickCount: 2 });
  await page.waitForTimeout(250);
  out.doubleClickSummary = await page.evaluate(() => {
    const s = window.getSelection();
    const node = s && s.anchorNode;
    const el = node ? (node.nodeType === 3 ? node.parentElement : node) : null;
    return {
      selectedText: String(s || '').slice(0, 60),
      selectedInLink: el && el.closest ? !!el.closest('a') : null,
      selectedEl: el ? el.tagName + '.' + String(el.className || '').slice(0, 24) : null,
      rangeCount: s ? s.rangeCount : 0,
      clicks: window.__ev.length,
      clickTargets: window.__ev.map((c) => c.tag + '.' + c.cls + (c.isLink ? ' [LINK ' + c.linkText + ']' : '')),
      stillOnPage: !!document.querySelector('.src-item'),
    };
  });

  // (b) 单击摘要文字 → 事件 target 是链接吗（真实用户右键/拖选都会被这一层改语义）
  await page.evaluate(() => { window.__ev = []; });
  await page.mouse.click(geom.sum.cx, geom.sum.cy);
  await page.waitForTimeout(200);
  out.clickSummary = await page.evaluate(() => window.__ev);

  // (c) 右键摘要 → contextmenu target（是否变成链接菜单）
  out.contextMenuOnSummary = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.src-item'));
    const holder = items.find((el) => el.querySelector('.src-sum'));
    if (!holder) return null;
    const sum = holder.querySelector('.src-sum');
    const r = sum.getBoundingClientRect();
    const target = document.elementFromPoint(r.left + 20, r.top + r.height / 2) || sum;
    let cap = null;
    const h = (e) => {
      e.preventDefault();
      const el = e.target;
      cap = {
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 26),
        isLink: !!(el.closest && el.closest('a')),
        linkText: el.closest && el.closest('a') ? el.closest('a').textContent.trim() : null,
        hitByPoint: (function () { const e2 = document.elementFromPoint(r.left + 20, r.top + r.height / 2); return e2 ? e2.tagName + '.' + String(e2.className || '').slice(0, 26) : null; })(),
      };
    };
    document.addEventListener('contextmenu', h, true);
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + r.height / 2 }));
    document.removeEventListener('contextmenu', h, true);
    return cap;
  });

  // (d) 键盘：焦点环几何（只覆盖链接文字那一小段）
  out.keyboard = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.src-item'));
    const holder = items.find((el) => el.querySelector('.src-link') && el.querySelector('.src-sum')) || items.find((el) => el.querySelector('.src-link'));
    if (!holder) return null;
    const link = holder.querySelector('.src-link');
    link.focus();
    const r = link.getBoundingClientRect();
    const item = link.closest('.src-item');
    const ir = item.getBoundingClientRect();
    const cs = getComputedStyle(link);
    return {
      focused: document.activeElement === link,
      ringBox: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) },
      itemBox: { w: Math.round(ir.width), h: Math.round(ir.height) },
      ringCoversRowPct: Number((r.height / ir.height * 100).toFixed(1)),
      outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor + ' offset=' + cs.outlineOffset,
      // 焦点时整行是否有可见指示（只有文字部分有）
      itemOutlineWhenFocused: getComputedStyle(item).outlineStyle,
      tabIndex: link.tabIndex,
    };
  });

  // (e) 触摸目标：整行可点 vs 仅链接可聚焦
  out.touch = await page.evaluate(() => {
    const item = document.querySelector('.src-item');
    const ir = item.getBoundingClientRect();
    return { rowHeight: Math.round(ir.height), rowWidth: Math.round(ir.width) };
  });

  await page.close();
  return out;
}

// ---------- 2) 桌面折叠是否被 resize 打回 ----------
async function collapse(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(400);
  const shape = await page.evaluate(() => {
    const d = document.querySelector('.toc-side details.toc-fold');
    const s = document.querySelector('.toc-side .toc-title');
    return { hasDetails: !!d, summaryTabIndex: s ? s.tabIndex : null, open: d ? d.open : null, tocLinks: document.querySelectorAll('.toc-side a').length };
  });
  const st = () => page.evaluate(() => {
    const d = document.querySelector('.toc-side details.toc-fold');
    if (!d) return null;
    const ol = d.querySelector('ol');
    return { open: d.open, hasOpenAttr: d.hasAttribute('open'), olH: ol ? Math.round(ol.getBoundingClientRect().height) : null };
  });
  const out = { port, shape, before: await st() };

  // 鼠标点 summary 想收起
  await page.click('.toc-side .toc-title');
  await page.waitForTimeout(200);
  out.afterClickCollapse = await st();

  // 1px resize（窗口拖动 / 浏览器 UI 变化都会触发）
  await page.setViewportSize({ width: 1439, height: 900 });
  await page.waitForTimeout(300);
  out.afterResize1px = await st();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  out.afterResizeBack = await st();

  // 键盘：Enter / Space 能否切换
  await page.evaluate(() => document.querySelector('.toc-side .toc-title').focus());
  out.kbFocus = await page.evaluate(() => ({ focused: document.activeElement === document.querySelector('.toc-side .toc-title'), tag: document.activeElement.tagName }));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(180);
  out.afterEnter = await st();
  await page.keyboard.press(' ');
  await page.waitForTimeout(180);
  out.afterSpace = await st();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(180);
  out.afterEnter2 = await st();

  // 折叠后再 resize → 是否被强行拉回展开（用户控制问题）
  await page.setViewportSize({ width: 1441, height: 900 });
  await page.waitForTimeout(300);
  out.afterResizeAfterKbCollapse = await st();

  // 滚动是否会打回
  await page.evaluate(() => { const d = document.querySelector('.toc-side details.toc-fold'); if (d) d.open = false; });
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(300);
  out.afterScroll = await st();

  await page.close();
  return out;
}

// ---------- 3) 1024 断点：TOC 与侧栏都不存在？ ----------
async function breakpoint(browser, port) {
  const out = { port, widths: {} };
  for (const w of [1023, 1024, 1025]) {
    const page = await browser.newPage({ viewport: { width: w, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(350);
    out.widths[w] = await page.evaluate(() => {
      const toc = document.querySelector('.toc-side');
      const toggle = document.querySelector('.sidebar-toggle');
      const side = document.querySelector('.sidebar');
      const drawerToc = document.querySelector('.side-toc');
      const det = document.querySelector('.toc-side details.toc-fold');
      const visible = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      return {
        mq1025: matchMedia('(min-width:1025px)').matches,
        mq1024: matchMedia('(min-width:1024px)').matches,
        tocDisplay: toc ? getComputedStyle(toc).display : null,
        tocVisible: visible(toc),
        tocOpen: det ? det.open : null,
        toggleVisible: visible(toggle),
        toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
        sidebarTransform: side ? getComputedStyle(side).transform : null,
        sidebarVisible: visible(side),
        drawerTocDisplay: drawerToc ? getComputedStyle(drawerToc).display : null,
        topbarH: getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim(),
        // 可用的目录入口数量（能真实看到并可点的）
        reachableTocEntry: (visible(toc) ? 1 : 0) + (visible(drawerToc) && visible(toggle) ? 1 : 0),
      };
    });
    await page.close();
  }
  return out;
}

// ---------- 4) 嵌套可交互元素：summary 里的 <a> ----------
async function nestedInteractive(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/paper/aikars-flags/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(400);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const picked = nodes.map((n) => ({
    role: n.role ? n.role.value : null,
    name: n.name ? String(n.name.value || '').slice(0, 70) : null,
    props: (n.properties || []).filter((p) => ['expanded', 'focusable'].includes(p.name)).map((p) => p.name + '=' + p.value.value),
  })).filter((n) => ['DisclosureTriangle', 'link', 'button'].includes(n.role));

  const out = {
    port,
    // summary 的 AX 名里含 ▸（伪元素污染可访问名）
    disclosureNames: picked.filter((n) => n.role === 'DisclosureTriangle').slice(0, 14),
    // 侧栏里「组首页 →」是否作为独立 link 存在于 summary 内
    homeLinks: picked.filter((n) => n.role === 'link' && /组首页/.test(n.name || '')).slice(0, 6),
    // 树里有没有 ▸ 字符出现在任何可访问名里
    namesWithTriangle: picked.filter((n) => /▸/.test(n.name || '')).length,
    totalDisclosures: picked.filter((n) => n.role === 'DisclosureTriangle').length,
  };

  // summary 内 <a> 的键盘行为：Tab 到它、按 Enter 是否同时展开 details
  out.nested = await page.evaluate(() => {
    const sum = document.querySelector('.side-group-title');
    if (!sum) return null;
    const a = sum.querySelector('a.side-home');
    if (!a) return null;
    const d = sum.closest('details');
    const beforeOpen = d ? d.open : null;
    a.focus();
    const focused = document.activeElement === a;
    // 模拟 Enter（链接会导航，这里只测 click 是否触发 details toggle）
    let toggledByClick = null;
    const guard = (e) => { e.preventDefault(); };
    document.addEventListener('click', guard, true);
    a.click();
    toggledByClick = d ? d.open !== beforeOpen : null;
    document.removeEventListener('click', guard, true);
    const r = a.getBoundingClientRect();
    return {
      linkFocusable: focused,
      linkBox: { w: Math.round(r.width), h: Math.round(r.height) },
      detailsToggledByLinkClick: toggledByClick,
      parentIsSummary: sum.tagName,
      linkIndentVsSummary: Math.round(r.left) + ' vs ' + Math.round(sum.getBoundingClientRect().left),
    };
  });
  await page.close();
  return out;
}

(async () => {
  const exe = chromePath();
  const browser = await chromium.launch({ executablePath: exe });
  const out = { at: new Date().toISOString(), stretched: [], collapse: [], breakpoint: [], nested: [] };

  for (const port of [8787, 8788]) {
    out.stretched.push(await stretched(browser, port, '/'));
    out.stretched.push(await stretched(browser, port, '/sections/paper.html'));
  }
  for (const port of [8787, 8788]) out.collapse.push(await collapse(browser, port));
  for (const port of [8787, 8788]) out.breakpoint.push(await breakpoint(browser, port));
  for (const port of [8787, 8788]) out.nested.push(await nestedInteractive(browser, port));
  await browser.close();

  console.log('===== STRETCHED LINK（P0-4） =====');
  for (const s of out.stretched) {
    if (s.missing) { console.log(` [${s.port}] ${s.url} -> no .src-item`); continue; }
    console.log(`\n [${s.port}] ${s.url}`);
    console.log('   geom: ' + JSON.stringify(s.geom));
    console.log('   dblclick: ' + JSON.stringify(s.doubleClickSummary));
    console.log('   click: ' + JSON.stringify(s.clickSummary));
    console.log('   contextmenu: ' + JSON.stringify(s.contextMenuOnSummary));
    console.log('   keyboard: ' + JSON.stringify(s.keyboard));
  }
  console.log('\n===== COLLAPSE（桌面能否关掉 TOC） =====');
  for (const c of out.collapse) {
    console.log(` [${c.port}] shape=${JSON.stringify(c.shape)}`);
    for (const k of ['before', 'afterClickCollapse', 'afterResize1px', 'afterResizeBack', 'kbFocus', 'afterEnter', 'afterSpace', 'afterEnter2', 'afterResizeAfterKbCollapse', 'afterScroll']) {
      console.log('   ' + k + ': ' + JSON.stringify(c[k]));
    }
  }
  console.log('\n===== BREAKPOINT 1023/1024/1025 =====');
  for (const b of out.breakpoint) {
    console.log(` [${b.port}]`);
    for (const w of Object.keys(b.widths)) console.log('   ' + w + ': ' + JSON.stringify(b.widths[w]));
  }
  console.log('\n===== NESTED INTERACTIVE =====');
  for (const n of out.nested) {
    console.log(` [${n.port}] disclosures=${n.totalDisclosures} namesWithTriangle=${n.namesWithTriangle}`);
    console.log('   disclosureNames=' + JSON.stringify(n.disclosureNames));
    console.log('   homeLinks=' + JSON.stringify(n.homeLinks));
    console.log('   nested=' + JSON.stringify(n.nested));
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('\nartifact: ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
