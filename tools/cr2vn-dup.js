'use strict';
/* cr2vn-dup.js — 首页"同一棵导航树渲染两遍"的量化（只读） */
const fs=require('fs'),os=require('os'),path=require('path');
const {chromium}=require('playwright-core');
const argOf=(n,d)=>{const i=process.argv.indexOf(n);return i>-1&&process.argv[i+1]?process.argv[i+1]:d;};
const BASE=argOf('--base','http://127.0.0.1:8787');
function findChrome(){const c=[];if(process.env.CHROME_PATH)c.push(process.env.CHROME_PATH);
 const lad=process.env.LOCALAPPDATA;if(lad){const m=path.join(lad,'ms-playwright');
 if(fs.existsSync(m))for(const d of fs.readdirSync(m))if(/^chromium/.test(d)){c.push(path.join(m,d,'chrome-win64','chrome.exe'));c.push(path.join(m,d,'chrome-win','chrome.exe'));}}
 c.push(path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));return c.find(x=>x&&fs.existsSync(x))||null;}
function probe(){
  const sy=window.scrollY;
  const secs=[];
  const main=document.querySelector('main.content');
  for(const el of Array.from(main.children)){
    const cs=getComputedStyle(el),r=el.getBoundingClientRect();
    if(r.height<2)continue;
    secs.push({sig:el.tagName.toLowerCase()+'.'+(el.className.toString().split(/\s+/)[0]||''),
      top:Math.round(r.top+sy),h:Math.round(r.height)});
  }
  const sideRows=document.querySelectorAll('.sidebar .side-sec a, .sidebar .side-group a, .sidebar .side-cat a, .sidebar summary').length;
  const mainSrcItems=document.querySelectorAll('main .src-item').length;
  const mainGroups=document.querySelectorAll('main .tg-label').length;
  const sideGroups=document.querySelectorAll('.sidebar .side-group').length;
  // 文字重复度：正文里出现的页面标题，有多少也在侧栏里
  const sideTtl=new Set(Array.from(document.querySelectorAll('.sidebar .ttl')).map(e=>e.textContent.trim()).filter(Boolean));
  const mainLink=new Set(Array.from(document.querySelectorAll('main .src-link')).map(e=>e.textContent.trim()).filter(Boolean));
  let dup=0; for(const t of mainLink) if(sideTtl.has(t)) dup++;
  return {ok:true, docH:document.documentElement.scrollHeight, sections:secs,
    sideRows:sideRows, sidebarLinks:document.querySelectorAll('.sidebar a').length,
    mainSrcItems:mainSrcItems, mainGroups:mainGroups, sideGroups:sideGroups,
    mainLinkCount:mainLink.size, dupTitles:dup};
}
(async()=>{
 const exe=findChrome();const b=await chromium.launch({executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage']});
 const ctx=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
 const page=await ctx.newPage();
 await page.goto(BASE+'/',{waitUntil:'load',timeout:45000});await page.waitForTimeout(120);
 const d=await page.evaluate(probe,{});
 console.log('docHeight='+d.docH);
 console.log('侧栏导航行='+d.sideRows+'  侧栏链接='+d.sidebarLinks+'  侧栏组='+d.sideGroups);
 console.log('正文 src-item='+d.mainSrcItems+'  正文 .tg-label 组='+d.mainGroups+'  正文不同链接标题='+d.mainLinkCount);
 console.log('正文标题同时出现在侧栏里的数量='+d.dupTitles+' / '+d.mainLinkCount);
 console.log('--- main.children 高度分布 ---');
 let sum=0;
 for(const s of d.sections){sum+=s.h;console.log('  '+String(s.top).padStart(6)+'  h='+String(s.h).padStart(6)+'  '+s.sig);}
 console.log('  合计 '+sum+' / docH '+d.docH);
 await b.close();
})();
