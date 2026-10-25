'use strict';
/**
 * fa-sum.js — print compact summaries of the fa-*.json evidence files.
 * (Kept as a script because the JSON contains CJK and pwsh's default console
 *  encoding mangles it; Node prints UTF-8 cleanly.)
 *
 * Usage: node tools/fa-sum.js [cls|c5|core|attrib|c3]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.tmpdir(), 'fa');
const which = process.argv[2] || 'all';

function load(n) {
  const p = path.join(DIR, n + '.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

if (which === 'all' || which === 'cls') {
  const j = load('fa-c45');
  if (j) {
    console.log('=== CLS (dialogs, 220KB/s + 150ms latency) ===');
    for (const [k, v] of Object.entries(j.cls)) {
      console.log('  ' + k.padEnd(14) + ' cls=' + String(v.cls).padEnd(9) + ' max=' + String(v.maxShift).padEnd(9) +
        ' shifts=' + String(v.shiftCount).padEnd(3) + ' imgs=' + v.contentImgs + ' withDims=' + v.withDims +
        ' maxARdrift=' + v.maxArDrift + ' docH=' + v.docH);
      if (v.shifts && v.shifts.length) {
        console.log('      ' + v.shifts.slice(0, 5).map((s) => s.v + '@' + s.t + 'ms[' + s.src.join(',') + ']').join(' '));
      }
    }
  }
}

if (which === 'all' || which === 'core') {
  const j = load('fa-core');
  if (j) {
    console.log('\n=== core states @1440 ===');
    for (const [pg, row] of Object.entries(j.states)) {
      for (const [st, r] of Object.entries(row)) {
        console.log('  ' + pg.padEnd(10) + st.padEnd(10) + ' lineW=' + String(r.m.lineW).padEnd(11) +
          ' ch=' + String(r.m.lineCh).padEnd(4) + ' codeW=' + String(r.m.codeWmin + '~' + r.m.codeWmax).padEnd(17) +
          ' ov=' + String(r.m.codeOv + '/' + r.m.codeBlocks).padEnd(6) + ' adv=' + String(r.m.advance.median).padEnd(4) +
          ' docH=' + String(r.m.docH).padEnd(7) + ' preFs=' + r.m.codePreFs + ' stable=' + r.stable);
      }
    }
    console.log('  attrib=' + JSON.stringify(j.attrib));
  }
}

if (which === 'all' || which === 'attrib') {
  const j = load('fa-attrib');
  if (j) {
    console.log('\n=== per-commit attribution @1440 ===');
    for (const [pg, row] of Object.entries(j.rows)) {
      const line = Object.entries(row).map(([k, v]) => k + '=' + v.docH).join(' ');
      console.log('  ' + pg.padEnd(10) + line);
      console.log('      lineW ' + Object.entries(row).map(([k, v]) => k + '=' + v.lineW + '/' + v.lineCh + 'ch').join(' '));
      console.log('      codeOv ' + Object.entries(row).map(([k, v]) => k + '=' + v.codeOv + '/' + v.codeBlocks).join(' ') +
        ' | adv ' + Object.entries(row).map(([k, v]) => k + '=' + v.advMedian).join(' '));
    }
  }
}

if (which === 'all' || which === 'c3') {
  const j = load('fa-c3b');
  if (j) {
    console.log('\n=== cliff (f3ebbfc batch-1 vs HEAD) ===');
    for (const [tree, pages] of Object.entries(j.cliff)) {
      for (const [pg, d] of Object.entries(pages)) {
        console.log('  ' + tree.padEnd(5) + pg.padEnd(42) + ' steps=' + d.steps.length + ' ' +
          JSON.stringify(d.steps.map((s) => s.from + '->' + s.to + ':' + s.delta)));
      }
    }
    console.log('\n=== anchor occlusion ===');
    for (const a of j.anchor) {
      console.log('  ' + a.tree.padEnd(5) + ' vw=' + String(a.vw).padEnd(6) + ' tocPos=' + String(a.tocPos).padEnd(9) +
        ' offset=' + String(a.tocOffset).padEnd(6) + ' topbar=' + String(a.topbarH).padEnd(4) +
        ' headTop=' + String(a.headingTop).padEnd(7) + ' covered=' + a.coveredPct);
    }
    console.log('\n=== mobile ===');
    for (const [w, pages] of Object.entries(j.mobile)) {
      for (const [pg, m] of Object.entries(pages)) {
        console.log('  ' + String(w).padEnd(4) + pg.padEnd(42) + ' hOv=' + String(m.hOverflow).padEnd(4) +
          ' menu=' + String(m.menuBtn).padEnd(5) + String(m.menuBtnSize).padEnd(9) + ' tocVis=' + m.tocVisible);
      }
    }
  }
  const k = load('fa-c3');
  if (k) {
    const cnt = (o) => { const v = Object.values(o); return v.filter((x) => x.hOverflow <= 1).length + '/' + v.length; };
    console.log('\n=== overflow 8vp x 6pg ===');
    console.log('  HEAD=' + cnt(k.overflow) + '  a19a6c2=' + cnt(k.oldOverflow));
    const bad = Object.entries(k.overflow).filter(([, v]) => v.hOverflow > 1);
    if (bad.length) console.log('  HEAD BAD: ' + bad.map(([a, v]) => a + '=' + v.hOverflow).join(','));
    const bad2 = Object.entries(k.oldOverflow).filter(([, v]) => v.hOverflow > 1);
    console.log('  a19a6c2 BAD: ' + bad2.map(([a, v]) => a + '=' + v.hOverflow).join(','));
  }
}

if (which === 'all' || which === 'c5') {
  const j = load('fa-c5');
  if (j) {
    console.log('\n=== C5 ===');
    for (const [k, m] of Object.entries(j.cells)) {
      console.log('  ' + k.padEnd(24) + ' h5=' + m.h5Count + JSON.stringify(m.h5Sizes) +
        ' fb=' + (m.filterBar ? m.filterBar.position + '@' + m.filterBar.top : '-') +
        ' brokenTokens=' + m.brokenTokens + ' (of ' + m.tokenCount + ')' +
        ' grpTrunc=' + m.grpTruncated + ' zhTrunc=' + m.zhTruncated + ' hOv=' + m.hOverflow);
    }
  }
}
