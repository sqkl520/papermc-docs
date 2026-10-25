'use strict';
/* cr2vn-nav.js — 侧栏/正文的"行密度"实测（只读） */
const fs=require('fs'),os=require('os'),path=require('path');
const {chromium}=require('playwright-core');
const argOf=(n,d)=>{const i=process.argv.indexOf(n);return i>-1&&process.argv[i+1]?process.argv[i+1]:d;};
const BASE=argOf('--base','http://127.0.0.1:8787');
function findChrome(){const c=[];if(process.env.CHROME_PATH)c.push(process.env.CHROME_PATH);
 const lad=process.env.LOCALAPPDATA;if(lad){const m=path.join(lad,'ms-playwright');
 if(fs.existsSync(m))for(const d of fs.readdirSync(m))if(/^chromium/.test(d)){c.push(path.join(m,d,'chrome-win64','chrome.exe'));c.push(path.join(m,d,'chrome-win','chrome.exe'));}}
 c.push(path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));return c.find(x=>x&&fs.existsSync(x))||null;}
function probe(){
  function h(el){if(!el)return null;const r=el.getBoundingClientRect();return r.height>0?Math.round(r.height*10)/10:null;}
  const links=Array.from(document.querySelectorAll('.sidebar .side-sec a, .sidebar .side-group a, .sidebar .side-cat a'));
  const hs=links.map(l=>Math.round(l.getBoundingClientRect().height*10)/10).filter(x=>x>0);
  const uniq=[...new Set(hs)].sort((a,b)=>a-b);
  const freq={};for(const x of hs)freq[x]=(freq[x]||0)+1;
  // 相邻行间距（视觉节奏）
  const gaps=[];
  for(let i=1;i<links.length;i++){const a=links[i-1].getBoundingClientRect(),b=links[i].getBoundingClientRect();
    if(b.top>=a.top-1) gaps.push(Math.round((b.top-a.bottom)*10)/10);}
  const gset=[...new Set(gaps)].sort((a,b)=>a-b);
  const body=document.body,p=document.querySelector('.article p')||document.querySelector('main.content p');
  const csP=p?getComputedStyle(p):null;
  return {ok:true,
    sidebarLinkCount:links.length,
    sidebarRowHeights:uniq, sidebarRowFreq:freq,
    sidebarMinRow:uniq.length?uniq[0]:null, sidebarMaxRow:uniq.length?uniq[uniq.length-1]:null,
    sidebarGaps:gset,
    bodyLineHeight:csP?parseFloat(csP.lineHeight):null, bodyFontSize:csP?parseFloat(csP.fontSize):null,
    bodyLH:csP?csP.lineHeight:null,
    paraMarginBottom:csP?parseFloat(csP.marginBottom):null,
    tocRowH:h(document.querySelector('.toc-side a')),
    topbarH:h(document.querySelector('.topbar')),
    statH:h(document.querySelector('.stat')),
    entryCardH:h(document.querySelector('.entry-card'))};
}
(async()=>{
 const exe=findChrome();const b=await chromium.launch({executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const vp of [{l:'1440x900',w:1440,h:900},{l:'1280x800',w:1280,h:800},{l:'390x844',w:390,h:844}]){
  const ctx=await b.newContext({viewport:{width:vp.w,height:vp.h},deviceScaleFactor:1});
  const page=await ctx.newPage();
  await page.goto(BASE+'/paper/dev/dialogs/',{waitUntil:'load',timeout:45000});
  await page.waitForTimeout(80);
  const d=await page.evaluate(probe,{});
  console.log(vp.l+' '+JSON.stringify(d,null,1));
  await ctx.close();
 }
 await b.close();
})();
