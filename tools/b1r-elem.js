'use strict';
/**
 * b1r-elem.js — 元素级归因 + P0-3 命中区实测 + P0-4 拉伸链接的副作用 + :has() 可用性
 * 用法: node tools/b1r-elem.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';

const lines = [];
const LOGP = path.join(__dirname, '..', 'reports', '.b1r-elem.log');
const log = (s) => {
  lines.push(s);
  try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {}
  console.log(s);
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = {};

  // ---------- 1) 元素级归因：768 档 particles 的 pageHeight +1235 从哪来 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const snap = async (base) => {
      await page.goto(base + '/paper/dev/particles/', { waitUntil: 'load' });
      await page.waitForTimeout(400);
      return page.evaluate(() => {
        const g = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().height) : null; };
        return {
          docH: Math.round(document.documentElement.scrollHeight),
          topbar: g('.topbar'), content: g('.content'), article: g('.article'),
          toc: g('.toc-side'), tocOl: g('.toc-side > details > ol'),
          codeBlocks: Array.from(document.querySelectorAll('.code-block')).reduce((a, e) => a + e.getBoundingClientRect().height, 0),
          tables: Array.from(document.querySelectorAll('.table-wrap')).reduce((a, e) => a + e.getBoundingClientRect().height, 0),
          paras: Array.from(document.querySelectorAll('.article p')).reduce((a, e) => a + e.getBoundingClientRect().height, 0),
          lists: Array.from(document.querySelectorAll('.article li')).reduce((a, e) => a + e.getBoundingClientRect().height, 0),
          h2h3: Array.from(document.querySelectorAll('.article h2, .article h3')).reduce((a, e) => a + e.getBoundingClientRect().height, 0),
          bodyFont: getComputedStyle(document.querySelector('.article p') || document.body).fontSize,
          contentW: Math.round(document.querySelector('.content').getBoundingClientRect().width),
          topbarH: getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'),
        };
      });
    };
    const n = await snap(NEW); const o = await snap(OLD);
    out.attrib768 = { new: n, old: o };
    log('ATTRIB768 new=' + JSON.stringify(n));
    log('ATTRIB768 old=' + JSON.stringify(o));
    await ctx.close();
  }

  // ---------- 2) P0-3 命中区实测（.side-home / .code-copy），多断点 ----------
  {
    out.hit = [];
    for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1280x800', w: 1280, h: 800 }, { n: '1025x800', w: 1025, h: 800 }, { n: '1024x800', w: 1024, h: 800 }, { n: '768x1024', w: 768, h: 1024 }, { n: '390x844', w: 390, h: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
        await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load' });
        await page.waitForTimeout(200);
        const r = await page.evaluate(() => {
          const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
          const homes = Array.from(document.querySelectorAll('a.side-home'));
          const copies = Array.from(document.querySelectorAll('.code-copy'));
          // 相邻可点目标的最小间距（WCAG 2.5.8 spacing 例外用）
          let minGap = null;
          for (let i = 1; i < homes.length; i++) {
            const a = homes[i - 1].getBoundingClientRect(), b = homes[i].getBoundingClientRect();
            const gap = Math.abs(b.top - a.bottom);
            if (!minGap || gap < minGap) minGap = +gap.toFixed(1);
          }
          const covered = homes.length ? (() => {
            const h = homes[0].getBoundingClientRect();
            const cx = h.left + h.width / 2, cy = h.top + h.height / 2;
            const el = document.elementFromPoint(cx, cy);
            return el ? (el.className || el.tagName) + '' : null;
          })() : null;
          return {
            homeCount: homes.length,
            homeSample: homes.slice(0, 3).map(box),
            homeMin: homes.length ? homes.reduce((m, e) => { const b = e.getBoundingClientRect(); return { w: Math.min(m.w, +b.width.toFixed(1)), h: Math.min(m.h, +b.height.toFixed(1)) }; }, { w: 1e9, h: 1e9 }) : null,
            copyCount: copies.length,
            copyMin: copies.length ? copies.reduce((m, e) => { const b = e.getBoundingClientRect(); return { w: Math.min(m.w, +b.width.toFixed(1)), h: Math.min(m.h, +b.height.toFixed(1)) }; }, { w: 1e9, h: 1e9 }) : null,
            homeVerticalGap: minGap,
            homeHitTargetAtCenter: covered,
          };
        });
        r.vp = vp.n; r.tag = tag;
        out.hit.push(r);
        log('HIT ' + JSON.stringify(r));
      }
      await ctx.close();
    }
  }

  // ---------- 3) P0-4 拉伸链接：文字可选中性 / 右键菜单 / 命中测试 ----------
  {
    out.stretch = [];
    for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '390x844', w: 390, h: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(NEW + '/index.html', { waitUntil: 'load' });
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const item = document.querySelector('.src-item');
        if (!item) return { error: 'no src-item' };
        const sum = item.querySelector('.src-sum');
        const rel = item.querySelector('.src-rel');
        const link = item.querySelector('.src-link');
        const box = (e) => { const b = e.getBoundingClientRect(); return { t: Math.round(b.top), l: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) }; };
        // 关键：摘要文本中心点命中的是谁
        let hitSum = null, hitRel = null;
        if (sum) {
          const b = sum.getBoundingClientRect();
          const el = document.elementFromPoint(b.left + Math.min(40, b.width / 2), b.top + b.height / 2);
          hitSum = el ? (el.tagName + '.' + (el.className || '')) : null;
        }
        if (rel) {
          const b = rel.getBoundingClientRect();
          const el = document.elementFromPoint(b.left + 10, b.top + b.height / 2);
          hitRel = el ? (el.tagName + '.' + (el.className || '')) : null;
        }
        // Range 选择测试：能否选中摘要文字
        let selectable = null, selectedText = null;
        if (sum && sum.firstChild) {
          const range = document.createRange();
          try {
            range.selectNodeContents(sum);
            const sel = window.getSelection();
            sel.removeAllRanges(); sel.addRange(range);
            selectedText = (sel.toString() || '').slice(0, 40);
            selectable = selectedText.length > 0;
            sel.removeAllRanges();
          } catch (e) { selectable = 'ERR:' + e.message; }
        }
        return {
          itemBox: box(item), linkBox: box(link), sumBox: sum ? box(sum) : null, relBox: rel ? box(rel) : null,
          sumPointerEvents: sum ? getComputedStyle(sum).pointerEvents : null,
          relPointerEvents: rel ? getComputedStyle(rel).pointerEvents : null,
          linkPosition: getComputedStyle(link).position,
          afterInset: getComputedStyle(link, '::after').inset,
          afterContent: getComputedStyle(link, '::after').content,
          hitTestAtSummaryCenter: hitSum,
          hitTestAtRelCenter: hitRel,
          summaryTextSelectableViaRange: selectable,
          selectedTextSample: selectedText,
          linkCountInItem: item.querySelectorAll('a').length,
        };
      });
      // 真实鼠标拖选：从摘要中间拖到右边
      let dragSel = null;
      try {
        if (r.sumBox) {
          const y = r.sumBox.t + Math.floor(r.sumBox.h / 2);
          await page.mouse.move(r.sumBox.l + 5, y);
          await page.mouse.down();
          await page.mouse.move(r.sumBox.l + Math.min(r.sumBox.w - 5, 200), y, { steps: 8 });
          await page.mouse.up();
          dragSel = await page.evaluate(() => (window.getSelection() || { toString: () => '' }).toString().slice(0, 60));
        }
      } catch (e) { dragSel = 'ERR:' + e.message; }
      r.vp = vp.n; r.realDragSelectedText = dragSel;
      out.stretch.push(r);
      log('STRETCH ' + JSON.stringify(r));
      await ctx.close();
    }
  }

  // ---------- 4) :has() 可用性 + 降级后文字提示是否消失 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    out.hasSupport = await page.evaluate(() => {
      const supportsHas = typeof CSS !== 'undefined' && CSS.supports ? (CSS.supports('selector(:has(> a))') || CSS.supports('selector(:has(a))')) : 'no-CSS.supports';
      // 统计有 data-overflowing 的代码块 + 是否显示了 ::after 文字
      const scrolls = Array.from(document.querySelectorAll('.code-scroll'));
      const over = scrolls.filter((s) => s.hasAttribute('data-overflowing')).length;
      const titles = Array.from(document.querySelectorAll('.code-block .code-title'));
      const withHint = titles.filter((t) => {
        const cs = getComputedStyle(t, '::after');
        return cs && cs.content && cs.content !== 'none' && cs.content !== 'normal';
      }).length;
      const fade = scrolls.filter((s) => {
        const cs = getComputedStyle(s, '::after');
        return cs && cs.content === '""' || (cs && cs.backgroundImage && cs.backgroundImage !== 'none');
      }).length;
      return { supportsHas, codeScrolls: scrolls.length, overflowingMarked: over, titlesTotal: titles.length, titlesWithAfterHint: withHint, scrollsWithFade: fade };
    });
    log('HAS ' + JSON.stringify(out.hasSupport));

    // 模拟不支持 :has() 的浏览器：把带 :has 的规则剥掉后，提示是否消失
    await page.addStyleTag({ content: '.code-block .code-title::after{content:none !important}' });
    await page.waitForTimeout(150);
    out.hasSupport.hintIfHasDropped = await page.evaluate(() => {
      const titles = Array.from(document.querySelectorAll('.code-block .code-title'));
      return titles.filter((t) => { const cs = getComputedStyle(t, '::after'); return cs.content && cs.content !== 'none' && cs.content !== 'normal'; }).length;
    });
    // 渐隐条仍在？
    out.hasSupport.fadeStillPresent = await page.evaluate(() => {
      const s = document.querySelector('.code-scroll[data-overflowing]');
      if (!s) return 'no-overflow-scroll';
      const cs = getComputedStyle(s, '::after');
      return { content: cs.content, bgImage: cs.backgroundImage.slice(0, 60), pointerEvents: cs.pointerEvents, position: cs.position };
    });
    log('HAS-2 ' + JSON.stringify(out.hasSupport));
    await ctx.close();
  }

  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-elem.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-elem.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE');
})();
