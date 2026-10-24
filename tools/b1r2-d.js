'use strict';
/**
 * b1r2-d.js — 红队批1 · 角度 3/4/5/6/7/8/9
 *   D1 preventScroll 真支持 vs 模拟缺失（monkeypatch 忽略 options）的位移差
 *   D2 scrollIntoView({behavior:'instant'}) 是否抛错；smooth 兜底是否被动画化/打断
 *   D3 抽屉开→关一个完整回合的净位移 + 关闭后焦点是否可见
 *   D4 :has() 缺失时焦点环是否完全消失（真实模拟：删除规则 vs 改写为 :focus-within）
 *   D5 主题按钮在窄屏是否纯空白（可识别性）
 *   D6 200% 缩放等效视口 160px 下 17.5em 媒体查询是否生效 + 横向溢出
 *   D7 打印 token 对比度 / light 显式 / 硬编码 hljs 残留
 *   D8 拉伸链接：右键菜单归属、行内第二链接、:hover 背景层叠、选中
 *   D9 渐隐条到最右是否仍遮挡
 * 用法: node tools/b1r2-d.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/particles/';

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

/* ---------- 对比度工具（注入页面用） ---------- */
const CONTRAST = `
function _rgb(s){var m=String(s).match(/[\\d.]+/g);if(!m)return null;return [ +m[0], +m[1], +m[2] ];}
function _lin(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function _lum(rgb){return 0.2126*_lin(rgb[0])+0.7152*_lin(rgb[1])+0.0722*_lin(rgb[2]);}
function _ratio(a,b){var l1=_lum(a),l2=_lum(b);if(l1<l2){var t=l1;l1=l2;l2=t;}return +((l1+0.05)/(l2+0.05)).toFixed(2);}
function _mix(bg,alpha,fg){/* alpha over */return [0,1,2].map(function(i){return fg[i]*alpha+bg[i]*(1-alpha);});}
`;

(async () => {
  if (!EXE) { console.error('NO CHROME'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = {};

  // ================= D1/D2/D3 同页一次跑 =================
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);

    // ---- D1 位移：真支持 vs 模拟缺失 ----
    out.preventScroll = await page.evaluate(() => {
      const html = document.documentElement;
      const prev = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';        // 排除 smooth 干扰，只测焦点引起的滚动
      const btn = document.querySelector('.sidebar-toggle');
      const res = {};
      const run = (label, fn) => {
        window.scrollTo(0, 3000);
        const y0 = window.pageYOffset;
        fn(btn);
        res[label] = { before: Math.round(y0), after: Math.round(window.pageYOffset), delta: Math.round(window.pageYOffset - y0) };
      };
      run('native_preventScroll_true', (b) => b.focus({ preventScroll: true }));
      run('native_plain_focus', (b) => b.focus());
      // 模拟老浏览器：focus 静默忽略 options（不抛错）
      const orig = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function () { return orig.call(this); };   // 丢掉 options
      run('simulated_unsupported_preventScroll', (b) => {
        try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
      });
      HTMLElement.prototype.focus = orig;
      html.style.scrollBehavior = prev;
      res.scrollBehavior = getComputedStyle(html).scrollBehavior;
      return res;
    });
    log('PREVENTSCROLL ' + JSON.stringify(out.preventScroll));

    // ---- D2 scrollIntoView instant 支持性 + smooth 兜底是否动画化 ----
    out.scrollBehavior = await page.evaluate(async () => {
      const res = {};
      const el = document.querySelector('.article h2');
      // a) behavior:'instant' 是否抛错
      try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); res.instantThrows = false; }
      catch (e) { res.instantThrows = String(e.name) + ': ' + String(e.message).slice(0, 60); }
      await new Promise((r) => setTimeout(r, 300));
      res.instantScrollY = Math.round(window.pageYOffset);
      // b) 'instant' 是否真的瞬时（与 'smooth' 对比帧数）
      const sample = async (beh) => {
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 60));
        const frames = [];
        el.scrollIntoView({ block: 'center', behavior: beh });
        for (let i = 0; i < 6; i++) { frames.push(Math.round(window.pageYOffset)); await new Promise((rr) => requestAnimationFrame(rr)); }
        await new Promise((r) => setTimeout(r, 400));
        frames.push(Math.round(window.pageYOffset));
        return { frames, distinct: new Set(frames).size };
      };
      res.instant = await sample('instant');
      res.smooth = await sample('smooth');
      res.auto = await sample('auto');
      res.htmlScrollBehavior = getComputedStyle(document.documentElement).scrollBehavior;
      return res;
    });
    log('SCROLLINTOVIEW ' + JSON.stringify(out.scrollBehavior));

    // ---- D3 开→关一个回合：净位移 + 关闭后焦点可见性 ----
    out.drawerCycle = [];
    for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '320x568', w: 320, h: 568 }]) {
      const c2 = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const p2 = await c2.newPage();
      await p2.goto(NEW + PAGE, { waitUntil: 'load' });
      await p2.waitForTimeout(400);
      const snap = async () => p2.evaluate(() => {
        const side = document.querySelector('.sidebar');
        const ae = document.activeElement;
        const sr = side.getBoundingClientRect();
        const ar = ae ? ae.getBoundingClientRect() : null;
        const ab = side.querySelector('a.active, [aria-current="page"]');
        const abr = ab ? ab.getBoundingClientRect() : null;
        return {
          y: Math.round(window.pageYOffset),
          drawerScrollTop: Math.round(side.scrollTop),
          focus: ae ? (ae.tagName + '.' + String(ae.className || '').split(' ')[0]) : null,
          focusTop: ar ? Math.round(ar.top) : null,
          focusInDrawer: ar ? (ar.top >= sr.top && ar.bottom <= sr.bottom && ar.height > 0) : null,
          focusInViewport: ar ? (ar.top >= 0 && ar.bottom <= innerHeight && ar.height > 0) : null,
          activeTop: abr ? Math.round(abr.top) : null,
          navOpen: document.body.classList.contains('nav-open'),
          outlineOnFocus: ae ? getComputedStyle(ae).outlineStyle + ' ' + getComputedStyle(ae).outlineWidth : null,
        };
      });
      await p2.evaluate(() => window.scrollTo(0, 4200));
      await p2.waitForTimeout(400);
      const y0 = await snap();
      await p2.click('.sidebar-toggle');
      await p2.waitForTimeout(500);
      const y1 = await snap();
      await p2.click('.sidebar-toggle');
      await p2.waitForTimeout(500);
      const y2 = await snap();
      // 再来两轮，测累积
      await p2.click('.sidebar-toggle'); await p2.waitForTimeout(400);
      await p2.click('.sidebar-toggle'); await p2.waitForTimeout(400);
      const y3 = await snap();
      out.drawerCycle.push({ vp: vp.n, y0, y1, y2, y3, netFirstCycle: y2.y - y0.y, netTwoCycles: y3.y - y0.y });
      log('DRAWERCYCLE ' + JSON.stringify({ vp: vp.n, y0: y0.y, y1: y1.y, y2: y2.y, y3: y3.y, net1: y2.y - y0.y, net2: y3.y - y0.y, focusAfterOpen: y1.focus, focusTop: y1.focusTop, focusInDrawer: y1.focusInDrawer, activeTop: y1.activeTop, drawerScrollTop: y1.drawerScrollTop, focusAfterClose: y2.focus, focusInViewportAfterClose: y2.focusInViewport }));
      await c2.close();
    }
    await ctx.close();
  }

  // ================= D4 :has() 焦点环 =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const r = await page.evaluate(async () => {
      const res = {};
      const item = document.querySelector('.src-item');
      const link = item && item.querySelector('.src-link');
      if (!link) return { err: 'no src-item' };
      res.supportsHas = (() => { try { return CSS.supports('selector(:has(a))'); } catch (e) { return 'err'; } })();
      const read = () => {
        const ic = getComputedStyle(item);
        const lc = getComputedStyle(link);
        return {
          itemOutline: ic.outlineStyle + ' ' + ic.outlineWidth + ' ' + ic.outlineColor,
          itemOutlineOffset: ic.outlineOffset,
          linkOutline: lc.outlineStyle + ' ' + lc.outlineWidth,
          uuid: item.getBoundingClientRect().width,
        };
      };
      link.focus();
      // 需要 focus-visible：用键盘 Tab 更真实；这里以 focus() 后再模拟
      res.focusState = read();
      // 键盘 Tab 到链接
      link.blur();
      document.body.focus();
      return res;
    });
    // 用真实键盘 Tab 到达第一个 src-link
    await page.evaluate(() => { document.body.setAttribute('tabindex', '-1'); document.body.focus(); });
    let found = false;
    let steps = [];
    for (let i = 0; i < 80 && !found; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const ae = document.activeElement;
        const it = ae && ae.closest ? ae.closest('.src-item') : null;
        return { tag: ae ? ae.tagName : null, cls: ae ? String(ae.className || '').slice(0, 20) : null, inSrcItem: !!it,
          itemOutline: it ? getComputedStyle(it).outlineStyle + ' ' + getComputedStyle(it).outlineWidth : null,
          linkOutline: getComputedStyle(ae).outlineStyle + ' ' + getComputedStyle(ae).outlineWidth };
      });
      steps.push(info);
      if (info.inSrcItem) { found = true; r.tabReachSrcItem = info; }
    }
    r.tabSteps = steps.length;
    // 模拟 :has() 不支持：把 :has 规则改为永不匹配（等价于浏览器丢弃整条规则）
    await page.addStyleTag({ content: '.src-item:has(.src-link:focus-visible){outline:none !important}' });
    r.withoutHas = await page.evaluate(() => {
      const ae = document.activeElement;
      const it = ae && ae.closest ? ae.closest('.src-item') : null;
      if (!it) return { err: 'focus moved' };
      return { itemOutline: getComputedStyle(it).outlineStyle + ' ' + getComputedStyle(it).outlineWidth,
        linkOutline: getComputedStyle(ae).outlineStyle + ' ' + getComputedStyle(ae).outlineWidth };
    });
    // 对照：用 :focus-within 兜底是否有环
    await page.addStyleTag({ content: '.src-item:focus-within{outline:2px solid rgb(255,0,0) !important;outline-offset:2px}' });
    r.withFocusWithin = await page.evaluate(() => {
      const ae = document.activeElement;
      const it = ae && ae.closest ? ae.closest('.src-item') : null;
      if (!it) return { err: 'focus moved' };
      return { itemOutline: getComputedStyle(it).outlineStyle + ' ' + getComputedStyle(it).outlineWidth + ' ' + getComputedStyle(it).outlineColor };
    });
    out.hasFocusRing = r;
    log('HASFOCUS ' + JSON.stringify(r));
    await ctx.close();
  }

  // ================= D5 主题按钮可识别性 =================
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '768x1024', w: 768, h: 1024 }, { n: '1024x800', w: 1024, h: 800 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const btn = document.getElementById('theme-toggle');
      if (!btn) return { err: 'no btn' };
      const b = btn.getBoundingClientRect();
      const ic = btn.querySelector('.theme-icon');
      const lbl = btn.querySelector('.lbl');
      const cs = getComputedStyle(btn);
      /* 视觉内容：图标与文字都 display:none 时，按钮内是否还有任何可见内容 */
      const visibleChildren = Array.from(btn.children).filter((c) => {
        const s = getComputedStyle(c);
        const r2 = c.getBoundingClientRect();
        return s.display !== 'none' && r2.width > 0 && r2.height > 0;
      }).map((c) => c.className);
      /* 按钮自身有没有边框/背景让它至少看起来像个控件 */
      return {
        w: +b.width.toFixed(1), h: +b.height.toFixed(1),
        iconDisplay: ic ? getComputedStyle(ic).display : null,
        lblDisplay: lbl ? getComputedStyle(lbl).display : null,
        visibleChildren,
        textContent: JSON.stringify((btn.textContent || '').trim()),
        ariaLabel: btn.getAttribute('aria-label'),
        title: btn.getAttribute('title'),
        border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
        background: cs.backgroundColor,
        color: cs.color,
        /* 与相邻顶栏按钮的间距，判断能否被认出是按钮 */
        gapToPrev: (() => { const p = btn.previousElementSibling; if (!p) return null; const pr = p.getBoundingClientRect(); return +(b.left - pr.right).toFixed(1); })(),
      };
    });
    out.themeBtn = out.themeBtn || [];
    out.themeBtn.push({ vp: vp.n, ...r });
    log('THEMEBTN ' + JSON.stringify({ vp: vp.n, ...r }));
    await ctx.close();
  }

  // ================= D6 200% 缩放等效视口 =================
  {
    out.zoom = [];
    for (const w of [320, 280, 256, 200, 160]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 640 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(NEW + '/', { waitUntil: 'load' });
      await page.waitForTimeout(350);
      const r = await page.evaluate(() => {
        const mq = window.matchMedia('(max-width:17.5em)').matches;
        /* 17.5em 在媒体查询里按初始字体大小 16px 算 → 280px；
           但如果用户设置了更大默认字号，em 会变。这里读 root font-size 与本查询的实测 */
        const list = document.querySelector('.src-list[data-depth="3"]');
        const cs = list ? getComputedStyle(list) : null;
        const tree = document.querySelector('.src-tree');
        return {
          vw: innerWidth,
          mqMatches: mq,
          rootFontPx: getComputedStyle(document.documentElement).fontSize,
          srcListPadLeft: cs ? cs.paddingLeft : null,
          srcTreePad: tree ? getComputedStyle(tree).paddingLeft + '/' + getComputedStyle(tree).paddingRight : null,
          docScrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
          overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          bodyScrollW: document.body.scrollWidth,
        };
      });
      r.testWidth = w;
      out.zoom.push(r);
      log('ZOOM ' + JSON.stringify(r));
      await ctx.close();
    }
  }

  // ================= D7 打印 / light / 残留 =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const probe = async () => page.evaluate(`(() => {
      ${CONTRAST}
      const get = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).color : null; };
      const bg = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).backgroundColor : null; };
      const toks = {
        keyword: get('.hljs-keyword'), string: get('.hljs-string'), title: get('.hljs-title'),
        comment: get('.hljs-comment'), number: get('.hljs-number'), builtin: get('.hljs-built_in'),
      };
      const codeBg = bg('.code-pre') || bg('.code-block') || bg('pre');
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const white = [255,255,255];
      const cb = _rgb(codeBg) || _rgb(bodyBg) || white;
      const out = { theme: document.documentElement.getAttribute('data-theme'), bodyBg, bodyColor: getComputedStyle(document.body).color, codeBg, codeText: get('.hljs') };
      out.onScreen = {}; out.onWhite = {}; out.onCodeBg = {};
      for (const k in toks) {
        if (!toks[k]) continue;
        const c = _rgb(toks[k]);
        out.onScreen[k] = c ? _ratio(c, cb) : null;
        out.onWhite[k] = c ? _ratio(c, white) : null;
      }
      out.raw = toks;
      out.hlVars = {};
      ['comment','keyword','string','number','title','builtin','variable','deletion'].forEach(function(n){
        out.hlVars[n] = getComputedStyle(document.documentElement).getPropertyValue('--hl-'+n).trim();
      });
      return out;
    })()`);
    out.print = {};
    out.print.screenDark = await probe();
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(300);
    out.print.printDark = await probe();
    await page.emulateMedia({ media: 'screen' });
    // light 显式
    await page.evaluate(() => document.getElementById('theme-toggle').click());  // auto→light
    await page.waitForTimeout(300);
    out.print.light = await probe();
    log('PRINT ' + JSON.stringify({ screenDark: out.print.screenDark.onScreen, printDark_onWhite: out.print.printDark.onWhite, printDark_onCodeBg: out.print.printDark.onScreen, light_onCodeBg: out.print.light.onScreen, printCodeBg: out.print.printDark.codeBg, screenCodeBg: out.print.screenDark.codeBg }));
    await ctx.close();
  }

  // ================= D8 拉伸链接行为 =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const item = document.querySelector('.src-item');
      const links = item.querySelectorAll('a');
      const sum = item.querySelector('.src-sum');
      const rel = item.querySelector('.src-rel');
      const ir = item.getBoundingClientRect();
      /* 命中扫描：整行宽度上每 2% 采一点 */
      const hits = [];
      for (let p = 0; p <= 100; p += 2) {
        const x = Math.round(ir.left + (ir.width * p) / 100);
        const el = document.elementFromPoint(x, Math.round(ir.top + ir.height / 2));
        let kind = 'other';
        if (el) {
          if (el.closest('.src-rel') === rel) kind = 'src-rel';
          else if (el.tagName === 'A' && el.classList.contains('src-link')) kind = 'src-link';
          else if (el === item) kind = 'src-item';
          else if (el.tagName === 'A') kind = 'other-link';
          else kind = el.tagName.toLowerCase();
        }
        hits.push(p + ':' + kind);
      }
      /* 第二链接存在性 */
      const secondLink = links.length > 1 ? { href: links[1].getAttribute('href'), text: (links[1].textContent || '').trim().slice(0, 20) } : null;
      /* ::after 归属 */
      const link = item.querySelector('.src-link');
      const afterContent = getComputedStyle(link, '::after').content;
      const afterPos = getComputedStyle(link, '::after').position;
      const afterInset = getComputedStyle(link, '::after').inset;
      /* 层叠：item 有 hover 背景，after 无 z-index → 同层按 DOM 顺序 */
      return {
        linkCount: links.length, secondLink,
        itemW: Math.round(ir.width), itemH: Math.round(ir.height),
        hits, afterContent, afterPos, afterInset,
        linkPos: getComputedStyle(link).position,
        itemZ: getComputedStyle(item).zIndex,
        afterZ: getComputedStyle(link, '::after').zIndex,
        relPE: getComputedStyle(rel).pointerEvents,
        sumPE: sum ? getComputedStyle(sum).pointerEvents : null,
      };
    });
    /* 真实右键：命中链接区 vs 摘要区 vs src-rel 区，看 contextmenu 目标 */
    const rc = async (frac) => page.evaluate((f) => {
      const item = document.querySelector('.src-item');
      const r2 = item.getBoundingClientRect();
      const x = Math.round(r2.left + r2.width * f);
      const y = Math.round(r2.top + r2.height / 2);
      const el = document.elementFromPoint(x, y);
      const a = el && el.closest ? el.closest('a') : null;
      return { frac: f, target: el ? el.tagName + '.' + String(el.className || '').split(' ')[0] : null, isLink: !!a, href: a ? a.getAttribute('href') : null, text: el ? (el.textContent || '').trim().slice(0, 24) : null };
    }, frac);
    const ctxTargets = [];
    for (const f of [0.05, 0.35, 0.6, 0.85, 0.97]) ctxTargets.push(await rc(f));
    r.contextTargets = ctxTargets;
    /* 真实选中：拖选摘要区 */
    r.dragSelect = await page.evaluate(() => {
      const sum = document.querySelector('.src-item .src-sum');
      if (!sum || !sum.firstChild || sum.firstChild.nodeType !== 3) return { err: 'no text node' };
      const range = document.createRange();
      range.selectNodeContents(sum);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      return { len: sel.toString().length, sample: sel.toString().slice(0, 30) };
    });
    out.stretch = r;
    log('STRETCH ' + JSON.stringify({ linkCount: r.linkCount, second: r.secondLink, itemW: r.itemW, hits: r.hits.join(' '), ctx: r.contextTargets.map((t) => t.frac + ':' + t.target + (t.isLink ? '/LINK' : '')), dragSelect: r.dragSelect }));
    /* 鼠标真实拖选（会命中 ::after → 应选中 0 字符） */
    const box = await page.evaluate(() => {
      const s = document.querySelector('.src-item .src-sum').getBoundingClientRect();
      return { x: s.left, y: s.top + s.height / 2, w: Math.min(s.width, 400) };
    });
    await page.mouse.move(box.x + 4, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w - 6, box.y, { steps: 12 });
    await page.mouse.up();
    out.stretch.realDrag = await page.evaluate(() => {
      const s = window.getSelection();
      return { text: s ? s.toString().slice(0, 40) : null, len: s ? s.toString().length : 0 };
    });
    log('DRAG ' + JSON.stringify(out.stretch.realDrag));
    await ctx.close();
  }

  // ================= D9 渐隐条到最右 =================
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const r = await page.evaluate(async () => {
      /* 找最宽的溢出代码块 */
      const hosts = Array.from(document.querySelectorAll('.code-scroll'));
      let best = null;
      for (const h of hosts) {
        if (h.scrollWidth > h.clientWidth + 1) { if (!best || h.scrollWidth - h.clientWidth > best.scrollWidth - best.clientWidth) best = h; }
      }
      if (!best) return { err: 'no overflowing' };
      const read = () => {
        const cs = getComputedStyle(best, '::after');
        const br = best.getBoundingClientRect();
        return {
          scrollLeft: Math.round(best.scrollLeft),
          maxScroll: Math.round(best.scrollWidth - best.clientWidth),
          afterContent: cs.content, afterWidth: cs.width, afterRight: cs.right,
          afterBg: cs.backgroundImage.slice(0, 60),
          afterOpacity: cs.opacity,
          ratio: +(best.scrollWidth / best.clientWidth).toFixed(2),
          boxRight: Math.round(br.right),
        };
      };
      const at0 = read();
      best.scrollLeft = best.scrollWidth;
      await new Promise((rr) => setTimeout(rr, 200));
      const atMax = read();
      /* 右端字符是否被渐隐压住：取右侧 24px 内是否有文本 */
      const br = best.getBoundingClientRect();
      const el = document.elementFromPoint(Math.round(br.right) - 6, Math.round(br.top + br.height / 2));
      return { at0, atMax, hitAtRightEdge: el ? el.tagName + '.' + String(el.className || '').split(' ')[0] : null,
        dataOverflowing: best.hasAttribute('data-overflowing') };
    });
    out.fade = r;
    log('FADE ' + JSON.stringify(r));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-d.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-d.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-d.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
