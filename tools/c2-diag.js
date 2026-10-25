'use strict';
/**
 * c2-diag.js — 两处需要归因的实测（只读，不写仓库）
 *
 * ① 左边缘判据：max-width 只压右边界 ⇒ 正确判据应是
 *    (a) 同一父容器内，被限宽段落的左边缘唯一；
 *    (b) 逐段左边缘位移 = 0（改前 vs 改后同索引）。
 *    `uniqLeftClamped=4` 这种多档是 li>ul>li>p 的缩进层级，改前就存在。
 *
 * ② particles 页高 −1015：怀疑正文里的 <img> 落在 <p> 内，
 *    p 被限到 640 后 img{max-width:100%} 跟着缩，图片变矮 ⇒ 页高反降。
 *    逐图量 natural/rendered 宽高与祖先链，给出归因。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:8787';
const CSS_B2 = '.article p{max-width:40rem}';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const LEFT_FN = () => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const art = document.querySelector('article.article') || document.querySelector('article');
  if (!art) return null;
  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = [...art.querySelectorAll('p')].filter(isProse);
  const byParent = [];
  const seen = new Map();
  const direct = [];
  for (const p of paras) {
    const st = getComputedStyle(p);
    const b = p.getBoundingClientRect();
    const clamped = st.maxWidth !== 'none' && Math.abs(b.width - parseFloat(st.maxWidth)) < 0.75;
    if (!clamped) continue;
    const par = p.parentElement;
    const tag = par.tagName.toLowerCase() + (par.className ? '.' + String(par.className).trim().split(/\s+/).join('.') : '');
    if (!seen.has(par)) { seen.set(par, { parent: tag, lefts: [] }); byParent.push(seen.get(par)); }
    seen.get(par).lefts.push(r2(b.left));
    if (par === art) direct.push(r2(b.left));
  }
  return {
    clampedTotal: byParent.reduce((s, g) => s + g.lefts.length, 0),
    groups: byParent.map((g) => ({ parent: g.parent, n: g.lefts.length, uniq: [...new Set(g.lefts)], uniqCount: new Set(g.lefts).size })),
    uniqPerParentMax: byParent.length ? Math.max(...byParent.map((g) => new Set(g.lefts).size)) : 0,
    directUniq: new Set(direct).size,
    directN: direct.length,
    worstStep: (() => {
      /* 同一父容器内所有段落左边缘的极差（就该是 0） */
      let mx = 0;
      for (const g of byParent) if (g.lefts.length > 1) mx = Math.max(mx, Math.max(...g.lefts) - Math.min(...g.lefts));
      return r2(mx);
    })(),
  };
};

const IMG_FN = () => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const art = document.querySelector('article.article') || document.querySelector('article');
  const imgs = [...document.querySelectorAll('img')].filter((i) => i.src && i.getBoundingClientRect().width > 0);
  return imgs.map((im) => {
    const b = im.getBoundingClientRect();
    const chain = [];
    let e = im.parentElement;
    while (e && e !== art) { chain.push(e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().split(/\s+/)[0] : '')); e = e.parentElement; }
    return {
      cls: im.className || '(none)',
      inP: !!im.closest('p'),
      chain: chain.slice(0, 4).join(' < '),
      natW: im.naturalWidth, natH: im.naturalHeight,
      renW: r2(b.width), renH: r2(b.height),
    };
  });
};

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--disable-lcd-text', '--hide-scrollbars', '--disable-gpu'] });
  const out = {};

  /* ---- ① 左边缘 ---- */
  out.left = {};
  for (const [vp, pg, pth] of [[1440, 'dialogs', '/paper/dev/dialogs/'], [1440, 'worldcfg', '/paper/reference/world-configuration/'], [1440, 'particles', '/paper/dev/particles/'], [1440, 'tuning', '/velocity/tuning/']]) {
    const ctx = await browser.newContext({ viewport: { width: vp, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + pth, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    const before = await page.evaluate(LEFT_FN);
    await page.addStyleTag({ content: CSS_B2 });
    await page.waitForTimeout(100);
    const after = await page.evaluate(LEFT_FN);
    out.left[vp + '/' + pg] = { before, after };
    await ctx.close();
  }

  /* ---- ② particles / dialogs 图片 ---- */
  out.imgs = {};
  for (const [vp, pg, pth] of [[1440, 'particles', '/paper/dev/particles/'], [1440, 'dialogs', '/paper/dev/dialogs/']]) {
    const ctx = await browser.newContext({ viewport: { width: vp, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + pth, { waitUntil: 'load' });
    await page.evaluate(async () => {
      for (const im of [...document.images]) { im.loading = 'eager'; try { await im.decode(); } catch (e) {} }
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 200));
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.waitForTimeout(300);
    const before = await page.evaluate(IMG_FN);
    const hBefore = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.addStyleTag({ content: CSS_B2 });
    await page.waitForTimeout(200);
    const after = await page.evaluate(IMG_FN);
    const hAfter = await page.evaluate(() => document.documentElement.scrollHeight);
    /* 图片总高（页面里图片占的高度） */
    const sumH = (arr) => Math.round(arr.reduce((s, i) => s + i.renH, 0) * 100) / 100;
    out.imgs[vp + '/' + pg] = {
      pageHeight: [hBefore, hAfter],
      imgCount: [before.length, after.length],
      imgSumRenH: [sumH(before), sumH(after)],
      imgSumRenW: [Math.round(before.reduce((s, i) => s + i.renW, 0) * 100) / 100, Math.round(after.reduce((s, i) => s + i.renW, 0) * 100) / 100],
      inP: [before.filter((i) => i.inP).length, after.filter((i) => i.inP).length],
      items: before.map((b, i) => ({ ...b, renW_after: after[i] ? after[i].renW : null, renH_after: after[i] ? after[i].renH : null })),
    };
    await ctx.close();
  }

  await browser.close();
  const OUTF = path.join(ROOT, 'reports', '.c2-diag.json');
  fs.writeFileSync(OUTF, JSON.stringify(out, null, 1), 'utf8');

  console.log('=== ① 左边缘（被限宽段落按父容器分组） ===');
  for (const [k, v] of Object.entries(out.left)) {
    const a = v.after, b = v.before;
    console.log(k + '  改前: clamped=' + b.clampedTotal + ' 组=' + b.groups.length + ' 组内最多档=' + b.uniqPerParentMax + ' 极差=' + b.worstStep);
    console.log('      改后: clamped=' + a.clampedTotal + ' 组=' + a.groups.length + ' 组内最多档=' + a.uniqPerParentMax + ' 极差=' + a.worstStep + '  直接子段=' + a.directN + ' 档=' + a.directUniq);
    for (const g of a.groups) console.log('        [' + g.n + '] ' + g.parent + '  uniq=' + g.uniqCount + '  left=' + g.uniq.join(','));
  }

  console.log('\n=== ② 图片几何 ===');
  for (const [k, v] of Object.entries(out.imgs)) {
    console.log(k + '  pageH ' + v.pageHeight[0] + '→' + v.pageHeight[1] + ' (Δ' + (v.pageHeight[1] - v.pageHeight[0]) + ')');
    console.log('   img n=' + v.imgCount[0] + '  inP=' + v.inP[0] + '→' + v.inP[1] + '  ΣренH ' + v.imgSumRenH[0] + '→' + v.imgSumRenH[1] + '  ΣrenW ' + v.imgSumRenW[0] + '→' + v.imgSumRenW[1]);
    for (const it of v.items) {
      const flag = it.renW_after != null && Math.abs(it.renW_after - it.renW) > 0.5 ? '  ⚠ 宽变 ' + it.renW + '→' + it.renW_after : '';
      console.log('     ' + it.cls.padEnd(16) + ' inP=' + (it.inP ? 'Y' : 'N') + ' nat=' + it.natW + 'x' + it.natH + ' ren=' + it.renW + 'x' + it.renH + ' | ' + it.chain + flag);
    }
  }
  console.log('\nJSON: ' + OUTF);
}

main().catch((e) => { console.error(e); process.exit(1); });
