'use strict';
/**
 * b1r2-e.js — 修正版：精确对比度、:has() 焦点环（CSSOM 改写模拟丢弃）、拉伸链接（先滚入视口）、
 *              160px 溢出元凶、展开态页尾锚点、抽屉目录锚点
 * 用法: node tools/b1r2-e.js
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
const PAGE = '/paper/dev/particles/';
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const HELPERS = `
function _rgba(s){var m=String(s).match(/[\\d.]+/g);if(!m)return null;var a=m.length>3?+m[3]:1;return [+m[0],+m[1],+m[2],a];}
function _lin(c){c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function _lum(c){return 0.2126*_lin(c[0])+0.7152*_lin(c[1])+0.0722*_lin(c[2]);}
function _ratio(a,b){var l1=_lum(a),l2=_lum(b);if(l1<l2){var t=l1;l1=l2;l2=t;}return +((l1+0.05)/(l2+0.05)).toFixed(2);}
function _over(top,bot){var a=top[3];return [0,1,2].map(function(i){return Math.round(top[i]*a+bot[i]*(1-a));});}
/** 沿祖先链合成真实背景（遇到不透明即停），返回 rgb */
function bgOf(el){
  var stack=[], n=el;
  while(n && n.nodeType===1){
    var c=_rgba(getComputedStyle(n).backgroundColor);
    if(c && c[3]>0){ stack.push(c); if(c[3]>=1) break; }
    n=n.parentElement;
  }
  var base=[255,255,255];
  for(var i=stack.length-1;i>=0;i--) base=_over(stack[i],base);
  return base;
}
`;

(async () => {
  if (!EXE) { console.error('NO CHROME'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = {};

  // ================= E1 精确对比度 =================
  {
    out.contrast = [];
    const combos = [
      { n: 'auto+osDark', colorScheme: 'dark', clickedTheme: null },
      { n: 'explicitDark', colorScheme: 'light', clickedTheme: 'dark' },
      { n: 'explicitLight', colorScheme: 'dark', clickedTheme: 'light' },
      { n: 'auto+osLight', colorScheme: 'light', clickedTheme: null },
    ];
    for (const c of combos) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: c.colorScheme });
      const page = await ctx.newPage();
      await page.goto(NEW + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      if (c.clickedTheme) {
        await page.evaluate((t) => { const cur = document.documentElement.getAttribute('data-theme') || 'auto';
          const order = ['auto', 'light', 'dark'];
          let i = order.indexOf(cur);
          for (let k = 0; k < 4; k++) { i = (i + 1) % 3; if (order[i] === t) { document.getElementById('theme-toggle').click(); break; } document.getElementById('theme-toggle').click(); }
        }, c.clickedTheme);
        await page.waitForTimeout(300);
      }
      const probe = async () => page.evaluate(`(() => {
        ${HELPERS}
        var sel={keyword:'.hljs-keyword',string:'.hljs-string',title:'.hljs-title',comment:'.hljs-comment',number:'.hljs-number',builtin:'.hljs-built_in'};
        var r={theme:document.documentElement.getAttribute('data-theme'),bg:getComputedStyle(document.body).backgroundColor,ratio:{},raw:{},codeBgFound:null};
        var first=document.querySelector('.hljs-keyword');
        if(first){ r.codeBgFound=getComputedStyle(first.closest('.code-block')||first).backgroundColor; r.composited=bgOf(first); }
        for(var k in sel){var e=document.querySelector(sel[k]); if(!e){r.ratio[k]=null;continue;}
          var fg=_rgba(getComputedStyle(e).color); var bg=bgOf(e);
          r.raw[k]=getComputedStyle(e).color; r.ratio[k]=_ratio([fg[0],fg[1],fg[2]],bg);}
        return r;})()`);
      const screen = await probe();
      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(200);
      const print = await probe();
      await page.emulateMedia({ media: 'screen' });
      out.contrast.push({ combo: c.n, screen, print });
      log('CONTRAST ' + JSON.stringify({ combo: c.n, theme: screen.theme, screen: screen.ratio, print_onComposited: print.ratio, print_composited_bg: print.composited, screen_composited_bg: screen.composited }));
      await ctx.close();
    }
  }

  // ================= E2 :has() 焦点环（CSSOM 改写 = 规则被丢弃的等价态） =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    // 先滚到 src-item 再键盘聚焦
    await page.evaluate(() => { const it = document.querySelector('.src-item'); if (it) it.scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const res = {};
      const item = document.querySelector('.src-item');
      const link = item.querySelector('.src-link');
      res.supportsHas = (() => { try { return CSS.supports('selector(:has(a))'); } catch (e) { return 'err'; } })();
      // 找出相关规则
      const found = [];
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const rule of rules) {
          if (rule.selectorText && rule.selectorText.indexOf('src-link:focus-visible') >= 0) found.push({ sel: rule.selectorText, css: rule.style.cssText });
        }
      }
      res.rules = found;
      link.focus();
      res.afterFocus = {
        itemOutline: getComputedStyle(item).outlineStyle + ' ' + getComputedStyle(item).outlineWidth + ' ' + getComputedStyle(item).outlineColor,
        linkOutline: getComputedStyle(link).outlineStyle + ' ' + getComputedStyle(link).outlineWidth,
      };
      // 模拟 :has() 被丢弃：把该规则的 selectorText 改成永不匹配（等价于整条规则失效）
      let rewritten = 0;
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const rule of rules) {
          if (rule.selectorText && rule.selectorText.indexOf(':has(') >= 0 && rule.selectorText.indexOf('src-item') >= 0) {
            try { rule.selectorText = '.b1r2-never-match'; rewritten++; } catch (e) {}
          }
        }
      }
      res.rulesRewritten = rewritten;
      res.withoutHas = {
        itemOutline: getComputedStyle(item).outlineStyle + ' ' + getComputedStyle(item).outlineWidth + ' ' + getComputedStyle(item).outlineColor,
        linkOutline: getComputedStyle(link).outlineStyle + ' ' + getComputedStyle(link).outlineWidth,
      };
      // 加 :focus-within 兜底后
      const st = document.createElement('style');
      st.textContent = '.src-item:focus-within{outline:2px solid rgb(255,0,0);outline-offset:2px}';
      document.head.appendChild(st);
      res.withFocusWithinFallback = {
        itemOutline: getComputedStyle(item).outlineStyle + ' ' + getComputedStyle(item).outlineWidth + ' ' + getComputedStyle(item).outlineColor,
        linkOutline: getComputedStyle(link).outlineStyle + ' ' + getComputedStyle(link).outlineWidth,
      };
      res.stillFocused = document.activeElement === link;
      return res;
    });
    out.hasFocus = r;
    log('HASFOCUS ' + JSON.stringify(r));
    await ctx.close();
  }

  // ================= E3 拉伸链接（先滚入视口） =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.querySelector('.src-item').scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const item = document.querySelector('.src-item');
      const ir = item.getBoundingClientRect();
      const links = item.querySelectorAll('a');
      const sum = item.querySelector('.src-sum');
      const rel = item.querySelector('.src-rel');
      const hits = [];
      const y = Math.round(ir.top + ir.height / 2);
      for (let p = 0; p <= 100; p += 2) {
        const x = Math.round(ir.left + (ir.width * p) / 100);
        const el = document.elementFromPoint(x, y);
        let kind = 'null';
        if (el) {
          if (rel && el.closest('.src-rel') === rel) kind = 'REL';
          else if (el.tagName === 'A' && el.classList.contains('src-link')) kind = 'LINK';
          else if (el === item) kind = 'ITEM';
          else if (el.tagName === 'A') kind = 'OTHERLINK';
          else kind = el.tagName;
        }
        hits.push(p + ':' + kind);
      }
      const ctxHits = [];
      for (const f of [0.05, 0.35, 0.6, 0.85, 0.97]) {
        const x = Math.round(ir.left + ir.width * f);
        const el = document.elementFromPoint(x, y);
        const a = el && el.closest ? el.closest('a') : null;
        ctxHits.push({ f, tag: el ? el.tagName + '.' + String(el.className || '').split(' ')[0] : 'null', isLink: !!a, text: el ? (el.textContent || '').trim().slice(0, 20) : null });
      }
      return {
        itemW: Math.round(ir.width), itemH: Math.round(ir.height), linkCount: links.length,
        secondLink: links.length > 1 ? { href: links[1].getAttribute('href'), text: (links[1].textContent || '').trim().slice(0, 20) } : null,
        hits, ctxHits,
        sum: sum ? { w: Math.round(sum.getBoundingClientRect().width), pe: getComputedStyle(sum).pointerEvents, us: getComputedStyle(sum).userSelect } : null,
        rel: rel ? { w: Math.round(rel.getBoundingClientRect().width), pe: getComputedStyle(rel).pointerEvents, us: getComputedStyle(rel).userSelect } : null,
        afterInset: getComputedStyle(item.querySelector('.src-link'), '::after').inset,
        afterZ: getComputedStyle(item.querySelector('.src-link'), '::after').zIndex,
        itemZ: getComputedStyle(item).zIndex,
        linkPosition: getComputedStyle(item.querySelector('.src-link')).position,
      };
    });
    out.stretch = r;
    log('STRETCH ' + JSON.stringify({ itemW: r.itemW, linkCount: r.linkCount, second: r.secondLink, sum: r.sum, rel: r.rel, ctx: r.ctxHits, hitsCompact: r.hits.filter((h, i, a) => true).join(' ') }));
    // 真实拖选摘要
    const box = await page.evaluate(() => { const s = document.querySelector('.src-item .src-sum').getBoundingClientRect(); return { x: s.left, y: s.top + s.height / 2, w: s.width, h: s.height }; });
    await page.mouse.move(box.x + 3, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(box.w - 3, 380), box.y, { steps: 15 });
    await page.mouse.up();
    out.stretch.realDrag = await page.evaluate(() => { const s = window.getSelection(); return { text: (s ? s.toString() : '').slice(0, 40), len: s ? s.toString().length : 0 }; });
    // 拖选 src-rel
    const relBox = await page.evaluate(() => { const e = document.querySelector('.src-item .src-rel'); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width }; });
    await page.mouse.move(relBox.x + 2, relBox.y);
    await page.mouse.down();
    await page.mouse.move(relBox.x + relBox.w - 2, relBox.y, { steps: 10 });
    await page.mouse.up();
    out.stretch.realDragRel = await page.evaluate(() => { const s = window.getSelection(); return { text: (s ? s.toString() : '').slice(0, 40), len: s ? s.toString().length : 0 }; });
    log('DRAG ' + JSON.stringify({ sum: out.stretch.realDrag, rel: out.stretch.realDragRel }));
    // 真实右键
    const rcMenu = [];
    for (const f of [0.35, 0.85]) {
      const pt = await page.evaluate((ff) => { const it = document.querySelector('.src-item'); const b = it.getBoundingClientRect(); return { x: Math.round(b.left + b.width * ff), y: Math.round(b.top + b.height / 2) }; }, f);
      await page.mouse.click(pt.x, pt.y, { button: 'right' });
      await page.waitForTimeout(200);
      const st = await page.evaluate(() => ({ linkSelected: !!document.querySelector('a.src-link:focus'), activeTag: document.activeElement ? document.activeElement.tagName : null, activeHref: document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('href') : null }));
      rcMenu.push({ f, ...st });
      await page.keyboard.press('Escape');
    }
    out.stretch.rightClick = rcMenu;
    log('RIGHTCLICK ' + JSON.stringify(rcMenu));
    await ctx.close();
  }

  // ================= E4 160px 溢出元凶 =================
  {
    out.overflow = [];
    for (const w of [200, 160]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 640 } });
      const page = await ctx.newPage();
      await page.goto(NEW + '/', { waitUntil: 'load' });
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const docW = document.documentElement.clientWidth;
        const culprits = [];
        document.querySelectorAll('*').forEach((el) => {
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.right > docW + 1) {
            const cs = getComputedStyle(el);
            culprits.push({
              tag: el.tagName, cls: String(el.className || '').slice(0, 30),
              right: Math.round(b.right), w: Math.round(b.width), left: Math.round(b.left),
              minW: cs.minWidth, ws: cs.whiteSpace, ow: cs.overflowWrap,
              path: (() => { let p = [], n = el; for (let i = 0; i < 4 && n && n.nodeType === 1; i++) { p.unshift(n.tagName + (n.className ? '.' + String(n.className).split(' ')[0] : '')); n = n.parentElement; } return p.join('>'); })(),
            });
          }
        });
        /* 只留最外层几个 */
        return { docW, scrollW: document.documentElement.scrollWidth, count: culprits.length, top: culprits.slice(0, 8) };
      });
      r.testWidth = w;
      out.overflow.push(r);
      log('OVERFLOW ' + JSON.stringify(r));
      await ctx.close();
    }
  }

  // ================= E5 展开态：页尾锚点 =================
  {
    out.tailAnchor = [];
    for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '812x375', w: 812, h: 375 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await page.goto(NEW + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      const lastId = await page.evaluate(() => {
        const as = Array.from(document.querySelectorAll('.toc-side a[href^="#"]'));
        return as.length ? as[as.length - 1].getAttribute('href').slice(1) : null;
      });
      await page.evaluate(() => { document.querySelector('.toc-fold').open = true; });
      await page.waitForTimeout(400);
      await page.click('.toc-side a[href="#' + lastId + '"]');
      await page.waitForTimeout(1200);
      const r = await page.evaluate((id) => {
        const el = document.getElementById(id);
        const b = el.getBoundingClientRect();
        const toc = document.querySelector('.toc-side').getBoundingClientRect();
        return {
          id, headingTop: Math.round(b.top), headingBottom: Math.round(b.bottom), vh: innerHeight,
          tocBottom: Math.round(toc.bottom),
          hiddenBehindToc: b.top < toc.bottom && b.bottom > toc.top,
          visiblePx: Math.max(0, Math.round(Math.min(b.bottom, innerHeight) - Math.max(b.top, toc.bottom))),
          atScrollMax: Math.abs(window.scrollY - (document.documentElement.scrollHeight - innerHeight)) < 2,
          scrollY: Math.round(window.scrollY), maxScroll: Math.round(document.documentElement.scrollHeight - innerHeight),
          scrollPad: getComputedStyle(document.documentElement).scrollPaddingTop,
        };
      }, lastId);
      r.vp = vp.n;
      out.tailAnchor.push(r);
      log('TAILANCHOR ' + JSON.stringify(r));
      await ctx.close();
    }
  }

  // ================= E6 抽屉内目录（.side-toc）锚点 =================
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.click('.sidebar-toggle');
    await page.waitForTimeout(500);
    const has = await page.evaluate(() => {
      const d = document.getElementById('drawer-toc');
      if (!d) return { present: false };
      d.open = true;
      return { present: true, links: d.querySelectorAll('a').length, display: getComputedStyle(d).display };
    });
    let res = { present: has.present, links: has.links };
    if (has.present) {
      await page.waitForTimeout(400);
      const firstHref = await page.evaluate(() => { const a = document.querySelector('#drawer-toc a[href^="#"]'); return a ? a.getAttribute('href') : null; });
      await page.evaluate((h) => { document.querySelector('#drawer-toc a[href="' + h + '"]').click(); }, firstHref);
      await page.waitForTimeout(1200);
      res = { ...res, ...(await page.evaluate((h) => {
        const id = h.slice(1);
        const el = document.getElementById(id);
        const b = el.getBoundingClientRect();
        const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'));
        return {
          href: h, headingTop: Math.round(b.top), topbarBottom: Math.round(topbar),
          hiddenUnderTopbar: b.top < topbar, navOpen: document.body.classList.contains('nav-open'),
          visiblePx: Math.max(0, Math.round(Math.min(b.bottom, innerHeight) - Math.max(b.top, topbar))),
          offset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
          scrollPad: getComputedStyle(document.documentElement).scrollPaddingTop,
        };
      }, firstHref)) };
    }
    out.drawerToc = res;
    log('DRAWERTOC ' + JSON.stringify(res));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-e.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-e.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-e.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
