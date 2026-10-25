'use strict';
/* cr2vn-region.js — 区域占比 / pill 归属 / H1 三尺寸 / 1440 单视口字号并集  只读 */
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright-core');
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = argOf('--base', 'http://127.0.0.1:8787');
const PAGES = [
  { name: 'landing', url: '/' }, { name: 'section-paper', url: '/paper/' },
  { name: 'content-callout-code', url: '/paper/dev/dialogs/' },
  { name: 'reference-longpage', url: '/paper/reference/world-configuration/' },
  { name: 'content-tuning', url: '/velocity/tuning/' }, { name: 'index-allpages', url: '/all-pages.html' }
];
function findChrome() {
  const c = []; if (process.env.CHROME_PATH) c.push(process.env.CHROME_PATH);
  const lad = process.env.LOCALAPPDATA;
  if (lad) { const m = path.join(lad, 'ms-playwright');
    if (fs.existsSync(m)) for (const d of fs.readdirSync(m)) if (/^chromium/.test(d)) { c.push(path.join(m, d, 'chrome-win64', 'chrome.exe')); c.push(path.join(m, d, 'chrome-win', 'chrome.exe')); } }
  c.push(path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return c.find(x => x && fs.existsSync(x)) || null;
}
function probe() {
  function clsOf(el){const c=el.className; if(typeof c==='string')return c.trim(); if(c&&typeof c.baseVal==='string')return c.baseVal.trim(); return '';}
  function regionOf(el){ if(el.closest('.topbar'))return 'topbar'; if(el.closest('.sidebar'))return 'sidebar';
    if(el.closest('.toc-side'))return 'toc'; if(el.closest('main.content'))return 'content'; return 'other'; }
  function vis(el,cs,r){ if(cs.display==='none'||cs.visibility==='hidden')return false; if(parseFloat(cs.opacity)===0)return false;
    if(r.width<=0||r.height<=0)return false; if(r.right<=0.5||r.bottom<=0.5)return false;
    if(el.classList&&(el.classList.contains('skip')||el.classList.contains('nav-scrim')))return false; return true; }
  const inc=(o,k)=>{o[k]=(o[k]||0)+1;};
  const regEl=Object.create(null), regPill=Object.create(null), regBorder=Object.create(null), regArea=Object.create(null);
  const pillsBySel=Object.create(null), h1s=[], statVSh2=[];
  const textOwners=new Set();
  const tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null); let t=tw.nextNode();
  while(t){ if(t.nodeValue&&t.nodeValue.trim()){const p=t.parentElement; if(p&&p!==document.body) textOwners.add(p);} t=tw.nextNode(); }
  const sizes=new Set();
  let total=0;
  for(const el of Array.from(document.body.querySelectorAll('*'))){
    const cs=getComputedStyle(el), r=el.getBoundingClientRect();
    if(!vis(el,cs,r))continue;
    total++;
    const reg=regionOf(el);
    inc(regEl,reg); regArea[reg]=(regArea[reg]||0)+r.width*r.height;
    if(textOwners.has(el)) sizes.add(Math.round(parseFloat(cs.fontSize)*100)/100);
    const rmax=Math.max(parseFloat(cs.borderTopLeftRadius)||0,parseFloat(cs.borderTopRightRadius)||0);
    let sides=0;
    for(const S of ['Top','Right','Bottom','Left']){const bw=parseFloat(cs['border'+S+'Width'])||0;
      if(bw>0&&cs['border'+S+'Style']!=='none')sides++;}
    if(sides>0)inc(regBorder,reg);
    if(rmax>=900){ inc(regPill,reg); inc(pillsBySel,reg+'|'+clsOf(el).split(/\s+/)[0]||'anon'); }
  }
  for(const h of Array.from(document.querySelectorAll('h1'))){
    const cs=getComputedStyle(h), r=h.getBoundingClientRect();
    h1s.push({sig:h.tagName.toLowerCase()+'.'+(clsOf(h).split(/\s+/)[0]||''),fs:Math.round(parseFloat(cs.fontSize)*100)/100,fw:parseInt(cs.fontWeight,10)||400,text:(h.textContent||'').trim().slice(0,24)||'(empty)'});
  }
  for(const el of Array.from(document.querySelectorAll('.stat b, .section-head h2, .article h2'))){
    const cs=getComputedStyle(el);
    statVSh2.push({sig:el.tagName.toLowerCase()+'.'+(clsOf(el).split(/\s+/)[0]||'')+'/'+(el.parentElement?clsOf(el.parentElement).split(/\s+/)[0]:''),
      fs:Math.round(parseFloat(cs.fontSize)*100)/100,fw:parseInt(cs.fontWeight,10)||400,text:(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,16)});
  }
  const T=o=>Object.keys(o).sort((a,b)=>o[b]-o[a]).map(k=>({k:k,v:o[k]}));
  return {ok:true,total:total,regionEl:regEl,regionBorder:regBorder,regionPill:regPill,
    regionArea:regArea,pillsBySel:T(pillsBySel),
    sizes1440:Array.from(sizes).sort((a,b)=>b-a),sizeCount:sizes.size,h1s:h1s,statVSh2:statVSh2};
}
(async()=>{
  const exe=findChrome();
  const b=await chromium.launch({executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage']});
  const ctx=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const page=await ctx.newPage();
  const out={results:[]};
  for(const p of PAGES){
    try{ await page.goto(BASE.replace(/\/$/,'')+p.url,{waitUntil:'load',timeout:45000}); await page.waitForTimeout(80);
      const d=await page.evaluate(probe,{});
      out.results.push(Object.assign({page:p.name},d));
      console.log(p.name+' total='+d.total+' sizes='+d.sizeCount+' regionEl='+JSON.stringify(d.regionEl)+' pills='+JSON.stringify(d.regionPill));
      console.log('   H1: '+d.h1s.map(h=>h.fs+'px/'+h.fw+' '+h.sig).join(' | '));
    }catch(e){ console.log('FAIL '+p.name+' '+e.message); }
  }
  await b.close();
  const f=path.join(os.tmpdir(),'cr2vn-region.json');
  fs.writeFileSync(f,JSON.stringify(out,null,1),'utf8');
  console.log('WROTE '+f);
})();
