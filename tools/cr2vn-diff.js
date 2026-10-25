'use strict';
/* cr2vn-diff.js — 逐页字号/颜色集合差异（before vs after），只读 */
const fs=require('fs'),os=require('os'),path=require('path');
const A=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'cr2vn2-after.json'),'utf8'));
const B=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'cr2vn2-before.json'),'utf8'));
const pick=(ds,vp,pg)=>ds.results.find(r=>r.vp===vp&&r.page===pg&&r.ok);
for(const vp of ['1440x900','390x844']){
  for(const p of A.pages.map(x=>x.name)){
    const a=pick(A,vp,p),b=pick(B,vp,p);
    if(!a||!b)continue;
    const sa=new Map(a.fontSizes.map(f=>[f.size,f])), sb=new Map(b.fontSizes.map(f=>[f.size,f]));
    const added=[...sa.keys()].filter(k=>!sb.has(k)).sort((x,y)=>y-x);
    const removed=[...sb.keys()].filter(k=>!sa.has(k)).sort((x,y)=>y-x);
    if(!added.length&&!removed.length)continue;
    console.log(vp+' '+p+'  '+b.fontSizes.length+' -> '+a.fontSizes.length);
    for(const k of added){const f=sa.get(k);console.log('   + '+k+'px x'+f.n+'  '+f.sigs.slice(0,3).map(s=>s.k+'x'+s.v).join(', ')+'  ['+Object.keys(f.region).join(',')+']');}
    for(const k of removed){const f=sb.get(k);console.log('   - '+k+'px x'+f.n+'  '+f.sigs.slice(0,3).map(s=>s.k+'x'+s.v).join(', '));}
  }
}
