'use strict';
/**
 * verify-mobile-b.js — 验证 Agent B 独立复核器（6 项）
 *   1) B 抽屉（390×844 / 320×568）：☰ / aria / inert / 滚轮锁 / Esc / 遮罩真点击 / 焦点回归 / Tab×25
 *   2) B 桌面侧（1024 / 1280）：☰ display:none、抽屉 transform:none、无 inert
 *   3) C1：所有可见输入框 fontSize >= 16
 *   4) C2：顶栏可点控件 >= 44×44 + 顶栏自证（scrollWidth==clientWidth、高度 <= 56、不换行）
 *   5) F1：搜索索引懒加载（CDP Network + performance resource 双路）+ 离线复算命中集/排序 + 改前/改后 UI 逐条
 *   6) A11Y：prefers-reduced-motion / :focus-visible outline / 320px 无双向滚动
 *
 * 用法：
 *   node tools/verify-mobile-b.js [--json] [--url=http://127.0.0.1:8787] [--pre=http://127.0.0.1:8788]
 *                                 [--json=reports/mobile-verify-b.json] [--only=1,5]
 *
 * 独立性说明：
 *   - 离线打分器在这里**从零重写**（依据 tools/site/assets.js L879–1201 的交付实现逐条复述），
 *     不 require 任何 tools/ 下的既有脚本；
 *   - 滚动锁只用**真实滚轮**（红队已证伪 `window.scrollBy`：overflow:hidden 下程序化滚动仍会成功）；
 *   - 遮罩只用**真实指针点击**（先 elementFromPoint 断言命中遮罩，再等过渡 settle >= 450ms）。
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const hasFlag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const REPO = path.resolve(__dirname, '..');
const PRE_REPO = path.resolve(REPO, '..', '_pre-mobile');
const TARGET = opt('url', 'http://127.0.0.1:8787');
const PRE = opt('pre', 'http://127.0.0.1:8788');
const OUT = opt('json', path.join('reports', 'mobile-verify-b.json'));
const PRINT_JSON = hasFlag('json');
const ONLY = (opt('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.indexOf(String(id)) !== -1;

const SETTLE = 600;      // 过渡 settle（红队要求 >= 450ms）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean);
function browserPath() { for (const c of CANDIDATES) if (fs.existsSync(c)) return c; return null; }

/* ───────────────────────── 浏览器会话 ───────────────────────── */

function newCtx(browser, vp, extra) {
  return browser.newContext(Object.assign({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 2,
    isMobile: vp.w < 768,
    hasTouch: vp.w < 768,
  }, extra || {}));
}
async function withCtx(browser, vp, fn, extra) {
  const ctx = await newCtx(browser, vp, extra);
  const page = await ctx.newPage();
  try { return await fn(page, ctx); } finally { await ctx.close().catch(() => {}); }
}
async function go(page, url, settle) {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(settle === undefined ? 350 : settle);
}
/* ───────────────────────── 页面内探针 ───────────────────────── */

const READ_DRAWER = () => {
  const de = document.documentElement;
  const toggle = document.getElementById('nav-toggle');
  const side = document.getElementById('sidebar');
  const scrim = document.getElementById('nav-scrim');
  const act = document.activeElement;
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  return {
    toggle: toggle ? Object.assign({
      display: getComputedStyle(toggle).display,
      visibility: getComputedStyle(toggle).visibility,
      ariaExpanded: toggle.getAttribute('aria-expanded'),
      ariaControls: toggle.getAttribute('aria-controls'),
    }, box(toggle)) : null,
    drawer: side ? Object.assign({
      transform: getComputedStyle(side).transform,
      transitionDuration: getComputedStyle(side).transitionDuration,
      inert: side.inert === true,
      inertAttr: side.hasAttribute('inert'),
      position: getComputedStyle(side).position,
      display: getComputedStyle(side).display,
      scrollH: side.scrollHeight, clientH: side.clientHeight, scrollTop: side.scrollTop,
      overflowY: getComputedStyle(side).overflowY,
    }, box(side)) : null,
    scrim: scrim ? Object.assign({
      opacity: Number(getComputedStyle(scrim).opacity),
      visibility: getComputedStyle(scrim).visibility,
      display: getComputedStyle(scrim).display,
    }, box(scrim)) : null,
    overflow: de.scrollWidth - de.clientWidth,
    clientWidth: de.clientWidth,
    innerWidth: window.innerWidth,
    bodyOverflow: getComputedStyle(document.body).overflow,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    scrollY: Math.round(window.scrollY),
    docScrollH: de.scrollHeight,
    active: act ? { tag: act.tagName.toLowerCase(), id: act.id, inDrawer: !!(side && side.contains(act)), isToggle: act === toggle } : null,
  };
};

/** 真实滚轮：移动鼠标到 at 再 wheel，读 window.scrollY 增量 */
async function wheelDelta(page, dy, at) {
  const before = await page.evaluate(() => Math.round(window.scrollY));
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(420);
  const after = await page.evaluate(() => Math.round(window.scrollY));
  return { at, before, after, delta: after - before };
}

/* ── 1：抽屉 ── */
async function check1(browser, base, label) {
  const VPS = [{ name: '390x844', w: 390, h: 844 }, { name: '320x568', w: 320, h: 568 }];
  const out = { base: label, viewports: {} };
  for (const vp of VPS) {
    const r = { vp: vp.name, viewport: { w: vp.w, h: vp.h } };
    await withCtx(browser, vp, async (page) => {
      await go(page, base + '/paper/dev/pdc/', 400);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(80);
      const initial = await page.evaluate(READ_DRAWER);
      r.initial = initial;

      /* 真实点击 ☰ 打开 */
      await page.mouse.move(Math.round(vp.w / 2), 260);
      let openErr = null;
      try { await page.click('#nav-toggle', { timeout: 6000 }); } catch (e) { openErr = e.message.slice(0, 100); try { await page.click('#nav-toggle', { force: true, timeout: 6000 }); } catch (e2) { openErr += ' | ' + e2.message.slice(0, 100); } }
      await page.waitForTimeout(SETTLE);
      const open = await page.evaluate(READ_DRAWER);
      r.open = open;
      r.openError = openErr;

      /* 滚轮法：打开时正文锁
         红队只提到「必须用滚轮、不能用 scrollBy」；B 组复现时又发现一个更隐蔽的假象：
         某些坐标点（如 390×844 下的 382,422 落在宽溢出元素上）**关闭态滚轮也读 0**，
         单点测会把「改前无锁」误判成「已锁」。因此这里用 **3 个右侧点**，并且要求
         「关闭态至少一点可滚」作为对照组门槛，才算一次有效测量。 */
      const wx = Math.max(4, vp.w - 8);
      const pts = [
        { x: wx, y: Math.round(vp.h * 0.5) },
        { x: wx, y: 300 },
        { x: wx, y: Math.min(vp.h - 40, 700) },
      ];
      r.wheelPoints = pts;
      r.wheelOpen = [];
      for (const p of pts) r.wheelOpen.push(await wheelDelta(page, 600, p));
      r.scrimHitOpen = await page.evaluate((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return el ? { tag: el.tagName.toLowerCase(), id: el.id, cls: String(el.className || '').slice(0, 40) } : null;
      }, pts[0]);

      /* 抽屉自身可滚（在抽屉内部滚轮） */
      const dpt = await page.evaluate(() => {
        const s = document.getElementById('sidebar');
        const b = s.getBoundingClientRect();
        return { x: Math.round(b.left + b.width / 2), ys: [Math.round(Math.min(b.top + 200, window.innerHeight - 80)), Math.round(Math.min(b.top + 460, window.innerHeight - 80))], before: s.scrollTop, scrollH: s.scrollHeight, clientH: s.clientHeight };
      });
      r.wheelInsideDrawer = { before: dpt.before, scrollH: dpt.scrollH, clientH: dpt.clientH, samples: [] };
      for (const y of dpt.ys) {
        await page.evaluate(() => { document.getElementById('sidebar').scrollTop = 0; });
        await page.waitForTimeout(80);
        await page.mouse.move(dpt.x, y);
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(400);
        r.wheelInsideDrawer.samples.push({ y, delta: await page.evaluate(() => document.getElementById('sidebar').scrollTop) });
      }
      r.wheelInsideDrawer.delta = Math.max.apply(null, r.wheelInsideDrawer.samples.map((s) => s.delta));

      /* Esc 关闭 */
      await page.keyboard.press('Escape');
      await page.waitForTimeout(SETTLE);
      r.afterEsc = await page.evaluate(READ_DRAWER);

      /* 关闭态滚轮（对照组，必须至少一点可滚） */
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(120);
      r.wheelClosed = [];
      for (const p of pts) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(80);
        r.wheelClosed.push(await wheelDelta(page, 600, p));
      }

      /* 遮罩真实指针点击关闭 */
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(120);
      await page.click('#nav-toggle', { force: true, timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(SETTLE);
      r.reopened = await page.evaluate(READ_DRAWER);
      const hit = await page.evaluate(() => {
        const de = document.documentElement;
        const s = document.getElementById('sidebar');
        const b = s.getBoundingClientRect();
        const x = Math.min(de.clientWidth - 8, Math.max(b.right + 24, de.clientWidth - 40));
        const y = Math.min(window.innerHeight - 12, Math.round(window.innerHeight * 0.6));
        const el = document.elementFromPoint(x, y);
        return { x: Math.round(x), y: Math.round(y), tag: el ? el.tagName.toLowerCase() : null, id: el ? el.id : null, cls: el ? String(el.className || '') : null };
      });
      r.scrimHit = hit;
      r.scrimHitIsScrim = !!(hit && (hit.id === 'nav-scrim' || /scrim/.test(hit.cls || '')));
      await page.mouse.click(hit.x, hit.y);
      await page.waitForTimeout(Math.max(SETTLE, 500));
      r.afterScrimClick = await page.evaluate(READ_DRAWER);

      /* Tab × 25 不外逃 */
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.click('#nav-toggle', { force: true, timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(SETTLE);
      r.openedForTab = await page.evaluate(READ_DRAWER);
      const tabSeq = [];
      let escapedAt = null;
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Tab');
        const st = await page.evaluate(() => {
          const a = document.activeElement;
          const s = document.getElementById('sidebar');
          return { tag: a ? a.tagName.toLowerCase() : null, id: a ? a.id : '', inDrawer: !!(a && s && s.contains(a)) };
        });
        tabSeq.push(st);
        if (!st.inDrawer) { escapedAt = i + 1; break; }
      }
      r.tab = { presses: tabSeq.length, escapedAt, first: tabSeq.slice(0, 4), allInside: escapedAt === null && tabSeq.length === 25 && tabSeq.every((t) => t.inDrawer) };
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    });
    out.viewports[vp.name] = r;
  }
  return out;
}

function judge1(after, before) {
  const J = {};
  const crit = (name, fn) => { const per = {}; for (const v of ['390x844', '320x568']) per[v] = fn(after.viewports[v], before && before.viewports[v]); J[name] = { after: per, pass: Object.values(per).every((x) => x === true) }; };
  crit('B1 ☰ 可见且 >=44×44 + aria-expanded="false" + aria-controls', (a) => !!(a.initial.toggle && a.initial.toggle.display !== 'none' && a.initial.toggle.visibility !== 'hidden' && a.initial.toggle.w >= 44 && a.initial.toggle.h >= 44 && a.initial.toggle.ariaExpanded === 'false' && a.initial.toggle.ariaControls));
  crit('B2 打开：抽屉 left>=-1 + inert 移除 + overflow<=1 + 焦点在抽屉内 + aria=true', (a) => !!(a.open.drawer && a.open.drawer.left >= -1 && a.open.drawer.inert === false && !a.open.drawer.inertAttr && a.open.overflow <= 1 && a.open.active && a.open.active.inDrawer && a.open.toggle.ariaExpanded === 'true'));
  crit('B3 滚轮法滚动锁：打开态 3 点 ΔscrollY 全 0，且关闭态至少 1 点可滚', (a) => a.wheelOpen.every((w) => w.delta === 0) && a.wheelClosed.some((w) => w.delta > 0) && a.open.docScrollH > a.viewport.h);
  crit('B4 抽屉自身滚轮可滚', (a) => a.wheelInsideDrawer.scrollH > a.wheelInsideDrawer.clientH ? a.wheelInsideDrawer.delta > 0 : true);
  crit('B5 Esc 关闭 + 焦点回 ☰ + 重新 inert + aria=false', (a) => !!(a.afterEsc.toggle.ariaExpanded === 'false' && (a.afterEsc.drawer.left < -1 || /matrix\(1, 0, 0, 1, -/.test(a.afterEsc.drawer.transform)) && a.afterEsc.drawer.inert === true && a.afterEsc.active && a.afterEsc.active.isToggle));
  crit('B6 遮罩 elementFromPoint 命中 + 真实指针点击关闭 + 焦点回 ☰', (a) => !!(a.scrimHitIsScrim && a.afterScrimClick.toggle.ariaExpanded === 'false' && a.afterScrimClick.drawer.left < -1 && a.afterScrimClick.active && a.afterScrimClick.active.isToggle));
  crit('B7 Tab×25 焦点不外逃', (a) => a.tab.allInside);
  const failed = Object.keys(J).filter((k) => !J[k].pass);
  return { J, failed };
}

/* ── 2：桌面侧 ── */
async function check2(browser, base, label) {
  const VPS = [{ name: '1024x768', w: 1024, h: 768 }, { name: '1280x800', w: 1280, h: 800 }];
  const out = { base: label, viewports: {} };
  for (const vp of VPS) {
    await withCtx(browser, vp, async (page) => {
      await go(page, base + '/paper/dev/pdc/', 400);
      out.viewports[vp.name] = await page.evaluate(() => {
        const t = document.getElementById('nav-toggle');
        const s = document.getElementById('sidebar');
        const tc = getComputedStyle(t), sc = getComputedStyle(s);
        const tb = t.getBoundingClientRect(), sb = s.getBoundingClientRect();
        return {
          toggleDisplay: tc.display, toggleVisibility: tc.visibility,
          toggleW: Math.round(tb.width), toggleH: Math.round(tb.height),
          drawerTransform: sc.transform, drawerPosition: sc.position,
          drawerInert: s.inert === true, drawerInertAttr: s.hasAttribute('inert'),
          drawerLeft: Math.round(sb.left), drawerW: Math.round(sb.width),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
    });
  }
  return out;
}
function judge2(after, before) {
  const J = {};
  for (const v of ['1024x768', '1280x800']) {
    const a = after.viewports[v];
    J[v] = {
      after: { toggleDisplay: a.toggleDisplay, drawerTransform: a.drawerTransform, drawerInert: a.drawerInert, drawerPosition: a.drawerPosition, drawerW: a.drawerW, overflow: a.overflow },
      before: before ? { toggleDisplay: before.viewports[v].toggleDisplay, drawerTransform: before.viewports[v].drawerTransform, drawerInert: before.viewports[v].drawerInert } : null,
      pass: a.toggleDisplay === 'none' && (a.drawerTransform === 'none' || a.drawerTransform === 'matrix(1, 0, 0, 1, 0, 0)') && a.drawerInert === false && !a.drawerInertAttr && a.drawerW > 0,
    };
  }
  return { J, failed: Object.keys(J).filter((k) => !J[k].pass) };
}

/* ── 3：C1 输入框字号 ── */
const READ_INPUTS = () => {
  const visible = (el) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  return [...document.querySelectorAll('input, select, textarea')].map((el) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return {
      sel: el.id ? '#' + el.id : (el.className ? '.' + String(el.className).trim().split(/\s+/)[0] : el.tagName.toLowerCase()),
      tag: el.tagName.toLowerCase(), type: el.type || null,
      fontSize: parseFloat(cs.fontSize), visible: visible(el),
      w: Math.round(r.width), h: Math.round(r.height),
    };
  });
};
async function check3(browser, base, label) {
  const out = { base: label, scenarios: {} };
  const VP = { name: '390x844', w: 390, h: 844 };
  // A) 首页：hero-search / 搜索弹窗 / 抽屉内 side-filter
  await withCtx(browser, VP, async (page) => {
    await go(page, base + '/', 450);
    out.scenarios['/ 初始'] = await page.evaluate(READ_INPUTS);
    // 打开搜索弹窗（真实点击，失败回退 Ctrl+K）
    let strat = 'click';
    try { await page.click('[data-open-search]', { timeout: 2500 }); } catch (e) { strat = 'ctrl+k'; await page.keyboard.press('Control+k'); }
    await page.waitForTimeout(500);
    out.scenarios['/ 搜索弹窗'] = await page.evaluate(READ_INPUTS);
    out.searchOpenStrategy = strat;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // 打开抽屉
    await page.click('#nav-toggle', { timeout: 6000 });
    await page.waitForTimeout(SETTLE);
    out.scenarios['/ 抽屉打开'] = await page.evaluate(READ_INPUTS);
  });
  // B) 清单页：allpages-filter / 抽屉内 side-filter
  await withCtx(browser, VP, async (page) => {
    await go(page, base + '/all-pages.html', 450);
    out.scenarios['/all-pages.html 初始'] = await page.evaluate(READ_INPUTS);
    await page.click('#nav-toggle', { timeout: 6000 }).catch(async () => { await page.click('#nav-toggle', { force: true, timeout: 6000 }).catch(() => {}); });
    await page.waitForTimeout(SETTLE);
    out.scenarios['/all-pages.html 抽屉打开'] = await page.evaluate(READ_INPUTS);
  });
  return out;
}
function judge3(after, before) {
  const rows = [];
  const preMap = {};
  if (before) for (const [k, v] of Object.entries(before.scenarios)) if (Array.isArray(v)) for (const i of v) if (i.visible) preMap[i.sel] = i.fontSize;
  for (const [k, v] of Object.entries(after.scenarios)) {
    if (!Array.isArray(v)) continue;
    for (const i of v) if (i.visible) rows.push({ where: k, sel: i.sel, fontSize: i.fontSize, before: preMap[i.sel] === undefined ? null : preMap[i.sel], h: i.h, pass: i.fontSize >= 16 });
  }
  const failed = rows.filter((r) => !r.pass);
  return { rows, failed: failed.map((r) => `${r.where} ${r.sel} = ${r.fontSize}px`) };
}

/* ── 4：C2 顶栏 ── */
const READ_TOPBAR = () => {
  const h = document.querySelector('header.topbar') || document.querySelector('header');
  if (!h) return { missing: true };
  const hb = h.getBoundingClientRect();
  const cs = getComputedStyle(h);
  const ctrls = [...h.querySelectorAll('a, button, [role="button"], input, summary')].map((el) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const visible = s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    return {
      tag: el.tagName.toLowerCase(), id: el.id || null,
      cls: String(el.className || '').trim().split(/\s+/).slice(0, 2).join('.'),
      label: (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18),
      w: Math.round(r.width), h: Math.round(r.height), visible,
    };
  }).filter((c) => c.visible);
  return {
    headerH: Math.round(hb.height), scrollW: h.scrollWidth, clientW: h.clientWidth,
    selfContained: h.scrollWidth <= h.clientWidth + 1,
    flexWrap: cs.flexWrap, position: cs.position,
    ctrls, docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clientWidth: document.documentElement.clientWidth,
  };
};
async function check4(browser, base, label) {
  const VPS = [{ name: '390x844', w: 390, h: 844 }, { name: '320x568', w: 320, h: 568 }, { name: '1024x768', w: 1024, h: 768 }, { name: '1280x800', w: 1280, h: 800 }];
  const out = { base: label, viewports: {} };
  for (const vp of VPS) {
    await withCtx(browser, vp, async (page) => {
      await go(page, base + '/paper/dev/pdc/', 350);
      out.viewports[vp.name] = await page.evaluate(READ_TOPBAR);
    });
  }
  return out;
}
function judge4(after, before) {
  const rows = [];
  for (const [vp, m] of Object.entries(after.viewports)) {
    const mobile = parseInt(vp, 10) < 1024;
    const small = m.ctrls.filter((c) => c.w < 44 || c.h < 44);
    rows.push({
      vp, mobile, headerH: m.headerH, scrollW: m.scrollW, clientW: m.clientW,
      selfContained: m.selfContained, flexWrap: m.flexWrap, ctrls: m.ctrls.length,
      small: small.map((c) => `${c.tag}${c.id ? '#' + c.id : ''}${c.cls ? '.' + c.cls : ''} ${c.w}×${c.h}`),
      before: before ? (() => { const b = before.viewports[vp]; if (!b || b.missing) return null; const bs = b.ctrls.filter((c) => c.w < 44 || c.h < 44); return { headerH: b.headerH, ctrls: b.ctrls.length, small: bs.map((c) => `${c.tag}${c.id ? '#' + c.id : ''} ${c.w}×${c.h}`) }; })() : null,
    });
  }
  const failed = [];
  for (const r of rows) {
    if (!r.selfContained) failed.push(`${r.vp} 顶栏自证失败 scrollW ${r.scrollW} > clientW ${r.clientW}`);
    if (r.headerH > 56) failed.push(`${r.vp} 顶栏高度 ${r.headerH} > 56`);
    if (r.flexWrap !== 'nowrap') failed.push(`${r.vp} 顶栏 flex-wrap=${r.flexWrap}（疑似用换行遮丑）`);
    if (r.mobile && r.small.length) failed.push(`${r.vp} 移动线顶栏控件 <44×44：${r.small.join('; ')}`);
  }
  return { rows, failed };
}

/* ── 5：F1 搜索索引懒加载 + 命中集 ── */
const READ_RESULTS = () => {
  const list = document.querySelector('#search-results');
  const c = document.querySelector('#search-count');
  const items = list ? [...list.querySelectorAll('li a[href]')].map((a) => ({
    href: a.getAttribute('href'),
    title: (a.querySelector('.sr-ttl') || {}).textContent ? a.querySelector('.sr-ttl').textContent.trim() : '',
  })) : [];
  return { count: items.length, countText: c ? c.textContent.trim() : null, items };
};

/* ── 离线打分器：从 tools/site/assets.js 交付实现独立重写（L879–1201） ── */
function mkRanker(index) {
  const ALIASES = index.aliases || {};
  const PHRASE_BY_Q = {};
  ((index.phrases) || []).forEach((p) => { PHRASE_BY_Q[p.q] = p; });
  const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
  const MAX_RESULTS = 40;
  const COLL = new Intl.Collator('zh-Hans-CN');
  const zh = (a, b) => COLL.compare(String(a), String(b));
  const norm = (s) => String(s === undefined || s === null ? '' : s).toLowerCase();
  const headingText = (e) => norm((e.h || []).filter((x) => String(x).indexOf('关键词：') !== 0).join(' \u0001 '));
  const cache = new Map();
  function lc(e) {
    if (cache.has(e)) return cache.get(e);
    const kw = e.kw || [];
    const c = {
      t: norm(e.t), u: norm(e.u), h: headingText(e),
      c: norm((e.c || '') + ' ' + (e.cd || '')),
      x: norm(e.x),
      m: norm([e.u, kw.join(' '), e.c, e.cd, e.lt].join(' \u0001 ')),
      kw: kw.map(norm),
    };
    cache.set(e, c);
    return c;
  }
  // bodyIndexOf: 交付版用位图做“肯定没有”的前置跳过（只可能假阳性，靠精确 indexOf 定案），
  // 因此与裸 indexOf 等价 —— 这里直接用 indexOf。
  const bodyIndexOf = (l, q) => (q ? (l.x ? l.x.indexOf(q) : -1) : -1);

  function directScore(e, q) {
    const l = lc(e);
    const out = { s: 0, fields: [], body: false, tier: 0 };
    const title = l.t, sum = l.u, heads = l.h, cat = l.c;
    const tags = e.kw || [];
    if (title.indexOf(q) === 0) { out.s += 60; out.fields.push('标题'); out.tier = 4; }
    else if (title.indexOf(q) !== -1) { out.s += 30; out.fields.push('标题'); out.tier = 4; }
    for (let i = 0; i < tags.length; i++) {
      const tg = l.kw[i];
      if (!tg) continue;
      if (tg === q) { out.s += 32 + Math.max(0, 8 - i * 3); out.fields.push('标签 ' + tags[i]); out.tier = Math.max(out.tier, 2); }
      else if (tg.indexOf(q) !== -1) { out.s += 20 + Math.max(0, 6 - i * 2); out.fields.push('标签 ' + tags[i]); out.tier = Math.max(out.tier, 2); }
    }
    if (sum.indexOf(q) !== -1) { out.s += 18; out.fields.push('摘要'); out.tier = Math.max(out.tier, 2); }
    if (heads.indexOf(q) !== -1) { out.s += 12; out.fields.push('小节'); out.tier = Math.max(out.tier, 3); }
    if (cat.indexOf(q) !== -1) { out.s += 8; out.fields.push('分类'); out.tier = Math.max(out.tier, 2); }
    if (bodyIndexOf(l, q) !== -1) { out.s += 5; out.body = true; out.fields.push('正文'); out.tier = Math.max(out.tier, 1); }
    const al = ALIASES[q];
    if (al && al.length) {
      const has = (hay) => { for (let j = 0; j < al.length; j++) if (al[j] && hay.indexOf(al[j]) !== -1) return al[j]; return ''; };
      let tok = '';
      if ((tok = has(l.t))) { out.s += 26; out.fields.push('标题别名 ' + tok); out.tier = 4; }
      else if ((tok = has(l.h))) { out.s += 18; out.fields.push('小节别名 ' + tok); out.tier = Math.max(out.tier, 3); }
      else if ((tok = has(l.m))) { out.s += 10; out.fields.push('摘要/标签别名 ' + tok); out.tier = Math.max(out.tier, 2); }
      else {
        for (let bi = 0; bi < al.length; bi++) {
          if (al[bi] && bodyIndexOf(l, al[bi]) !== -1) { out.s += 2; out.body = true; out.fields.push('正文'); out.tier = Math.max(out.tier, 1); break; }
        }
      }
    }
    return out;
  }
  function partScore(e, part) {
    const r = directScore(e, part);
    if (r.s > 0) return r;
    const al = ALIASES[part];
    if (al && al.length) {
      const l = lc(e);
      const hit = (hay) => { for (let i = 0; i < al.length; i++) if (hay.indexOf(al[i]) !== -1) return al[i]; return ''; };
      let tok = '';
      if ((tok = hit(l.t))) return { s: 26, fields: ['标题别名 ' + tok], body: false, tier: 4 };
      if ((tok = hit(l.h))) return { s: 18, fields: ['小节别名 ' + tok], body: false, tier: 3 };
      if ((tok = hit(l.m))) return { s: 10, fields: ['摘要/标签别名 ' + tok], body: false, tier: 2 };
      for (let bi = 0; bi < al.length; bi++) if (al[bi] && bodyIndexOf(l, al[bi]) !== -1) return { s: 2, fields: ['正文'], body: true, tier: 1 };
    }
    return { s: 0, fields: [], body: false, tier: 0 };
  }
  function bigrams(q) { const g = []; for (let i = 0; i + 1 < q.length; i++) g.push(q.substr(i, 2)); return g; }
  function termScore(e, q) {
    const r = directScore(e, q);
    if (r.s > 0) return { s: r.s, tier: r.tier, body: r.body };
    const ph = PHRASE_BY_Q[q];
    if (ph) {
      let total = 0, tier = 0, body = false;
      for (let p = 0; p < ph.parts.length; p++) {
        const pr = partScore(e, ph.parts[p]);
        if (!pr.s) { total = 0; break; }
        total += pr.s; tier = Math.max(tier, pr.tier || 0); if (pr.body) body = true;
      }
      if (total > 0) return { s: Math.round(total * 0.6), tier, body };
    }
    if (q.length >= 3 && CJK.test(q)) {
      const gs = bigrams(q);
      let total = 0, tier = 0;
      for (let i = 0; i < gs.length; i++) {
        const gr = directScore(e, gs[i]);
        if (gr.s <= 0) return { s: 0, tier: 0, body: false };
        total += gr.s; tier = Math.max(tier, gr.tier || 0);
      }
      if (total > 0) return { s: Math.round(total * 0.45), tier, body: true };
    }
    return { s: 0, tier: 0, body: false };
  }
  function score(e, terms) {
    let total = 0, tier = 0;
    for (let i = 0; i < terms.length; i++) {
      const r = termScore(e, terms[i]);
      if (!r.s) return null;
      total += r.s; tier = Math.max(tier, r.tier || 0);
    }
    return { s: total, tier };
  }
  function compareHits(a, b) {
    if (b.s !== a.s) return b.s - a.s;
    if ((b.tier || 0) !== (a.tier || 0)) return (b.tier || 0) - (a.tier || 0);
    const ao = typeof a.e.o === 'number' ? a.e.o : 1e9;
    const bo = typeof b.e.o === 'number' ? b.e.o : 1e9;
    if (ao !== bo) return ao - bo;
    const at = String(a.e.t || ''), bt = String(b.e.t || '');
    if (at.length !== bt.length) return at.length - bt.length;
    const c = zh(at, bt);
    if (c !== 0) return c;
    return zh(String(a.e.id || ''), String(b.e.id || ''));
  }
  return {
    MAX_RESULTS,
    rank(q) {
      const query = String(q).trim().toLowerCase();
      const terms = query.split(/\s+/).filter(Boolean);
      const hits = [];
      for (const e of (index.pages || [])) { const r = score(e, terms); if (r && r.s > 0) hits.push({ e, s: r.s, tier: r.tier }); }
      hits.sort(compareHits);
      return {
        total: hits.length,
        shown: hits.slice(0, MAX_RESULTS).map((h) => ({ p: h.e.p, t: h.e.t, s: h.s, tier: h.tier, o: h.e.o })),
      };
    },
  };
}

async function triggerSearch(page) {
  try { await page.click('[data-open-search]', { timeout: 2500 }); return 'click'; }
  catch (e) {
    try { await page.click('[data-open-search]', { force: true, timeout: 2500 }); return 'click:force'; }
    catch (e2) { await page.keyboard.press('Control+k'); return 'ctrl+k'; }
  }
}
async function querySearch(page, q) {
  await page.fill('#search-input', '').catch(() => {});
  await page.fill('#search-input', q);
  let last = -2, stable = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(120);
    const s = await page.evaluate(() => ({
      n: document.querySelectorAll('#search-results li a[href]').length,
      c: (document.querySelector('#search-count') || {}).textContent || '',
    }));
    if (s.n === last && String(s.c).trim() !== '') { stable++; if (stable >= 3) break; } else stable = 0;
    last = s.n;
  }
  return page.evaluate(READ_RESULTS);
}
const QUERIES = ['权限', '配置文件', '命令', '插件加载', 'pdc'];

/**
 * 页面 href 是 `libraryRoot() + e.p`：深页里 site.js 的 src 是 `../../../assets/site.js`，
 * 所以 root = `../../../`，raw href 带相对前缀。离线复算给的是 index 里的 `p`（站根相对）。
 * 逐条比对前剥掉前导 `../`（与 tools/verify-mobile.js 的 normalized() 同口径）。
 */
const normHref = (h) => String(h === undefined || h === null ? '' : h).replace(/^(\.\.\/)+/, '');

async function probeSearchInstance(browser, base, indexFile, label) {
  const VP = { name: '390x844', w: 390, h: 844 };
  const out = { base: label, queries: [], cdp: {}, perf: {} };
  let index = null;
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); out.indexEntries = (index.pages || []).length; } catch (e) { out.indexError = String(e.message); }
  await withCtx(browser, VP, async (page, ctx) => {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    const cdpUrls = [];
    cdp.on('Network.requestWillBeSent', (e) => cdpUrls.push(e.request.url));
    await go(page, base + '/paper/dev/pdc/', 500);
    const perfA = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
    const cdpA = cdpUrls.slice();
    const idxAtRest = await page.evaluate(() => !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages && window.__LIBRARY_SEARCH__.pages.length));
    const scriptSrcs = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')));
    out.cdp.before = cdpA.filter((u) => /search-index/.test(u));
    out.cdp.beforeAll = cdpA.map((u) => String(u).split('/').pop());
    out.perf.before = perfA.filter((u) => /search-index/.test(u));
    out.perf.beforeAll = perfA.map((u) => String(u).split('/').pop());
    out.indexAtRest = idxAtRest;
    out.scriptSrcs = scriptSrcs;
    const strat = await triggerSearch(page);
    out.openStrategy = strat;
    await page.waitForFunction(() => !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages && window.__LIBRARY_SEARCH__.pages.length), { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(400);
    const cdpB = cdpUrls.slice();
    const perfB = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
    out.cdp.after = cdpB.filter((u) => /search-index/.test(u));
    out.perf.after = perfB.filter((u) => /search-index/.test(u));
    out.indexAfterTrigger = await page.evaluate(() => !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages));
    for (const q of QUERIES) {
      const r = await querySearch(page, q);
      const rec = {
        q, count: r.count, countText: r.countText,
        hrefs: r.items.map((i) => i.href),
        titles: r.items.map((i) => i.title),
      };
      if (index) {
        try {
          const off = mkRanker(index).rank(q);
          rec.offlineTotal = off.total;
          rec.offlineShown = off.shown.length;
          rec.offlineHrefs = off.shown.map((h) => h.p);
          rec.hrefsNorm = rec.hrefs.map(normHref);
          rec.offlineHrefsNorm = rec.offlineHrefs.map(normHref);
          rec.hrefPrefix = rec.hrefs.length ? String(rec.hrefs[0]).replace(/[^/]*$/, '') : null;
          rec.libRoot = rec.hrefs.length ? String(rec.hrefs[0]).slice(0, String(rec.hrefs[0]).length - String(rec.offlineHrefs[0]).length) : null;
          rec.firstDiffRaw = rec.hrefs.findIndex((h, i) => h !== rec.offlineHrefs[i]);
          rec.firstDiff = rec.hrefsNorm.findIndex((h, i) => h !== rec.offlineHrefsNorm[i]);
          rec.offlineMatch = JSON.stringify(rec.hrefsNorm) === JSON.stringify(rec.offlineHrefsNorm);
          rec.rawFirstDiff = rec.firstDiffRaw;
          rec.offlineExpectedCountText = off.total > 40 ? ('显示前 40 / 共 ' + off.total + ' 个结果') : (off.total + ' 个结果');
          rec.countTextMatch = rec.countText === rec.offlineExpectedCountText;
          rec.offlineTop3 = off.shown.slice(0, 3);
        } catch (e) { rec.offlineError = String(e.message).slice(0, 200); }
      }
      out.queries.push(rec);
    }
  });
  return out;
}

/* ── 6：无障碍 ── */
async function check6(browser, base, label) {
  const out = { base: label };
  const VP = { name: '390x844', w: 390, h: 844 };
  // (a) prefers-reduced-motion
  await withCtx(browser, VP, async (page) => {
    await go(page, base + '/paper/dev/pdc/', 400);
    out.reduced = await page.evaluate(() => {
      const g = (el) => (el ? getComputedStyle(el) : null);
      const de = document.documentElement;
      const side = document.getElementById('sidebar');
      const scrim = document.getElementById('nav-scrim');
      const skip = document.querySelector('.skip');
      const dur = (el) => { const c = g(el); return c ? { duration: c.transitionDuration, property: c.transitionProperty } : null; };
      return {
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        scrollBehavior: getComputedStyle(de).scrollBehavior,
        sidebar: dur(side), scrim: dur(scrim), skip: dur(skip),
      };
    });
  }, { reducedMotion: 'reduce' });
  // (b) :focus-visible outline（键盘 Tab）
  await withCtx(browser, VP, async (page) => {
    await go(page, base + '/paper/dev/pdc/', 400);
    const steps = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(70);
      steps.push(await page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return null;
        const cs = getComputedStyle(a), r = a.getBoundingClientRect();
        return {
          tag: a.tagName.toLowerCase(), id: a.id || '', cls: String(a.className || '').trim().split(/\s+/).slice(0, 2).join('.'),
          outlineWidth: parseFloat(cs.outlineWidth) || 0, outlineStyle: cs.outlineStyle,
          visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
        };
      }));
    }
    out.focus = steps;
  });
  // (c) 320px 无双向滚动 + 无裁剪祖先撑宽元素
  const PAGES = ['/', '/paper/', '/paper/dev/pdc/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/all-pages.html'];
  out.reflow = [];
  await withCtx(browser, { name: '320x568', w: 320, h: 568 }, async (page) => {
    for (const p of PAGES) {
      await go(page, base + p, 300);
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const clip = (el) => { let q = el.parentElement; while (q && q !== document.body) { const cs = getComputedStyle(q); if (['auto', 'scroll', 'hidden', 'clip'].indexOf(cs.overflowX) !== -1) return q; if (cs.position === 'fixed') return q; q = q.parentElement; } return null; };
        const off = [];
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed') continue;
          if (cs.position === 'absolute' && cs.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right <= de.clientWidth + 1) continue;
          if (clip(el)) continue;
          off.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 40), right: Math.round(r.right) });
        }
        return {
          overflowX: de.scrollWidth - de.clientWidth,
          scrollH: de.scrollHeight, clientH: de.clientHeight,
          verticalScrollable: de.scrollHeight > de.clientHeight + 1,
          offenders: off.sort((a, b) => b.right - a.right).slice(0, 5), offenderCount: off.length,
          bodyOverflowX: getComputedStyle(document.body).overflowX, htmlOverflowX: getComputedStyle(de).overflowX,
        };
      });
      out.reflow.push(Object.assign({ page: p }, m));
    }
  });
  return out;
}
function judge6(after, before) {
  const J = {};
  const durs = (o) => [o.sidebar, o.scrim, o.skip].filter(Boolean);
  const allZero = (o) => durs(o).every((d) => d.duration.split(',').map((s) => parseFloat(s.trim())).every((n) => n === 0));
  J['A11Y-1 reduced-motion: scroll-behavior=auto 且过渡 0s'] = {
    after: { scrollBehavior: after.reduced.scrollBehavior, durations: durs(after.reduced).map((d) => d.duration), matches: after.reduced.matches },
    before: before ? { scrollBehavior: before.reduced.scrollBehavior, durations: durs(before.reduced).map((d) => d.duration) } : null,
    pass: after.reduced.matches === true && after.reduced.scrollBehavior === 'auto' && allZero(after.reduced),
  };
  const vis = (after.focus || []).filter((s) => s && s.visible);
  const bad = vis.filter((s) => !(s.outlineWidth > 0) || s.outlineStyle === 'none');
  J['A11Y-2 Tab 后可见焦点元素 outlineWidth>0'] = {
    after: { steps: vis.map((s) => `${s.tag}${s.id ? '#' + s.id : ''} outline=${s.outlineWidth}px/${s.outlineStyle}`), bad: bad.length, presses: (after.focus || []).length },
    before: before ? { steps: (before.focus || []).filter((s) => s && s.visible).map((s) => `${s.tag}${s.id ? '#' + s.id : ''} outline=${s.outlineWidth}px/${s.outlineStyle}`) } : null,
    pass: (after.focus || []).length === 6 && bad.length === 0,
  };
  J['A11Y-3 320px documentElement 无双向滚动（overflowX<=1）'] = {
    after: after.reflow.map((r) => ({ page: r.page, overflowX: r.overflowX, offenders: r.offenderCount })),
    before: before ? before.reflow.map((r) => ({ page: r.page, overflowX: r.overflowX })) : null,
    pass: after.reflow.every((r) => r.overflowX <= 1),
  };
  const failed = Object.keys(J).filter((k) => !J[k].pass);
  return { J, failed };
}

/* ───────────────────────── 主流程 ───────────────────────── */

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome/chromium found'); process.exit(1); }
  const t0 = Date.now();
  const report = {
    generated_at: new Date().toISOString(),
    generator: 'tools/verify-mobile-b.js',
    agent: 'verify-B',
    targets: { after: TARGET, before: PRE },
    browser: exe,
    check1: null, check2: null, check3: null, check4: null, check5: null, check6: null,
    summary: {},
  };
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const failAll = [];
  try {
    if (want(1)) {
      console.log('[1/6] B 抽屉 390×844 / 320×568 ...');
      const a = await check1(browser, TARGET, 'after');
      const b = await check1(browser, PRE, 'before');
      const ja = judge1(a, b), jb = judge1(b, null);
      report.check1 = { name: 'B 抽屉交互（390×844 / 320×568）', after: a, before: b, judge: ja, judgeBefore: jb };
      ja.failed.forEach((f) => failAll.push('B抽屉 / ' + f));
      console.log('      -> after ' + (ja.failed.length ? 'FAIL ' + ja.failed.join(' | ') : 'PASS') + ' ; before ' + (jb.failed.length ? 'FAIL ' + jb.failed.length + ' 项' : 'PASS'));
    }
    if (want(2)) {
      console.log('[2/6] B 桌面侧 1024 / 1280 ...');
      const a = await check2(browser, TARGET, 'after');
      const b = await check2(browser, PRE, 'before');
      const ja = judge2(a, b), jb = judge2(b, null);
      report.check2 = { name: 'B 桌面侧（1024×768 / 1280×800）', after: a, before: b, judge: ja, judgeBefore: jb };
      ja.failed.forEach((f) => failAll.push('B桌面 / ' + f));
      console.log('      -> after ' + (ja.failed.length ? 'FAIL ' + ja.failed.join(' | ') : 'PASS') + ' ; before ' + (jb.failed.length ? 'FAIL ' + jb.failed.length + ' 项' : 'PASS'));
    }
    if (want(3)) {
      console.log('[3/6] C1 输入框字号 ...');
      const a = await check3(browser, TARGET, 'after');
      const b = await check3(browser, PRE, 'before');
      const ja = judge3(a, b);
      report.check3 = { name: 'C1 所有可见输入框 fontSize >= 16', after: a, before: b, judge: ja };
      ja.failed.forEach((f) => failAll.push('C1 / ' + f));
      console.log('      -> ' + (ja.failed.length ? 'FAIL ' + ja.failed.join(' | ') : 'PASS (' + ja.rows.length + ' 个可见输入框)'));
    }
    if (want(4)) {
      console.log('[4/6] C2 顶栏触控 + 自证 ...');
      const a = await check4(browser, TARGET, 'after');
      const b = await check4(browser, PRE, 'before');
      const ja = judge4(a, b);
      report.check4 = { name: 'C2 顶栏控件 >=44×44 + scrollWidth==clientWidth + 高度<=56', after: a, before: b, judge: ja };
      ja.failed.forEach((f) => failAll.push('C2 / ' + f));
      console.log('      -> ' + (ja.failed.length ? 'FAIL ' + ja.failed.join(' | ') : 'PASS'));
    }
    if (want(5)) {
      console.log('[5/6] F1 搜索索引懒加载 ...');
      const a = await probeSearchInstance(browser, TARGET, path.join(REPO, 'search-index.json'), 'after');
      const b = await probeSearchInstance(browser, PRE, path.join(PRE_REPO, 'search-index.json'), 'before');
      const cross = [];
      for (const qa of a.queries) {
        const qb = (b.queries || []).find((x) => x.q === qa.q);
        if (!qb) { cross.push({ q: qa.q, missingPre: true }); continue; }
        const an = qa.hrefsNorm || qa.hrefs, bn = qb.hrefsNorm || qb.hrefs;
        cross.push({
          q: qa.q,
          afterCount: qa.count, beforeCount: qb.count,
          afterTotal: qa.offlineTotal, beforeTotal: qb.offlineTotal,
          firstDiff: an.findIndex((h, i) => h !== bn[i]),
          firstDiffRaw: (qa.hrefs || []).findIndex((h, i) => h !== (qb.hrefs || [])[i]),
          same: JSON.stringify(an) === JSON.stringify(bn),
          afterLen: an.length, beforeLen: bn.length,
          afterPrefix: qa.libRoot, beforePrefix: qb.libRoot,
        });
      }
      const fails = [];
      if (a.cdp.before.length || a.perf.before.length) fails.push('首屏出现 search-index 请求：CDP ' + JSON.stringify(a.cdp.before) + ' / perf ' + JSON.stringify(a.perf.before));
      if (!a.cdp.after.length && !a.perf.after.length && !a.indexAfterTrigger) fails.push('触发搜索后索引仍未加载（懒加载未生效）');
      for (const q of a.queries) {
        if (q.offlineError) { fails.push(q.q + ' 离线复算异常 ' + q.offlineError); continue; }
        if (!q.offlineMatch) fails.push('q=' + q.q + ' 命中集/排序与离线复算不一致：UI ' + q.count + ' vs 离线 ' + q.offlineShown + '，firstDiff=' + q.firstDiff + '（raw firstDiff=' + q.rawFirstDiff + '，href 前缀 ' + JSON.stringify(q.libRoot) + '，总数 ' + q.offlineTotal + '）');
        if (!q.countTextMatch) fails.push('q=' + q.q + ' 计数文案不符：UI「' + q.countText + '」vs 期望「' + q.offlineExpectedCountText + '」');
      }
      for (const c of cross) {
        if (c.missingPre) { fails.push('q=' + c.q + ' 改前实例无读数'); continue; }
        if (c.firstDiff !== -1) fails.push('q=' + c.q + ' 改前/改后 UI 逐条不一致 firstDiff=' + c.firstDiff + '（改后 ' + c.afterLen + ' / 改前 ' + c.beforeLen + '）');
      }
      report.check5 = { name: 'F1 搜索索引懒加载 + 命中集/排序（离线复算 + 改前/改后 UI）', after: a, before: b, cross, failures: fails };
      fails.forEach((f) => failAll.push('F1 / ' + f));
      console.log('      -> ' + (fails.length ? 'FAIL ' + fails.join(' | ') : 'PASS（首屏 CDP/perf 均 0 次 search-index 请求；' + a.queries.map((q) => q.q + '=' + q.offlineTotal).join(' ') + '）'));
    }
    if (want(6)) {
      console.log('[6/6] A11Y 三项 ...');
      const a = await check6(browser, TARGET, 'after');
      const b = await check6(browser, PRE, 'before');
      const ja = judge6(a, b), jb = judge6(b, null);
      report.check6 = { name: '无障碍：reduced-motion / focus-visible / 320px 回流', after: a, before: b, judge: ja, judgeBefore: jb };
      ja.failed.forEach((f) => failAll.push('A11Y / ' + f));
      console.log('      -> after ' + (ja.failed.length ? 'FAIL ' + ja.failed.join(' | ') : 'PASS') + ' ; before ' + (jb.failed.length ? 'FAIL ' + jb.failed.length + ' 项' : 'PASS'));
    }
  } finally {
    await browser.close().catch(() => {});
  }
  report.summary = {
    failures: failAll,
    verdict: failAll.length === 0 ? 'pass' : 'fail',
    elapsed_ms: Date.now() - t0,
  };
  fs.mkdirSync(path.dirname(path.resolve(REPO, OUT)), { recursive: true });
  fs.writeFileSync(path.resolve(REPO, OUT), JSON.stringify(report, null, 2), 'utf8');
  console.log('\n==== 汇总：' + (failAll.length === 0 ? '6/6 PASS' : failAll.length + ' 项失败') + ' =====');
  failAll.forEach((f) => console.log('  FAIL ' + f));
  console.log('wrote ' + OUT + '  (' + (Date.now() - t0) + ' ms)');
  if (PRINT_JSON) console.log(JSON.stringify(report, null, 2));
  if (failAll.length) process.exitCode = 1;
})();
