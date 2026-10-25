'use strict';
/* cr2vn-heights.js — 页高与"同一字号承担两种角色"的证据（只读） */
const fs=require('fs'),os=require('os'),path=require('path');
const A=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'cr2vn2-after.json'),'utf8'));
const B=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'cr2vn2-before.json'),'utf8'));
const pick=(ds,vp,pg)=>ds.results.find(r=>r.vp===vp&&r.page===pg&&r.ok);
console.log('## 页高 before -> after');
console.log('| 视口 | 页面 | before | after | Δ |');
console.log('|---|---|---:|---:|---:|');
for(const vp of ['1440x900','768x1024','390x844'])for(const p of A.pages.map(x=>x.name)){
  const a=pick(A,vp,p),b=pick(B,vp,p);if(!a||!b)continue;
  const d=a.docHeight-b.docHeight;
  if(Math.abs(d)>50)console.log('| '+vp+' | '+p+' | '+b.docHeight+' | '+a.docHeight+' | '+(d>0?'+':'')+d+' |');
}
console.log('');
console.log('## 21.6px 承担了哪些角色（landing 1440）');
const L=pick(A,'1440x900','landing');
const f=L.fontSizes.find(x=>x.size===21.6);
if(f)console.log(JSON.stringify(f,null,1));
console.log('');
console.log('## 13.x 密集带（≤0.8px 差距、却各占一档）');
const near=L.fontSizes.filter(x=>x.size>=13.4&&x.size<=14.5).map(x=>x.size+'px×'+x.n+' ['+x.sigs.slice(0,2).map(s=>s.k).join(',')+']');
console.log(near.join('\n'));
