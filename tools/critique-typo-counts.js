// counts heading / element structure in built HTML (static check, complements measure.json)
const fs = require('fs');
const path = require('path');

const pages = [
  'paper/reference/world-configuration/index.html',
  'paper/dev/dialogs/index.html',
  'velocity/tuning/index.html',
  'index.html',
  'all-pages.html',
];

function strip(html) {
  // isolate <article class="article" ...> ... </article>
  const m = html.match(/<article[^>]*class="[^"]*\barticle\b[^"]*"[^>]*>([\s\S]*?)<\/article>/);
  return m ? m[1] : '';
}

for (const rel of pages) {
  const p = path.join(process.cwd(), rel);
  if (!fs.existsSync(p)) { console.log('MISSING', rel); continue; }
  const html = fs.readFileSync(p, 'utf8');
  const art = strip(html);
  const cnt = (s, re) => (s.match(re) || []).length;
  console.log('== ' + rel + '  articleChars=' + art.length);
  for (const lv of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    console.log('   <' + lv + '>=' + cnt(art, new RegExp('<' + lv + '[\\s>]', 'g')));
  }
  console.log('   p=' + cnt(art, /<p[\s>]/g) + ' pre=' + cnt(art, /<pre[\s>]/g) + ' table=' + cnt(art, /<table[\s>]/g) + ' ul=' + cnt(art, /<ul[\s>]/g) + ' img=' + cnt(art, /<img[\s>]/g));
}
