'use strict';
/* critique-typo-z.js -- confirm the code line advance on the LONGEST code block of each page,
   because the <pre> strut (16px x 1.55 = 24.8px) may override the <code> 21.08px. */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));
const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const IN_PAGE = () => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const lines = [];
  for (const pre of qa('.code-pre')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const nLines = (code.innerText || '').split('\n').length;
    if (nLines < 3) continue;
    const cs = getComputedStyle(code);
    const ps = getComputedStyle(pre);
    const preH = pre.getBoundingClientRect().height;
    const padT = parseFloat(ps.paddingTop), padB = parseFloat(ps.paddingBottom);
    const implied = R2((preH - padT - padB) / nLines);
    lines.push({
      nLines: nLines,
      codeFont: R2(parseFloat(cs.fontSize)),
      codeLh: R2(parseFloat(cs.lineHeight)),
      preFont: R2(parseFloat(ps.fontSize)),
      preLh: R2(parseFloat(ps.lineHeight)),
      preH: R2(preH),
      padT: padT, padB: padB,
      impliedAdvance: implied,
      impliedOverCode: R2(implied / parseFloat(cs.fontSize)),
    });
  }
  return lines;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const out = {};
  for (const u of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/']) {
    await page.goto('http://127.0.0.1:8787' + u, { waitUntil: 'load' });
    await page.waitForTimeout(100);
    out[u] = await page.evaluate(IN_PAGE);
    process.stderr.write('ok ' + u + '\n');
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'z-codeleading.json'), JSON.stringify(out, null, 1), 'utf8');
  for (const k of Object.keys(out)) {
    console.log('==', k);
    for (const b of out[k]) {
      console.log('   ' + String(b.nLines).padStart(3) + ' lines | code ' + b.codeFont + '/' + b.codeLh + ' | pre ' + b.preFont + '/' + b.preLh +
        ' | implied advance ' + String(b.impliedAdvance).padStart(6) + 'px = ' + b.impliedOverCode + 'x code font');
    }
  }
})();
