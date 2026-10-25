'use strict';
/**
 * c5-scan.js — C5 的定点文本扫描器（避免 PowerShell 控制台编码问题）
 * 用法: node tools/c5-scan.js
 * 读取 tools/c5-tokens.json 的 token 列表；扫描 tools/site/*.js
 * 输出 UTF-8 JSON 到 reports/.c5-scan.json
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const FILES = ['tools/site/assets.js', 'tools/site/layout.js', 'tools/site/render.js', 'tools/site/nav.js', 'tools/site/util.js', 'tools/site/search.js'];
const tokens = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'c5-tokens.json'), 'utf8'));

const out = [];
for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const txt = fs.readFileSync(p, 'utf8');
  const lines = txt.split('\n');
  for (const tok of tokens) {
    let count = 0;
    const hits = [];
    lines.forEach((line, i) => {
      let idx = -1;
      while ((idx = line.indexOf(tok, idx + 1)) !== -1) {
        count++;
        if (hits.length < 8) hits.push({ line: i + 1, ctx: line.trim().slice(0, 300) });
      }
    });
    if (count > 0) out.push({ file: rel, token: tok, count, hits });
  }
}
fs.writeFileSync(path.join(ROOT, 'reports', '.c5-scan.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('scanned ' + FILES.length + ' files, ' + tokens.length + ' tokens, ' + out.length + ' hit-groups; -> reports/.c5-scan.json');
