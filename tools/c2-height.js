'use strict';
/**
 * c2-height.js — 页高归因（只读，不写仓库）
 *
 * 为什么必须单独归因：`.article p{max-width:40rem}` 不只压文字，也压 <p> 内的
 * `img.content-img`（CSS 是 `img{max-width:100%}`）—— 图变窄→按比例变矮→**页高下降**。
 * 于是「页高一律变大」这个预期在图片密集页（particles 18 张 1280×720）不成立。
 *
 * 本脚本做三件事：
 *  ① 三个口径的 pageHeight 前后差：
 *     loaded    —— 全部 lazy 图强制加载（真实用户看到的稳态）
 *     unloaded  —— 保持 loading=lazy、不滚到底（= 基线 Agent 的测量口径，图高≈0）
 *     noimg     —— 图片 display:none（纯文字回流，用来验证加法分解）
 *  ② 验证分解式：Δloaded ≈ Δnoimg + Δ(ΣimgHeight)
 *  ③ 逐图给出 缩放比 / 高度贡献
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

const PAGES = [
  ['dialogs', '/paper/dev/dialogs/'],
  ['worldcfg', '/paper/reference/world-configuration/'],
  ['particles', '/paper/dev/particles/'],
  ['tuning', '/velocity/tuning/'],
];
const VPS = [1440, 1280, 1024, 900, 768];

const loadAll = (page) => page.evaluate(async () => {
  for (const im of [...document.images]) { im.loading = 'eager'; try { await im.decode(); } catch (e) {} }
  window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 150));
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 150));
});

const H = (page) => page.evaluate(() => document.documentElement.scrollHeight);
const IMGS = (page) => page.evaluate(() => [...document.querySelectorAll('img.content-img')]
  .filter((i) => i.getBoundingClientRect().width > 0)
  .map((i) => ({
    inP: !!i.closest('p'),
    chain: (() => { const c = []; let e = i.parentElement; while (e && c.length < 3) { c.push(e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().split(/\s+/)[0] : '')); e = e.parentElement; } return c.join('<'); })(),
    natW: i.naturalWidth, natH: i.naturalHeight,
    w: Math.round(i.getBoundingClientRect().width * 100) / 100,
    h: Math.round(i.getBoundingClientRect().height * 100) / 100,
  })));

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--disable-lcd-text', '--hide-scrollbars', '--disable-gpu'] });
  const out = { loaded: {}, unloaded: {}, noimg: {}, imgs: {} };

  /* ---------- ① / ③ loaded 与 noimg ---------- */
  for (const vp of VPS) {
    for (const [pg, pth] of PAGES) {
      const k = vp + '/' + pg;
      const ctx = await browser.newContext({ viewport: { width: vp, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(BASE + pth, { waitUntil: 'load' });
      await page.waitForTimeout(150);
      await loadAll(page);

      const hL0 = await H(page);
      const i0 = await IMGS(page);
      const sumH = (arr) => Math.round(arr.reduce((s, x) => s + x.h, 0) * 100) / 100;

      /* noimg 改前 */
      await page.addStyleTag({ content: 'img.content-img{display:none!important}' });
      await page.waitForTimeout(80);
      const hN0 = await H(page);
      await page.evaluate(() => { const s = [...document.querySelectorAll('style')].pop(); if (s) s.remove(); });
      await page.waitForTimeout(80);

      /* 注入批 2 */
      await page.addStyleTag({ content: CSS_B2 });
      await page.waitForTimeout(120);
      const hL1 = await H(page);
      const i1 = await IMGS(page);
      const sumH1 = sumH(i1);

      /* noimg 改后 */
      await page.addStyleTag({ content: 'img.content-img{display:none!important}' });
      await page.waitForTimeout(80);
      const hN1 = await H(page);

      out.loaded[k] = { before: hL0, after: hL1, d: hL1 - hL0 };
      out.noimg[k] = { before: hN0, after: hN1, d: hN1 - hN0 };
      out.imgs[k] = { before: i0, after: i1, sumH0: sumH(i0), sumH1, dSumH: Math.round((sumH1 - sumH(i0)) * 100) / 100, inP: i0.filter((x) => x.inP).length };

      await ctx.close();
    }
  }

  /* ---------- ② 「图高=0」的决定性口径 ----------
     最初想用 page.route 拦图片请求，**实测不可靠**：Playwright 的 glob 不支持
     glob 花括号展开（png/jpg 写成一组），拦不到；且 loading=lazy 的图本来就可能没请求，
     「拦没拦住」与「加载没加载」混在一起，读数会抖动（实测 dialogs 两次差 456px）。
     改用 **确定性手法**：把 img 的 src 换成一个必然失败的 URL → naturalWidth=0 → 高度 0，
     与「懒加载尚未触发」的几何等价，且不依赖时序。 */
  for (const vp of [1440]) {
    for (const [pg, pth] of PAGES) {
      const k = vp + '/' + pg + '/nosrc';
      const ctx = await browser.newContext({ viewport: { width: vp, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(BASE + pth, { waitUntil: 'load' });
      await page.waitForTimeout(200);
      const h0 = await page.evaluate(async () => {
        for (const im of [...document.images]) { im.loading = 'eager'; im.src = 'data:,'; try { await im.decode(); } catch (e) {} }
        await new Promise((r) => setTimeout(r, 250));
        return [document.documentElement.scrollHeight, [...document.images].filter((i) => i.getBoundingClientRect().height > 0).length];
      });
      await page.addStyleTag({ content: CSS_B2 });
      await page.waitForTimeout(200);
      const h1 = await page.evaluate(() => document.documentElement.scrollHeight);
      out.unloaded[k] = { before: h0[0], after: h1, d: h1 - h0[0], imgsWithHeight: h0[1] };
      await ctx.close();
    }
  }

  /* ---------- ④ 变体对照：给「只含图片的 <p>」开豁免 ----------
     动机：particles 的页高下降完全来自 18 张 <p> 内的图被压窄 24.6%。
     若在意图片观感，可加一条 `.article p:has(> img.content-img){max-width:none}`
     （`>` 保证只豁免「图片是对齐首个子元素」的段落，不误伤图文混排）。
     代价与收益必须实测，不能凭直觉。 */
  out.variants = {};
  const VAR = {
    base: CSS_B2,
    exemptImgP: CSS_B2 + '\n.article p:has(> img.content-img){max-width:none}',
    onlyImgP: '.article p:not(:has(> img.content-img)){max-width:40rem}',
  };
  for (const vp of [1440]) {
    for (const [pg, pth] of PAGES) {
      for (const [vk, css] of Object.entries(VAR)) {
        const ctx = await browser.newContext({ viewport: { width: vp, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        const page = await ctx.newPage();
        await page.goto(BASE + pth, { waitUntil: 'load' });
        await page.waitForTimeout(150);
        await loadAll(page);
        const h0 = await page.evaluate(() => document.documentElement.scrollHeight);
        const w0 = await page.evaluate(() => {
          const art = document.querySelector('article.article');
          const ps = art ? [...art.querySelectorAll('p')].filter((p) => (p.textContent || '').trim().length >= 40) : [];
          let mx = 0;
          for (const p of ps) { const r = document.createRange(); r.selectNodeContents(p); for (const q of r.getClientRects()) if (q.width > mx) mx = q.width; }
          return Math.round(mx * 100) / 100;
        });
        await page.addStyleTag({ content: css });
        await page.waitForTimeout(180);
        const h1 = await page.evaluate(() => document.documentElement.scrollHeight);
        const w1 = await page.evaluate(() => {
          const art = document.querySelector('article.article');
          const ps = art ? [...art.querySelectorAll('p')].filter((p) => (p.textContent || '').trim().length >= 40) : [];
          let mx = 0;
          for (const p of ps) { const r = document.createRange(); r.selectNodeContents(p); for (const q of r.getClientRects()) if (q.width > mx) mx = q.width; }
          const im = [...document.querySelectorAll('img.content-img')].filter((i) => i.getBoundingClientRect().width > 0);
          return { lineW: Math.round(mx * 100) / 100, imgW: im.length ? Math.round(Math.max(...im.map((i) => i.getBoundingClientRect().width)) * 100) / 100 : null };
        });
        out.variants[vp + '/' + pg + '/' + vk] = { h0, h1, dH: h1 - h0, lineW0: w0, lineW1: w1.lineW, imgW1: w1.imgW };
        await ctx.close();
      }
    }
  }

  await browser.close();

  const F = path.join(ROOT, 'reports', '.c2-height.json');
  fs.writeFileSync(F, JSON.stringify(out, null, 1), 'utf8');

  console.log('=== 三种口径的 pageHeight 前后差 ===');
  console.log('cell'.padEnd(18) + 'loaded(Δ)'.padEnd(22) + 'noimg纯文字(Δ)'.padEnd(22) + 'ΣimgH(Δ)'.padEnd(14) + '分解校验');
  const keys = Object.keys(out.loaded);
  for (const k of keys) {
    const L = out.loaded[k], N = out.noimg[k], I = out.imgs[k];
    const pred = Math.round((N.d + I.dSumH) * 100) / 100;
    const ok = Math.abs(pred - L.d) <= 2 ? '✓' : '✗(预测' + pred + ')';
    console.log(k.padEnd(18) + (L.before + '→' + L.after + ' (' + (L.d >= 0 ? '+' : '') + L.d + ')').padEnd(22) +
      (N.before + '→' + N.after + ' (' + (N.d >= 0 ? '+' : '') + N.d + ')').padEnd(22) +
      (I.sumH0 + '→' + I.sumH1 + ' (' + (I.dSumH >= 0 ? '+' : '') + I.dSumH + ')').padEnd(14) + ok);
  }

  console.log('\n=== nosrc 口径（图高=0，确定性；对照基线 Agent 的「图未到」读数）@1440 ===');
  for (const [k, v] of Object.entries(out.unloaded)) {
    console.log(k.padEnd(30) + v.before + '→' + v.after + ' (' + (v.d >= 0 ? '+' : '') + v.d + ')   仍有高度的图=' + v.imgsWithHeight);
  }

  console.log('\n=== 变体对照 @1440（行宽 / 图宽 / 页高Δ） ===');
  for (const pg of ['dialogs', 'particles', 'worldcfg', 'tuning']) {
    for (const vk of ['base', 'exemptImgP', 'onlyImgP']) {
      const v = out.variants['1440/' + pg + '/' + vk];
      if (!v) continue;
      console.log(pg.padEnd(10) + vk.padEnd(12) + 'lineW ' + String(v.lineW0).padEnd(9) + '→ ' + String(v.lineW1).padEnd(9) + ' imgW=' + String(v.imgW1).padEnd(9) + ' ΔH=' + (v.dH >= 0 ? '+' : '') + v.dH);
    }
  }

  console.log('\n=== 图片逐张（1440） ===');
  for (const pg of ['particles', 'dialogs']) {
    const I = out.imgs['1440/' + pg];
    console.log(pg + '  n=' + I.before.length + '  inP=' + I.inP + '  ΣH ' + I.sumH0 + '→' + I.sumH1);
    for (let i = 0; i < I.before.length; i++) {
      const a = I.before[i], b = I.after[i];
      console.log('  ' + String(i).padStart(2) + ' nat=' + (a.natW + 'x' + a.natH).padEnd(10) + ' ren ' + (a.w + 'x' + a.h).padEnd(18) + '→ ' + (b.w + 'x' + b.h).padEnd(18) + ' ratio=' + (Math.round(b.w / a.w * 1000) / 1000) + '  ' + a.chain);
    }
  }
  console.log('\nJSON: ' + F);
}

main().catch((e) => { console.error(e); process.exit(1); });
