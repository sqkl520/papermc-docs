'use strict';
/** cr2ia-count2.js — 首页侧栏里「同一目标」的链接实例计数 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const s = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const side = s.match(/<nav class="sidebar"[\s\S]*?<\/nav>/)[0];

const sub = (re) => (side.match(re) || []).length;
const out = {
  sideTotalAnchors: sub(/<a\b/g),
  sideSecs: sub(/class="side-secs"/g),
  sideSecsLinks: (side.match(/<div class="side-secs"[\s\S]*?<\/div>/)[0].match(/<a\b/g) || []).length,
  secSwitchInTopbar: (s.match(/<nav class="sec-switch"[\s\S]*?<\/nav>/)[0].match(/<a\b/g) || []).length,
  navHome: sub(/class="nav-home"/g),
  sideHome: sub(/class="side-home"/g),
  sideGroup: sub(/class="side-group"/g),
  sideSec: sub(/class="side-sec"/g),
  sideCatLinks: (side.match(/<details class="side-cat"[\s\S]*?<\/details>/)[0].match(/<a\b/g) || []).length,
  sideFooter: (side.match(/<div class="side-section">[\s\S]*?<\/div>/)[0].match(/<a\b/g) || []).length,
};

// 同一 href 在侧栏出现的次数分布
const hrefs = [...side.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1]);
const freq = {};
for (const h of hrefs) freq[h] = (freq[h] || 0) + 1;
out.uniqHref = Object.keys(freq).length;
out.dupTargets = Object.entries(freq).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
out.instancesAtDup = out.dupTargets.reduce((n, [, c]) => n + c, 0);

// 首页主内容区里同一 href 出现的次数
const main = s.match(/<main id="main" class="content">([\s\S]*)<\/main>/)[1];
const mh = [...main.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1]);
const mfreq = {};
for (const h of mh) mfreq[h] = (mfreq[h] || 0) + 1;
out.mainAnchors = mh.length;
out.mainUniq = Object.keys(mfreq).length;
out.mainDup = Object.entries(mfreq).filter(([, n]) => n > 1);

fs.writeFileSync(path.join(require('os').tmpdir(), 'cr2ia', 'count2.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 1));
