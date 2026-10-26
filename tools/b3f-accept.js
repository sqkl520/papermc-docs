'use strict';
/**
 * b3f-accept.js — 批 3 最终验收（一次性跑齐全部验收口径，产出可引用的数字）。
 *
 * 验收项（与 ups-plan §7 批 3「验收」逐条对应）：
 *   1. 单页 1440 字号级数 ≤14（严格口径 + 宽松口径并列，两个都必须达标）
 *   2. h1–h4 实际 px（390 与 1440 两档，验证 800 断点上移）
 *   3. 标题对比度（h1/h2 相对 body 背景；目标 h1 2.13×@移动 / 2.50×@≥800）
 *   4. 截断数 = 0（.grp-name 实际可见 + .grp-zh 反事实强制显示）
 *   5. overflow = 0（320/360/390/414 × 10 页）
 *   6. 390 H1 不换行（getClientRects().length === 1）
 *   7. 输入框字号未变（verify-mobile C1 口径：可见 input 的 computed font-size）
 *   8. 顶栏高度未变（C2 口径：≤56px @390）
 *   9. 顶栏内部字号未令牌化（.brand-name / .tbtn 的值与改前一致）
 *
 * 用法：node tools/b3f-accept.js --tag=final
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PAGES10 = [
  'index.html', 'paper/index.html',
  'paper/dev/command-api/basics/introduction/index.html',
  'paper/reference/world-configuration/index.html',
  'velocity/tuning/index.html', 'folia/reference/region-logic/index.html',
  'all-pages.html', 'snapshots.html', 'sections/paper.html',
  'categories/paper-dev-command.html',
];
const VP_MOBILE = [
  { name: '320x568', w: 320, h: 568 }, { name: '360x640', w: 360, h: 640 },
  { name: '390x844', w: 390, h: 844 }, { name: '414x896', w: 414, h: 896 },
];
const VP_DESK = { name: '1440x900', w: 1440, h: 900 };
const VP_800 = { name: '800x900', w: 800, h: 900 };

const PROBE = () => {
  const cs = getComputedStyle;
  const inSvg = (el) => !!(el.closest && el.closest('svg'));
  const hasText = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; return false; };
  const strictVis = (el) => {
    const c = cs(el);
    if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.getClientRects().length > 0;
  };
  const looseVis = (el) => {
    const c = cs(el);
    if (c.display === 'none' || c.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  };
  const strict = new Set(); const loose = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (inSvg(el) || !hasText(el)) continue;
    const px = parseFloat(cs(el).fontSize);
    if (!(px > 0)) continue;
    if (looseVis(el)) loose.add(px);
    if (strictVis(el)) strict.add(px);
  }
  const fsz = (sel) => { const e = document.querySelector(sel); return e ? +parseFloat(cs(e).fontSize).toFixed(4) : null; };
  const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
  /* h1 行数 */
  const h1 = document.querySelector('.article h1') || document.querySelector('.hero h1') || document.querySelector('h1');
  let h1lines = null; let h1px = null;
  if (h1) {
    const c = cs(h1);
    h1px = +parseFloat(c.fontSize).toFixed(4);
    const lh = parseFloat(c.lineHeight) || 0;
    const r = h1.getBoundingClientRect();
    const pad = (parseFloat(c.paddingTop) || 0) + (parseFloat(c.paddingBottom) || 0);
    h1lines = lh > 0 ? Math.max(1, Math.round((r.height - pad) / lh)) : null;
    /* 更硬的判据：Range 的 client rects 数（跨行会 >1） */
    const range = document.createRange();
    range.selectNodeContents(h1);
    h1lines = Math.max(h1lines || 1, range.getClientRects().length);
  }
  /* 输入框字号（C1 口径） */
  const inputs = [...document.querySelectorAll('input')].filter((i) => {
    const c = cs(i); const r = i.getBoundingClientRect();
    return c.display !== 'none' && c.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }).map((i) => (i.className || i.id || i.type) + ':' + cs(i).fontSize);
  /* 顶栏 */
  const tb = document.querySelector('.topbar');
  const tbH = tb ? +tb.getBoundingClientRect().height.toFixed(2) : null;
  /* 对比度 */
  const parseC = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const b = parseC(cs(n).backgroundColor);
      if (b && b.a > 0.95) return b;
      n = n.parentElement;
    }
    const b = parseC(cs(document.body).backgroundColor);
    return (b && b.a > 0.95) ? b : { r: 255, g: 255, b: 255, a: 1 };
  };
  const contrastOf = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const fg = parseC(cs(e).color); const bg = bgOf(e);
    const L1 = lum(fg); const L2 = lum(bg);
    return +(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05))).toFixed(2);
  };
  const ratio = (sel) => { const a = fsz(sel); return a === null ? null : +(a / 16).toFixed(2); };
  return {
    strict: [...strict].sort((a, b) => a - b),
    loose: [...loose].sort((a, b) => a - b),
    headings: {
      h1: fsz('.article h1') || fsz('.hero h1'), h2: fsz('.article h2'),
      h3: fsz('.article h3'), h4: fsz('.article h4'),
      sectionH2: fsz('.section-head h2'), pageHeadH1: fsz('.page-head h1'),
    },
    h1lines, h1px,
    h1Ratio: +((fsz('.article h1') || fsz('.hero h1') || 0) / 16).toFixed(2),
    contrast: { h1: contrastOf('.article h1') || contrastOf('.hero h1'), h2: contrastOf('.article h2'), body: contrastOf('.article p') },
    inputs, topbarH: tbH,
    /* ⚠ 不能写 fsz('.tbtn')：querySelector 命中的第一个 .tbtn 是 .tbtn.sidebar-toggle
       （它自己用 1.05rem 覆盖，属 R9 冻结项、本来就 16.8px）。这里分开取：
       · tbtnTopbar = 顶栏内**第一个可见的、非 sidebar-toggle** 的 .tbtn → 应恒 13.12
       · sidebarToggle → 应恒 16.8（1.05rem，冻结） */
    brandName: fsz('.topbar .brand-name'),
    tbtnTopbar: (() => {
      const els = [...document.querySelectorAll('.topbar .tbtn')].filter((e) => !e.classList.contains('sidebar-toggle'));
      const vis = els.find((e) => e.getBoundingClientRect().height > 0);
      return vis ? +parseFloat(cs(vis).fontSize).toFixed(4) : null;
    })(),
    sidebarToggle: fsz('.topbar .tbtn.sidebar-toggle'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    trunc: {
      name: [...document.querySelectorAll('.sidebar .grp-name')].filter((e) => e.getClientRects().length > 0 && e.scrollWidth > e.clientWidth + 1).length,
      zhVisible: [...document.querySelectorAll('.sidebar .grp-zh')].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none').length,
    },
    grpZhFs: fsz('.sidebar .grp-zh'),
  };
};

/* 反事实：强制显示 .grp-zh 后的截断 */
const PROBE_ZH_CF = () => {
  const st = document.createElement('style');
  st.textContent = '.sidebar .grp-zh{display:inline !important}';
  document.head.appendChild(st);
  void document.body.offsetWidth;
  const bad = [...document.querySelectorAll('.sidebar .grp-zh')]
    .filter((e) => e.getClientRects().length > 0 && e.scrollWidth > e.clientWidth + 1).length;
  return bad;
};

(async () => {
  if (!EXE) throw new Error('找不到 chromium');
  const tag = arg('tag', 'final');
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const out = { tag, at: new Date().toISOString(), desk: [], vp800: [], mobile: [], overflow: [], zhcf: [] };
  const url = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');
  const open = async (rel, vp) => {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(url(rel), { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(180);
    return { ctx, page };
  };

  const DESK_PAGES = ['index.html', 'paper/dev/dialogs/index.html', 'paper/reference/world-configuration/index.html',
    'paper/dev/pdc/index.html', 'sections/paper.html', 'all-pages.html',
    'velocity/tuning/index.html', 'paper/dev/command-api/basics/introduction/index.html'];
  for (const rel of DESK_PAGES) {
    const { ctx, page } = await open(rel, VP_DESK);
    out.desk.push({ page: rel, ...(await page.evaluate(PROBE)) });
    await ctx.close();
  }
  /* 800 断点：验证上移在同一页生效 */
  for (const rel of ['paper/dev/dialogs/index.html']) {
    for (const vp of [{ name: '799x900', w: 799, h: 900 }, { name: '800x900', w: 800, h: 900 }]) {
      const { ctx, page } = await open(rel, vp);
      out.vp800.push({ page: rel, vp: vp.name, ...(await page.evaluate(PROBE)) });
      await ctx.close();
    }
  }
  /* 移动：390 h1 换行 + 截断 + 输入框 */
  for (const rel of ['index.html', 'paper/dev/dialogs/index.html', 'paper/reference/world-configuration/index.html']) {
    const { ctx, page } = await open(rel, { name: '390x844', w: 390, h: 844 });
    const m = await page.evaluate(PROBE);
    const cf = await page.evaluate(PROBE_ZH_CF);
    out.mobile.push({ page: rel, ...m });
    out.zhcf.push({ page: rel, vp: '390x844', zhTruncatedIfShown: cf });
    await ctx.close();
  }
  for (const rel of ['paper/dev/dialogs/index.html', 'paper/reference/world-configuration/index.html']) {
    const { ctx, page } = await open(rel, VP_DESK);
    const cf = await page.evaluate(PROBE_ZH_CF);
    out.zhcf.push({ page: rel, vp: '1440x900', zhTruncatedIfShown: cf });
    await ctx.close();
  }
  /* overflow 4 视口 × 10 页 */
  for (const vp of VP_MOBILE) {
    for (const rel of PAGES10) {
      const { ctx, page } = await open(rel, vp);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      out.overflow.push({ page: rel, vp: vp.name, overflow: o });
      await ctx.close();
    }
  }
  await browser.close();

  const f = path.join(os.tmpdir(), 'b3f-accept-' + tag + '.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 2), 'utf8');

  /* ---------- 打印验收 ---------- */
  const maxStrict = out.desk.reduce((a, r) => Math.max(a, r.strict.length), 0);
  const maxLoose = out.desk.reduce((a, r) => Math.max(a, r.loose.length), 0);
  console.log('\n════ 批 3 最终验收（' + tag + '）════');
  console.log('\n[1] 单页 1440 字号级数（目标 ≤14）');
  for (const r of out.desk) console.log('  ' + r.page.padEnd(50) + 'strict=' + String(r.strict.length).padStart(3) + '  loose=' + String(r.loose.length).padStart(3));
  console.log('  → 最大严格 ' + maxStrict + ' / 最大宽松 ' + maxLoose + ' → ' + (maxStrict <= 14 && maxLoose <= 14 ? '✓ 达标' : '✗ 未达标'));

  console.log('\n[2] 标题字号（390 / 800 断点两侧 / 1440）');
  const d0 = out.desk.find((r) => r.page === 'paper/dev/dialogs/index.html');
  const m0 = out.mobile.find((r) => r.page === 'paper/dev/dialogs/index.html');
  const b799 = out.vp800.find((r) => r.vp === '799x900');
  const b800 = out.vp800.find((r) => r.vp === '800x900');
  console.log('  ' + '档位'.padEnd(12) + 'h1'.padStart(7) + 'h2'.padStart(7) + 'h3'.padStart(7) + 'h4'.padStart(7) + 'h1/body'.padStart(9));
  const row = (label, r) => console.log('  ' + label.padEnd(12) + String(r.headings.h1).padStart(7) + String(r.headings.h2).padStart(7)
    + String(r.headings.h3).padStart(7) + String(r.headings.h4).padStart(7) + String(r.h1Ratio + '×').padStart(9));
  row('390', m0); row('799 (<800)', b799); row('800 (≥800)', b800); row('1440', d0);

  console.log('\n[3] 标题对比度（h1 目标 2.13×@移动 / 2.50×@≥800）');
  console.log('  390  h1=' + m0.contrast.h1 + '×  h2=' + m0.contrast.h2 + '×  body=' + m0.contrast.body + '×');
  console.log('  1440 h1=' + d0.contrast.h1 + '×  h2=' + d0.contrast.h2 + '×  body=' + d0.contrast.body + '×');

  console.log('\n[4] 390 h1 换行判定（必须 1 行）');
  for (const r of out.mobile) console.log('  ' + r.page.padEnd(50) + 'fs=' + String(r.h1px).padStart(6) + ' lines=' + r.h1lines + (r.h1lines === 1 ? ' ✓' : ' ✗ 换行了'));

  console.log('\n[5] 截断（目标 0）');
  const nm = out.desk.concat(out.mobile).reduce((a, r) => a + r.trunc.name, 0);
  const zc = out.zhcf.reduce((a, r) => a + r.zhTruncatedIfShown, 0);
  console.log('  .grp-name 实际可见截断 = ' + nm + (nm === 0 ? ' ✓' : ' ✗'));
  console.log('  .grp-zh 反事实（强制显示）截断 = ' + zc + (zc === 0 ? ' ✓（12.5px 也不会截断）' : ' ✗'));
  console.log('  .grp-zh 计算字号 = ' + d0.grpZhFs + 'px（§2.4 要求中文 ≥12.5）');
  console.log('  .grp-zh 可见实例数 = ' + d0.trunc.zhVisible + '（批 1 起 display:none）');

  console.log('\n[6] 横向溢出 4 视口 × 10 页（目标 0）');
  const bad = out.overflow.filter((r) => r.overflow > 1);
  console.log('  ' + (out.overflow.length - bad.length) + '/' + out.overflow.length + ' 组合 = 0' + (bad.length ? ' ✗' : ' ✓'));
  for (const b of bad) console.log('    ✗ ' + b.page + ' @' + b.vp + ' → ' + b.overflow);

  console.log('\n[7] 输入框字号（C1：不得改动）');
  const inputs = [...new Set(out.desk.concat(out.mobile).flatMap((r) => r.inputs))];
  console.log('  ' + (inputs.length ? inputs.join(' , ') : '（无可见输入框）'));

  console.log('\n[8] 顶栏（C2：高度 ≤56 @390；内部字号不得令牌化）');
  console.log('  .topbar 高 @390 = ' + m0.topbarH + 'px  @1440 = ' + d0.topbarH + 'px');
  console.log('  .brand-name = ' + d0.brandName + 'px（改前 16px，冻结）');
  console.log('  .topbar .tbtn（非 sidebar-toggle）= ' + d0.tbtnTopbar + 'px（改前 13.12px，冻结）');
  console.log('  .topbar .tbtn.sidebar-toggle = ' + d0.sidebarToggle + 'px（改前 16.8px = 1.05rem，冻结）');

  const pass = (maxStrict <= 14 && maxLoose <= 14 && m0.h1lines === 1 && nm === 0 && zc === 0
    && bad.length === 0 && inputs.every((i) => i.endsWith('16px')) && m0.topbarH <= 56
    && d0.brandName === 16 && Math.abs(d0.tbtnTopbar - 13.12) < 0.01
    && Math.abs(d0.sidebarToggle - 16.8) < 0.01);
  console.log('\n════ ' + (pass ? '全部验收项通过 ✓' : '有验收项未通过 ✗') + ' ════');
  console.log('JSON → ' + f);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
