'use strict';
/* cr2vn-emoji.js — 核实 em 复合字号的父级链（只读） */
const fs=require('fs'),os=require('os'),path=require('path');
const {chromium}=require('playwright-core');
const argOf=(n,d)=>{const i=process.argv.indexOf(n);return i>-1&&process.argv[i+1]?process.argv[i+1]:d;};
const BASE=argOf('--base','http://127.0.0.1:8787');
function findChrome(){const c=[];if(process.env.CHROME_PATH)c.push(process.env.CHROME_PATH);
 const lad=process.env.LOCALAPPDATA;if(lad){const m=path.join(lad,'ms-playwright');
 if(fs.existsSync(m))for(const d of fs.readdirSync(m))if(/^chromium/.test(d)){c.push(path.join(m,d,'chrome-win64','chrome.exe'));c.push(path.join(m,d,'chrome-win','chrome.exe'));}}
 c.push(path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));return c.find(x=>x&&fs.existsSync(x))||null;}
function probe(){
  function chain(el){
    const out=[];let n=el,d=0;
    while(n&&n!==document.documentElement&&d<7){out.push({tag:n.tagName.toLowerCase(),cls:(n.className||'').toString().split(/\s+/)[0]||'',fs:getComputedStyle(n).fontSize});n=n.parentElement;d++;}
    return out;
  }
  const res={};
  for(const sel of ['.toc-side .toc-count','.side-toc .toc-count','.toc-side .lvl-4','.toc-side a','kbd','.side-count','.grp-zh','.toc-title']){
    const el=document.querySelector(sel);
    if(el)res[sel]={fs:getComputedStyle(el).fontSize,chain:chain(el)};
  }
  return res;
}
(async()=>{
 const exe=findChrome();const b=await chromium.launch({executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const vp of [{l:'1440x900',w:1440,h:900},{l:'390x844',w:390,h:844}]){
  const ctx=await b.newContext({viewport:{width:vp.w,height:vp.h},deviceScaleFactor:1});
  const page=await ctx.newPage();
  await page.goto(BASE+'/paper/dev/dialogs/',{waitUntil:'load',timeout:45000});
  await page.waitForTimeout(120);
  const d=await page.evaluate(probe,{});
  console.log('=== '+vp.l+' ===');
  for(const k of Object.keys(d)){
    console.log(k+' => '+d[k].fs);
    for(const c of d[k].chain)console.log('     '+c.tag+'.'+c.cls+'  '+c.fs);
  }
  await ctx.close();
 }
 await b.close();
})();
