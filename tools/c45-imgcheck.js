'use strict';
/**
 * c45-imgcheck.js — 逐张核对 dialogs 页的 content-img：文件头解析值 vs HTML 属性值 vs 文件字节数。
 * 目的是查清浏览器里 naturalWidth=0 的那张图（是文件坏了，还是只是没解码）。
 * 用法: node tools/c45-imgcheck.js [--page=paper/dev/dialogs/index.html]
 */
const fs = require('fs');
const path = require('path');
const { readImageSize } = require('./build-site.js');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const PAGE = opt('page', 'paper/dev/dialogs/index.html');

const absHtml = path.join(ROOT, PAGE);
const html = fs.readFileSync(absHtml, 'utf8');
const dir = path.dirname(absHtml);

const rows = [];
for (const m of html.matchAll(/<img\b[^>]*>/g)) {
  const tag = m[0];
  const src = (tag.match(/\ssrc="([^"]*)"/) || [])[1];
  if (!src) continue;
  const cls = (tag.match(/\sclass="([^"]*)"/) || [])[1] || '';
  const aw = (tag.match(/\swidth="(\d+)"/) || [])[1] || null;
  const ah = (tag.match(/\sheight="(\d+)"/) || [])[1] || null;
  const abs = path.resolve(dir, src.split('#')[0].split('?')[0]);
  let header = null, bytes = null, magic = null;
  if (fs.existsSync(abs)) {
    const buf = fs.readFileSync(abs);
    bytes = buf.length;
    magic = buf.subarray(0, 16).toString('hex').replace(/(.{8})/g, '$1 ').trim();
    header = readImageSize(buf);
  }
  rows.push({
    file: path.basename(abs),
    cls, src: src.slice(-58),
    exists: fs.existsSync(abs), bytes, magic,
    header: header ? header.w + 'x' + header.h : null,
    format: header ? header.format : null,
    attr: aw && ah ? aw + 'x' + ah : null,
    match: header && aw && ah ? (String(header.w) === aw && String(header.h) === ah) : null,
  });
}

let bad = 0;
for (const r of rows) {
  if (!r.exists || !r.header || r.match === false) bad++;
  console.log((r.match === true ? 'OK  ' : 'BAD ')
    + String(r.header).padEnd(12) + 'attr=' + String(r.attr).padEnd(12)
    + 'bytes=' + String(r.bytes).padEnd(8) + r.file);
  if (!r.exists || !r.header) console.log('      magic=' + r.magic + '  exists=' + r.exists + '  fmt=' + r.format);
}
console.log('\nrows=' + rows.length + ' problems=' + bad);
