'use strict';
/**
 * cr2cp-sum.js — 汇总 live.json + static.json，输出 ASCII 安全的紧凑摘要。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const T = path.join(os.tmpdir(), 'cr2cp');
const live = JSON.parse(fs.readFileSync(path.join(T, 'live.json'), 'utf8'));
const st = JSON.parse(fs.readFileSync(path.join(T, 'static.json'), 'utf8'));

const L = (s) => console.log(s);

L('==== 0. SCROLLSPY (dialogs 1440) ====');
live.scrollspy.dialogs1440.forEach((s, i) => L('  pos' + i + ' scrollY=' + s.scrollY + ' activeIdx=' + s.tocActiveIndex + ' active=' + JSON.stringify(s.tocActive) + ' n=' + s.tocActiveCount + ' drawer=' + JSON.stringify(s.drawerActive)));
L('==== 0b. SCROLLSPY (world-configuration 1440) ====');
L('  docH=' + live.scrollspy.worldDocH);
live.scrollspy.world1440.forEach((s, i) => L('  pos' + i + ' scrollY=' + s.scrollY + ' tocPresent=' + s.tocPresent + ' tocActive=' + s.tocActiveCount + ' sticky=' + JSON.stringify(s.stickyHandholds)));
L('  backToTop=' + JSON.stringify(live.scrollspy.worldBackToTop));

L('\n==== 1. CLICK TRIALS (dialogs) ====');
const c = live.click.dialogs;
Object.keys(c).forEach((k) => {
  const v = c[k];
  if (!v.exists) { L('  ' + k + ' -> NOT IN DOM'); return; }
  L('  ' + k.padEnd(22) + ' vis=' + v.visible + ' nav=' + v.navigated + ' href=' + String(v.href).slice(0, 46) + ' -> ' + String(v.after || '').replace(/^http:\/\/127\.0\.0\.1:\d+/, ''));
});
L('  crumbText=' + live.click.crumbText);
L('  pagerText=' + live.click.pagerText);

L('\n==== 2. VIEWPORT x PAGE 关键量 ====');
const vps = Object.keys(live.vps);
vps.forEach((vp) => {
  L('  -- ' + vp + ' --');
  Object.keys(live.vps[vp]).forEach((p) => {
    const d = live.vps[vp][p];
    const t = d.tocState;
    L('    ' + p.padEnd(40) + ' docH=' + String(d.docH).padStart(6)
      + ' h1Y=' + String(d.contentStart.h1Y).padStart(5)
      + ' p1Y=' + String(d.contentStart.firstBlockY).padStart(5)
      + ' crumbsY=' + String(d.contentStart.crumbsY).padStart(4)
      + ' toc=' + (t ? (t.items + 'items y=' + t.y + ' open=' + t.foldOpen + ' pos=' + t.position) : 'NONE')
      + ' sideLinks=' + d.sidebarLinks + ' pager=' + (d.controls.find((x) => x.key.indexOf('pager') === 0) ? 'y' + d.controls.find((x) => x.sel === 'nav.pager a.next').y : 'NONE'));
  });
});

L('\n==== 3. PRE(8788) vs POST(8787) ====');
Object.keys(live.prePost).forEach((p) => {
  const pr = live.prePost[p].pre, po = live.prePost[p].post;
  L('  ' + p);
  const row = (label, a, b) => L('    ' + label.padEnd(24) + ' pre=' + String(a).padStart(8) + '   post=' + String(b).padStart(8));
  row('docH', pr.docH, po.docH);
  row('h1 y', pr.contentStart.h1Y, po.contentStart.h1Y);
  row('正文首块 y', pr.contentStart.firstBlockY, po.contentStart.firstBlockY);
  row('面包屑 y', pr.contentStart.crumbsY, po.contentStart.crumbsY);
  row('TOC items', pr.tocState ? pr.tocState.items : 0, po.tocState ? po.tocState.items : 0);
  row('TOC y', pr.tocState ? pr.tocState.y : 'none', po.tocState ? po.tocState.y : 'none');
  row('TOC position', pr.tocState ? pr.tocState.position : 'none', po.tocState ? po.tocState.position : 'none');
  row('TOC titleH', pr.tocState ? pr.tocState.titleH : 'none', po.tocState ? po.tocState.titleH : 'none');
  row('侧栏可见链接', pr.controls.find((x) => x.sel === '.sidebar a[href]').visible, po.controls.find((x) => x.sel === '.sidebar a[href]').visible);
  row('侧栏 DOM 链接', pr.controls.find((x) => x.sel === '.sidebar a[href]').inDom, po.controls.find((x) => x.sel === '.sidebar a[href]').inDom);
  row('全部链接', pr.allLinks, po.allLinks);
  row('面包屑链接', pr.controls.find((x) => x.sel === 'nav.crumbs a').inDom, po.controls.find((x) => x.sel === 'nav.crumbs a').inDom);
  row('pager 存在', pr.controls.find((x) => x.sel === 'nav.pager a.next').visible, po.controls.find((x) => x.sel === 'nav.pager a.next').visible);
  row('pager y', pr.controls.find((x) => x.sel === 'nav.pager a.next').y, po.controls.find((x) => x.sel === 'nav.pager a.next').y);
  row('drawerToc DOM', pr.controls.find((x) => x.sel.indexOf('[data-drawer-toc]') === 0).inDom, po.controls.find((x) => x.sel.indexOf('[data-drawer-toc]') === 0).inDom);
  row('heading anchor', pr.controls.find((x) => x.sel === 'a.heading-anchor').inDom, po.controls.find((x) => x.sel === 'a.heading-anchor').inDom);
  row('顶部400px 元素', pr.bandCount, po.bandCount);
  row('正文列宽(w)', pr.band.find((x) => x.cls === 'page-desc') ? pr.band.find((x) => x.cls === 'page-desc').w : 'n/a', po.band.find((x) => x.cls === 'page-desc') ? po.band.find((x) => x.cls === 'page-desc').w : 'n/a');
  row('可见导航控件', pr.controls.filter((x) => x.visible > 0).length, po.controls.filter((x) => x.visible > 0).length);
  L('    TOC titleBefore: pre=' + JSON.stringify(pr.tocState ? pr.tocState.titleBeforeContent : null) + ' post=' + JSON.stringify(po.tocState ? po.tocState.titleBeforeContent : null));
  L('    TOC foldOpen:  pre=' + (pr.tocState ? pr.tocState.foldOpen : null) + ' post=' + (po.tocState ? po.tocState.foldOpen : null));
});

L('\n==== 4. MOBILE 390 ====');
L(JSON.stringify(live.mobile, null, 1));
