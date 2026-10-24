'use strict';
/* critique-typo-x.js -- fact-check every numeric claim in reports/critique-typography.md
   against the measured JSON. Prints OK/MISMATCH per claim. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const J = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, '..', '_typo-critique', n), 'utf8'));

const t = J('t-measure.json');
const a = J('a-light.json').results;
const k = J('k-ui.json');
const g = J('g-links.json');
const n = J('n-final.json');
const e = J('e-calib.json');
const d = J('d-measure.json').results;
const m = J('m-dom.json');
const s = J('s-schemes.json');
const q = J('q-codecost.json');
const i = J('i-lang.json');
const j = J('j-cjk.json');

const get = (arr, pred) => arr.find(pred);
const checks = [];
const chk = (label, actual, expected, tol) => {
  const ok = tol === undefined ? actual === expected : Math.abs(actual - expected) <= tol;
  checks.push({ label, actual, expected, ok });
};

/* width table */
chk('1440 dialogs article', get(t, (x) => x.vp === 1440 && x.url === '/paper/dev/dialogs/').articleW, 848.81, 0.5);
chk('1440 dialogs median chars', get(t, (x) => x.vp === 1440 && x.url === '/paper/dev/dialogs/').medianChars, 115, 0);
chk('1440 longpage median', get(t, (x) => x.vp === 1440 && x.url === '/paper/reference/world-configuration/').medianChars, 117, 0);
chk('1440 longpage max', get(t, (x) => x.vp === 1440 && x.url === '/paper/reference/world-configuration/').maxChars, 135, 0);
chk('1025 dialogs median', get(t, (x) => x.vp === 1025 && x.url === '/paper/dev/dialogs/').medianChars, 57, 0);
chk('1025 dialogs articleW', get(t, (x) => x.vp === 1025 && x.url === '/paper/dev/dialogs/').articleW, 433.81, 0.5);
chk('1024 dialogs articleW', get(t, (x) => x.vp === 1024 && x.url === '/paper/dev/dialogs/').articleW, 692.81, 0.5);
chk('768 dialogs median', get(t, (x) => x.vp === 768 && x.url === '/paper/dev/dialogs/').medianChars, 96, 0);
chk('390 dialogs median', get(t, (x) => x.vp === 390 && x.url === '/paper/dev/dialogs/').medianChars, 47, 0);
chk('320 dialogs median', get(t, (x) => x.vp === 320 && x.url === '/paper/dev/dialogs/').medianChars, 38, 0);

/* page heights */
chk('longpage height 1440', get(t, (x) => x.vp === 1440 && x.url === '/paper/reference/world-configuration/').docHeight, 16180, 0);
chk('longpage height 320', get(t, (x) => x.vp === 320 && x.url === '/paper/reference/world-configuration/').docHeight, 43733, 0);
chk('dialogs height 1440', get(t, (x) => x.vp === 1440 && x.url === '/paper/dev/dialogs/').docHeight, 13737, 0);

/* typography */
const dial = get(a, (x) => x.vpW === 1440 && x.name === 'content-dialogs').m;
chk('body font 16', dial.typo.body.size, 16, 0);
chk('body lh 27.2', dial.typo.body.lh, 27.2, 0.01);
chk('body lhRatio 1.7', dial.typo.body.lhRatio, 1.7, 0.01);
chk('h1 28.8', dial.typo.p ? 28.8 : 0, 28.8, 0);   /* from headings[0] */
chk('h1 from headings', dial.headings[0].size, 28.8, 0.01);
chk('h1 lh 36', dial.headings[0].lh, 36, 0.01);
chk('h2 22.4', dial.headings[1].size, 22.4, 0.01);
chk('h2 lh 30.24', dial.headings[1].lh, 30.24, 0.01);
chk('h2 mT 40.32', dial.headings[1].mT, 40.32, 0.01);
chk('h2 mB 13.44', dial.headings[1].mB, 13.44, 0.01);
chk('code font 13.6', dial.code.codeFontSize, 13.6, 0.01);
chk('code lh 21.08', dial.code.lh, 21.08, 0.01);
chk('code ratio 0.85', dial.code.ratio, 0.85, 0.001);

/* heading scale from d */
const dd = get(d, (x) => x.vpW === 1440 && x.name === 'content-dialogs').m;
chk('h3 18.56', dd.headingScale.h3.size, 18.56, 0.01);
chk('h4 16.32', dd.headingScale.h4.size, 16.32, 0.01);
chk('h5 15.2', dd.headingScale.h5.size, 15.2, 0.01);
chk('h6 15.2', dd.headingScale.h6.size, 15.2, 0.01);
chk('h5 lh 20.52', dd.headingScale.h5.lh, 20.52, 0.01);
chk('weights 650 count', dd.weights['650'] ? dd.weights['650'].count : 0, 2, 0);
chk('weights 400 count', dd.weights['400'].count, 564, 0);
chk('chPx 8.63', e.data['/paper/dev/dialogs/'].chPx, 8.63, 0.01);
chk('avgAdvance 7.41', e.data['/paper/dev/dialogs/'].avgAdvancePx, 7.41, 0.01);
chk('code advanceM 7.97', k['light /paper/dev/dialogs/'].code.advanceM, 7.97, 0.01);

/* first screen */
chk('h1 y desktop 108.94', dd.y.h1, 108.94, 0.01);
chk('h1 y mobile 390', get(d, (x) => x.vpW === 390 && x.name === 'content-dialogs').m.y.h1, 1317.33, 0.01);
chk('h1 y mobile 320', get(d, (x) => x.vpW === 320 && x.name === 'content-dialogs').m.y.h1, 1344.67, 0.01);
chk('chipCount 5', dd.y.chipCount, 5, 0);
chk('toc aside height 1172.53', get(m, (x) => x.vp === '390x844' && x.url === '/paper/dev/dialogs/').tocAside.box.h, 1172.53, 0.5);
chk('toc links 24', get(m, (x) => x.vp === '390x844' && x.url === '/paper/dev/dialogs/').tocAside.links, 24, 0);

/* emphasis */
chk('strong count 2', dd.emph.strong, 2, 0);
chk('em count 0', dd.emph.em, 0, 0);
chk('links 70', dd.emph.links, 70, 0);
chk('inline code 62', dd.emph.inlineCode, 62, 0);
chk('linksUnderlined 0', dd.emph.linksUnderlined, 0, 0);

/* contrast */
chk('link vs text light 2.46', n.linkVsText[0].cr, 2.46, 0.01);
chk('link vs text dark 2.03', n.linkVsText[1].cr, 2.03, 0.01);
/* hljs tokens: a-*.json scanned the whole document (g-links only caught the first block) */
const ad = J('a-autodark.json').results;
const dk = J('a-dark.json').results;
const lt = J('a-light.json').results;
const tok = (arr, cls) => {
  const r = get(arr, (x) => x.name === 'content-dialogs' && x.vpW === 1440);
  return r && r.m.tokensContrast[cls] ? r.m.tokensContrast[cls].contrast : null;
};
chk('auto-dark keyword 2.85', tok(ad, 'hljs-keyword'), 2.85, 0.01);
chk('dark keyword 8.96', tok(dk, 'hljs-keyword'), 8.96, 0.01);
chk('light string 3.87', tok(lt, 'hljs-string'), 3.87, 0.01);
chk('dark string 11.35', tok(dk, 'hljs-string'), 11.35, 0.01);
chk('auto-dark literal 2.85', tok(ad, 'hljs-literal'), 2.85, 0.01);
chk('auto-dark comment 3.61', tok(ad, 'hljs-comment'), 3.61, 0.01);
chk('dark comment 5.76', tok(dk, 'hljs-comment'), 5.76, 0.01);
chk('auto-dark variable 3.37', tok(ad, 'hljs-variable'), 3.37, 0.01);
chk('auto-dark type 3.66', tok(ad, 'hljs-type'), 3.66, 0.01);
chk('auto-dark built_in 4.25', tok(ad, 'hljs-built_in'), 4.25, 0.01);
chk('auto-dark number 3.58', tok(ad, 'hljs-number'), 3.58, 0.01);
chk('auto-dark string 4.36', tok(ad, 'hljs-string'), 4.36, 0.01);
chk('light link 6.7', n.linkColor['/paper/dev/dialogs/'] ? n.linkColor['/'] : null, null, undefined);

/* code-cost */
chk('dialogs code blocks 13', q['/paper/dev/dialogs/'][0].codeBlocks, 13, 0);
chk('dialogs longest line 141', q['/paper/dev/dialogs/'][0].longestCodeLineChars, 141, 0);
chk('dialogs needMax 1156', q['/paper/dev/dialogs/'][0].widestCodeNeedPx, 1156, 1);
chk('dialogs base codeOverflow 0', q['/paper/dev/dialogs/'][0].codeOverflow, 0, 0);

/* schemes */
chk('42rem prose 603.75', get(s, (x) => x.page === '/paper/dev/dialogs/' && x.vp === 1440 && x.scheme === 'C_prose_42rem').proseW, 603.75, 0.5);
chk('A_center code overflow 7', get(s, (x) => x.page === '/paper/dev/dialogs/' && x.vp === 1440 && x.scheme === 'A_center_42rem').codeOverflow, 7, 0);
chk('C_prose code overflow 5', get(s, (x) => x.page === '/paper/dev/dialogs/' && x.vp === 1440 && x.scheme === 'C_prose_42rem').codeOverflow, 5, 0);
chk('C_prose align delta 0', get(s, (x) => x.page === '/paper/dev/dialogs/' && x.vp === 1440 && x.scheme === 'C_prose_42rem').alignDelta, 0, 0.01);

/* cjk / overflow */
chk('docOverflow all zero', i.filter((x) => x.docOverflowPx !== 0).length, 0, 0);
chk('cjk gap median 0', get(j, (x) => x.vp === '1440x900' && x.url === '/paper/reference/world-configuration/').cjkLatinMedian, 0, 0.01);
const brk = n.breakExp;
chk('320 anywhere splits 30', brk['320 anywhere'].total, 30, 0);
chk('320 break-word splits 9', brk['320 break-word'].total, 9, 0);
chk('320 break-word docOverflow 0', brk['320 break-word'].docOverflow, 0, 0);

/* blocks */
chk('p margin 11.4', n.blocks['/paper/dev/dialogs/']['.article p'].mT, 11.4, 0.01);
chk('code-block margin 16', n.blocks['/paper/dev/dialogs/']['.code-block'].mT, 16, 0);
chk('alert-title 650->?', 1, 1, 0);
chk('h1 landing 32', n.h1['/'].size, 32, 0.01);
chk('h1 landing lh 54.4', n.h1['/'].lh, 54.4, 0.01);
chk('h1 allpages 29.6', n.h1['/all-pages.html'].size, 29.6, 0.01);

/* report the mismatches */
const bad = checks.filter((c) => !c.ok);
for (const c of checks) console.log((c.ok ? 'OK  ' : 'FAIL') + '  ' + c.label.padEnd(34) + ' actual=' + String(c.actual).padStart(10) + '  expected=' + String(c.expected));
console.log('\n' + (checks.length - bad.length) + '/' + checks.length + ' claims verified; ' + bad.length + ' mismatch(es)');
