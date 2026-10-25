'use strict';
/**
 * b2b2-a.js — A 组：当前列宽现状（new / b0 / old × 10 视口 × 6 页面）
 *
 * 每格记录：article.clientWidth、正文真实行盒宽（Range.getClientRects 全局最长行）、
 * 每行字符数（canvas 实测 '0' advance）、pageHeight、TOC 可见性/形态、
 * 代码块横滚数/总数、表格横滚数。
 *
 * 用法：node tools/b2b2-a.js
 * 产出：%TEMP%\b2b2\a.json + stdout 每格一行 JSON
 */
const L = require('./b2b2-lib');

const VPS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1200', width: 1200, height: 900 },
  { name: '1100', width: 1100, height: 900 },
  { name: '1025', width: 1025, height: 900 },
  { name: '1024', width: 1024, height: 900 },
  { name: '900', width: 900, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 568 },
];
const PAGES = [
  { name: 'landing', url: '/' },
  { name: 'paper', url: '/paper/' },
  { name: 'dialogs', url: '/paper/dev/dialogs/' },
  { name: 'worldcfg', url: '/paper/reference/world-configuration/' },
  { name: 'tuning', url: '/velocity/tuning/' },
  { name: 'allpages', url: '/all-pages.html' },
];

(async () => {
  console.log('b0 dump: ' + L.dumpB0().join(', '));
  const browser = await L.launch();
  const out = [];
  try {
    for (const build of ['new', 'b0', 'old']) {
      const ctx = await L.makeContext(browser, build, { width: 1440, height: 900 });
      const page = await ctx.newPage();
      const base = L.baseUrl(build);
      for (const vp of VPS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        for (const pg of PAGES) {
          let m;
          try {
            m = await L.gotoAndMeasure(page, base + pg.url, 150);
          } catch (e) {
            m = { error: String((e && e.message) || e).slice(0, 160) };
          }
          out.push({ build, vp: vp.name, page: pg.name, ...m });
          L.log({
            b: build, vp: vp.name, pg: pg.name,
            artW: m.articleClientW,
            lineW: m.prose ? m.prose.lineWGlobal : null,
            chLine: m.prose ? m.prose.chLineGlobal : null,
            chCap: m.prose ? m.prose.chCap : null,
            zeroW: m.prose ? m.prose.zeroW : null,
            h: m.pageHeight,
            toc: m.tocMode,
            code: m.code ? m.code.overflow + '/' + m.code.blocks : null,
            tbl: m.tables ? m.tables.overflow + '/' + m.tables.blocks : null,
            err: m.error || null,
          });
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('a.json', out) + ' (' + out.length + ' cells)');
})();
