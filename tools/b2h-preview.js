'use strict';
/**
 * b2h-preview.js —— 批 2b 预演（只读 + 临时文件，不跑 build）
 *
 * 目的：在**不跑 build**（批 5 在用 build-site.js）的前提下，精确算出
 * 「删掉 tree-fold、换成 .sec-index」后首页 `<main>` 的字符数与页高。
 * 做法：读现成 index.html，把 tree-fold 块字符串替换成候选 HTML，
 * 写成仓库根目录的临时 `_b2h-cand-<n>.html`（放根目录是为了让 assets/ 相对路径照旧解析），
 * 用 file:// 打开分别测量，最后删除临时文件。
 *
 * 用法：node tools/b2h-preview.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const START = '<details class="tree-fold" id="tree">';
const END = '<div class="section-head" id="tax">';
const i = html.indexOf(START);
const j = html.indexOf(END);
if (i < 0 || j < 0 || j < i) { console.error('FATAL 定位失败 i=' + i + ' j=' + j); process.exit(1); }
const oldBlock = html.slice(i, j);

/* 从现成 entry-cards 里取三个分区的页数（与 build 同源，避免手抄） */
const secs = [];
for (const m of html.matchAll(/<a class="entry-card" href="([a-z]+)\/index\.html"><span class="ec-kicker">([^<]+)<\/span><span class="ec-title">([^<]+)<\/span><span class="ec-meta"><b>(\d+)<\/b>/g)) {
  secs.push({ id: m[1], kicker: m[2], cardTitle: m[3], pages: Number(m[4]) });
}
if (!secs.length) { console.error('FATAL 未解析到 entry-card'); process.exit(1); }
console.log('解析到分区：' + JSON.stringify(secs));

/* 候选 A：施工图原样（sec-item + si-name + si-count），标题用 section 名 */
const candA = '<div class="sec-index">' + secs.map((s) =>
  '<a class="sec-item" href="' + s.id + '/index.html">'
  + '<span class="si-name">' + s.kicker + '</span>'
  + '<span class="si-count">' + s.pages + ' 页</span></a>').join('') + '</div>';

/* 候选 B：省掉 si-name 包装（文本节点即 flex item），换成完整中文名 */
const candB = '<div class="sec-index">' + secs.map((s) =>
  '<a class="sec-item" href="' + s.id + '/index.html">'
  + s.cardTitle
  + '<span class="si-count">' + s.pages + ' 页</span></a>').join('') + '</div>';

/* 候选 C：保留 si-name + sec-item，名字用 section 名，页数只留数字（单位交给 CSS） */
const candC = '<div class="sec-index">' + secs.map((s) =>
  '<a class="sec-item" href="' + s.id + '/index.html">'
  + '<span class="si-name">' + s.kicker + '</span>'
  + '<span class="si-count">' + s.pages + '</span></a>').join('') + '</div>';

const CANDS = [
  { name: 'A-施工图原样', block: candA },
  { name: 'B-省si-name全中文名', block: candB },
  { name: 'C-sec-item+si-name+纯数字', block: candC },
];

function MEASURE() {
  const main = document.querySelector('main');
  const qa = (s) => Array.from(main.querySelectorAll(s));
  const vis = (el) => {
    if (!el) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const links = qa('a[href]');
  return {
    mainChars: main.innerHTML.length,
    mainLinks: links.length,
    pageHeight: document.documentElement.scrollHeight,
    firstScreenLinks: links.filter((a) => { if (!vis(a)) return false; const b = a.getBoundingClientRect(); return b.top < innerHeight && b.height > 0; }).length,
    secItems: qa('.sec-index a').map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').replace(/\s+/g, ' ').trim(), h: Math.round(a.getBoundingClientRect().height), vis: vis(a) })),
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--allow-file-access-from-files'] });
  const out = [];
  for (const c of CANDS) {
    const name = '_b2h-cand-' + c.name.split('-')[0] + '.html';
    const file = path.join(REPO, name);
    fs.writeFileSync(file, html.slice(0, i) + c.block + html.slice(j), 'utf8');
    const row = { cand: c.name, blockChars: c.block.length };
    for (const vp of [{ name: '1440', w: 1440, h: 900 }, { name: '390', w: 390, h: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'load' });
      await page.waitForTimeout(200);
      row[vp.name] = await page.evaluate(MEASURE);
      await ctx.close();
    }
    fs.unlinkSync(file);
    out.push(row);
  }
  await browser.close();

  console.log('\n原 tree-fold 块字符 = ' + oldBlock.length);
  for (const r of out) {
    console.log('\n[' + r.cand + ']  新块 ' + r.blockChars + ' 字符');
    for (const vp of ['1440', '390']) {
      const m = r[vp];
      console.log('  ' + vp + ' main=' + m.mainChars + (m.mainChars <= 5200 ? ' ✅' : ' ❌(>5200)')
        + '  链接=' + m.mainLinks + (m.mainLinks <= 40 ? ' ✅' : ' ❌')
        + '  页高=' + m.pageHeight + (vp === '1440' ? (m.pageHeight <= 800 ? ' ✅' : ' ❌') : '')
        + '  首屏链接=' + m.firstScreenLinks);
      if (vp === '1440') console.log('       sec-items=' + JSON.stringify(m.secItems));
    }
  }
})().catch((e) => { console.error('FATAL ' + (e && e.stack ? e.stack : e)); process.exit(1); });
