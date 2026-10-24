'use strict';
// 深色模式下面板/边框的相对亮度差 + 3:1 边框候选（纯计算）
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const hex = (h) => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const ratio = (a, b) => { const l1 = lum(hex(a)), l2 = lum(hex(b)); return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100; };

console.log('--- 深色面板可见度（相对 body #14161a）---');
for (const [name, c] of [['code-bg #171a1f', '#171a1f'], ['bg-soft #191c21', '#191c21'], ['bg-elev #20242b', '#20242b'], ['border #2a2f38', '#2a2f38'], ['border-strong #3a414d', '#3a414d'], ['候选 #1c2129', '#1c2129'], ['候选 #1e232b', '#1e232b'], ['候选 #212630', '#212630']]) {
  console.log('  ' + name.padEnd(22) + ratio(c, '#14161a') + ':1');
}
console.log('');
console.log('--- 浅色面板可见度（相对 #ffffff）---');
for (const [name, c] of [['code-bg #fbfbfd', '#fbfbfd'], ['bg-soft #f7f8fa', '#f7f8fa'], ['bg-elev #f2f3f7', '#f2f3f7'], ['border #e2e5ea', '#e2e5ea'], ['border-strong #cdd2da', '#cdd2da']]) {
  console.log('  ' + name.padEnd(22) + ratio(c, '#ffffff') + ':1');
}
console.log('');
console.log('--- 3:1 边框候选（白底 / 深底）---');
for (const c of ['#8b919c', '#949aa6', '#767d8a', '#6b7280', '#a0a6b0']) console.log('  ' + c + ' on #ffffff = ' + ratio(c, '#ffffff') + ':1');
for (const c of ['#4a5261', '#525b6b', '#5b6474', '#3f4653']) console.log('  ' + c + ' on #14161a = ' + ratio(c, '#14161a') + ':1');
console.log('');
console.log('--- hljs light 修色候选 ---');
for (const c of ['#3f8f4f', '#357a44', '#2f7239', '#33753f']) console.log('  string ' + c + ' on #fbfbfd = ' + ratio(c, '#fbfbfd') + ':1');
for (const c of ['#b06f00', '#965d00', '#8a5600', '#9a6000']) console.log('  built_in ' + c + ' on #fbfbfd = ' + ratio(c, '#fbfbfd') + ':1');
