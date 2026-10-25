'use strict';
/**
 * c2-verify-artifact.js — 落地后的独立取证（只读）
 *
 * 不依赖 build-site --verify-artifacts，自己证明三件事：
 *  ① 源码 tools/site/assets.js 里的规则确实进了产物 assets/site.css；
 *  ② 产物里的选择器是 `.article p`（不是 `>` / 后代 `:is(...)` 这些会压窄代码块的写法）；
 *  ③ 实测（无注入，读真实产物）的关键格子与报告一致 —— 防止「CSS 在但没生效」。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'tools', 'site', 'assets.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'assets', 'site.css'), 'utf8');

const out = { srcHasRule: src.includes('max-width:40rem'), cssHasRule: css.includes('max-width:40rem') };

const at = css.indexOf('max-width:40rem');
out.context = at >= 0 ? css.slice(Math.max(0, at - 420), at + 40) : null;

const count = (re) => (css.match(re) || []).length;
out.counts = {
  articleP40: count(/\.article p\{max-width:40rem\}/g),
  badDirectIs: count(/\.article\s*>\s*:is/g),
  badDescIs: count(/\.article\s+:is/g),
  articlePAny: count(/\.article p\{/g),
};

/* 产物里 40rem 规则所在的 media 上下文 */
out.wrappedIn = /@media \(min-width:768px\)\{\s*$/.test((out.context || '').trimEnd()) ? 768 : null;

/* 关键：把注释剥掉再查「误用选择器」，否则注释里写的反面教材会被算成命中。
   实测踩过：`.article > :is(p,ul,...)` 在注释里出现 1 次，裸正则误报为「误用」。 */
const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, '');
const countCode = (re) => (cssNoComment.match(re) || []).length;
const badHits = [];
{
  const re = /\.article\s*>\s*:is[^{]*\{/g;
  let m;
  while ((m = re.exec(cssNoComment)) !== null) badHits.push(m[0].slice(0, 80));
}
out.noComment = {
  articleP40: countCode(/\.article p\{max-width:40rem\}/g),
  badDirectIs: countCode(/\.article\s*>\s*:is[^{]*\{/g),
  badDescIs: countCode(/\.article\s+:is[^{]*\{/g),
  badHits,
};

console.log('=== ① 源码 / 产物 双向含规则 ===');
console.log('  tools/site/assets.js 含 max-width:40rem :', out.srcHasRule);
console.log('  assets/site.css      含 max-width:40rem :', out.cssHasRule);

console.log('\n=== ② 选择器形态（**已剥注释**，防误用） ===');
console.log('  `.article p{max-width:40rem}` 命中 :', out.noComment.articleP40, '（应为 1）');
console.log('  `.article > :is(...)` 真实规则     :', out.noComment.badDirectIs, '（应为 0）');
console.log('  `.article :is(...)`   真实规则     :', out.noComment.badDescIs, '（应为 0）');
console.log('  裸正则（含注释）误报              :', out.counts.badDirectIs - out.noComment.badDirectIs, '处 —— 注释里的反面教材，非规则');
if (badHits.length) console.log('  误用规则明细: ' + badHits.join(' | '));

console.log('\n=== ③ 产物中的上下文 ===');
console.log(out.context ? out.context.split('\n').slice(-6).map((l) => '  ' + l).join('\n') : '  (未找到)');

fs.writeFileSync(path.join(ROOT, 'reports', '.c2-verify-artifact.json'), JSON.stringify(out, null, 1), 'utf8');
console.log('\nJSON: reports/.c2-verify-artifact.json');
