'use strict';
// 精确：只数 .article 内的标题与正文字符（用真实浏览器，避免正则误判）
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* 从 sitemap 拿全部 URL，抽样 + 全量都可以；这里全量跑但只输出摘要 */
function urls() {
  const sm = fs.readFileSync(path.join(__dirname, '..', 'sitemap.xml'), 'utf8');
  const out = [];
  for (const m of sm.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const u = m[1];
    const i = u.indexOf('papermc-docs');
    if (i < 0) continue;
    out.push(u.slice(i + 'papermc-docs'.length) || '/');
  }
  return out;
}

const PROBE = () => {
  const art = document.querySelector('.article');
  if (!art) return { noArticle: true };
  const c = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
  for (const lv of Object.keys(c)) c[lv] = art.querySelectorAll(lv).length;
  return {
    chars: (art.textContent || '').length,
    ...c,
    li: art.querySelectorAll('li').length,
    pre: art.querySelectorAll('pre').length,
    table: art.querySelectorAll('table').length,
    p: art.querySelectorAll('p').length,
    pageH: Math.round(document.documentElement.scrollHeight),
  };
};

(async () => {
  const all = urls();
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const rows = [];
  let done = 0;
  for (const u of all) {
    try {
      const r = await page.goto(BASE + u, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (!r || r.status() >= 400) { rows.push({ url: u, status: r ? r.status() : 0 }); continue; }
      const d = await page.evaluate(PROBE);
      rows.push({ url: u, ...d });
    } catch (e) {
      rows.push({ url: u, error: String(e && e.message || e).slice(0, 80) });
    }
    if (++done % 20 === 0) process.stdout.write('.');
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p25.json'), JSON.stringify(rows, null, 1), 'utf8');

  const arts = rows.filter((r) => !r.noArticle && !r.error && r.status === undefined);
  console.log('\n\nURLs=' + rows.length + '  with .article=' + arts.length);
  const noH2 = arts.filter((r) => r.h2 === 0);
  console.log('article pages with h2=0: ' + noH2.length);
  const bigNoH2 = noH2.filter((r) => r.chars > 3000).sort((a, b) => b.chars - a.chars);
  console.log('  of which chars>3000: ' + bigNoH2.length);
  for (const r of bigNoH2.slice(0, 20)) {
    console.log('   ' + String(r.chars).padStart(6) + 'ch h3=' + r.h3 + ' h4=' + r.h4 + ' h5=' + r.h5 + ' li=' + String(r.li).padStart(3) + ' H=' + r.pageH + '  ' + r.url);
  }
  const totChars = arts.reduce((a, r) => a + (r.chars || 0), 0);
  console.log('total article chars=' + totChars + '  mean=' + Math.round(totChars / arts.length));
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
