'use strict';
/* c3-dump.js — 读取 reports/mobile-verification.json 的 check 5 / 8 明细（只读） */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'mobile-verification.json'), 'utf8'));
const pick = (id) => (j.checks || []).find((x) => x.id === id);

const c5 = pick(5);
console.log('=== check 5 verdict=' + (c5 && c5.verdict) + ' run_at=' + (c5 && c5.run_at) + ' fp=' + (c5 && c5.fingerprint_at_run));
if (c5) {
  const B = (c5.metrics || {}).B || {};
  for (const k of Object.keys(B)) console.log('  ' + (B[k] ? 'PASS ' : 'FAIL ') + k);
  const d = (c5.metrics || {}).detail || {};
  console.log('  detail keys: ' + Object.keys(d).join(', '));
  for (const k of Object.keys(d)) {
    if (!/B5/.test(k)) continue;
    const v = d[k] || {};
    console.log('  ' + k + ' menuBtn=' + JSON.stringify(v.menuBtn && {
      exists: v.menuBtn.exists, visible: v.menuBtn.visible, display: v.menuBtn.display, w: v.menuBtn.w, h: v.menuBtn.h,
    }));
    console.log('  ' + k + ' flags=' + JSON.stringify({
      ok_menu_hidden: v.ok_menu_hidden, ok_menu_display_none: v.ok_menu_display_none,
      ok_sidebar_sticky: v.ok_sidebar_sticky, ok_transform_none: v.ok_transform_none, ok_no_inert: v.ok_no_inert,
    }));
  }
}

const c8 = pick(8);
console.log('\n=== check 8 verdict=' + (c8 && c8.verdict) + ' raw=' + (c8 && c8.raw_verdict) + ' run_at=' + (c8 && c8.run_at));
if (c8) {
  const m = c8.metrics || {};
  console.log('  pre_missing=' + m.pre_missing + ' diffCount=' + m.diffCount + ' regression=' + m.regressionCount);
  console.log('  hardFailures=' + JSON.stringify(m.hardFailures, null, 1));
  /* 1024x768 的快照：post 侧的版式事实 */
  const snaps = m.snapshots || [];
  for (const s of snaps) {
    if (s.viewport !== '1024x768') continue;
    for (const p of s.pages) {
      const b = (s.post || {})[p];
      if (!b) continue;
      console.log('  1024 ' + p.padEnd(42) + JSON.stringify({
        overflow: b.overflow, hasMenuButton: b.hasMenuButton, sidebarVisible: b.sidebarVisible,
        layoutCols: b.layoutCols, tocVisible: b.tocVisible, contentW: b.contentW, headerScrollW: b.headerScrollW, headerClientW: b.headerClientW,
      }));
    }
  }
}
