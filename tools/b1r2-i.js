'use strict';
/**
 * b1r2-i.js — 归因与边界
 *   I1 打印态 token/正文对比度：改后 vs 改前（判定是否批 1 回归）
 *   I2 17.5em 的 em 基准：用 CDP Page.setFontSizes 改浏览器默认字号（真正的 em 基准）
 *   I3 浅色主题打印是否正常（对照）
 * 用法: node tools/b1r2-i.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';
const PAGE = '/paper/dev/particles/';
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const HELP = `
function _rgba(s){var m=String(s).match(/[\\d.]+/g);if(!m)return null;var a=m.length>3?+m[3]:1;return [+m[0],+m[1],+m[2],a];}
function _lin(c){c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function _lum(c){return 0.2126*_lin(c[0])+0.7152*_lin(c[1])+0.0722*_lin(c[2]);}
function _ratio(a,b){var l1=_lum(a),l2=_lum(b);if(l1<l2){var t=l1;l1=l2;l2=t;}return +((l1+0.05)/(l2+0.05)).toFixed(2);}
`;
const PROBE = `(() => {
  ${HELP}
  var white=[255,255,255];
  var sel={keyword:'.hljs-keyword',string:'.hljs-string',title:'.hljs-title',comment:'.hljs-comment',number:'.hljs-number',builtin:'.hljs-built_in'};
  var r={theme:document.documentElement.getAttribute('data-theme'),bodyColor:getComputedStyle(document.body).color,bodyBg:getComputedStyle(document.body).backgroundColor,onWhite:{},raw:{}};
  var pre=document.querySelector('.code-pre')||document.querySelector('pre');
  r.codeColor=pre?getComputedStyle(pre).color:null;
  r.codeOnWhite=r.codeColor?_ratio(_rgba(r.codeColor),white):null;
  r.bodyOnWhite=_ratio(_rgba(r.bodyColor),white);
  for(var k in sel){var e=document.querySelector(sel[k]);if(!e){r.onWhite[k]=null;continue;}
    r.raw[k]=getComputedStyle(e).color;r.onWhite[k]=_ratio(_rgba(getComputedStyle(e).color),white);}
  return r;})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { printContrast: [], fontBasis: [], lightPrint: {} };

  // ---------- I1 打印对比度 改后 vs 改前 ----------
  for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
    for (const cs of ['dark', 'light']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: cs });
      const page = await ctx.newPage();
      await page.goto(base + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(350);
      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(250);
      const r = await page.evaluate(PROBE);
      r.tag = tag; r.osScheme = cs;
      out.printContrast.push(r);
      log('PRINT ' + JSON.stringify({ tag, os: cs, theme: r.theme, codeOnWhite: r.codeOnWhite, bodyOnWhite: r.bodyOnWhite, tokOnWhite: r.onWhite }));
      await ctx.close();
    }
  }

  // ---------- I2 em 基准：改浏览器默认字号 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(NEW + '/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    for (const fsPx of [16, 20, 24]) {
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: fsPx, fixed: Math.round(fsPx * 0.8125) } });
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const l = document.querySelector('.src-list[data-depth="3"]');
        return {
          vw: innerWidth,
          mq280: matchMedia('(max-width:280px)').matches,
          mq17_5em: matchMedia('(max-width:17.5em)').matches,
          mq20em: matchMedia('(max-width:20em)').matches,
          htmlFontSize: getComputedStyle(document.documentElement).fontSize,
          bodyFontSize: getComputedStyle(document.body).fontSize,
          srcListPadLeft: l ? getComputedStyle(l).paddingLeft : null,
          docScrollW: document.documentElement.scrollWidth,
          overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      r.browserDefaultFont = fsPx;
      out.fontBasis.push(r);
      log('FONTBASIS ' + JSON.stringify(r));
    }
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 16, fixed: 13 } });
    await ctx.close();
  }

  // ---------- I3 浅色主题打印 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.evaluate(() => { const t = document.getElementById('theme-toggle'); t.click(); t.click(); }); // auto→light→dark
    await page.evaluate(() => { const t = document.getElementById('theme-toggle'); t.click(); });           // dark→auto
    await page.waitForTimeout(300);
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(250);
    out.lightPrint = await page.evaluate(PROBE);
    log('LIGHTPRINT ' + JSON.stringify({ theme: out.lightPrint.theme, codeOnWhite: out.lightPrint.codeOnWhite, tok: out.lightPrint.onWhite }));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-i.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-i.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-i.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
