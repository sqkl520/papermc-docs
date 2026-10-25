'use strict';
/* cr2vn-prose.js — 正文排版度量（只读）：正文字号/行高、代码行高、侧栏行高对比 */
const fs=require('fs'),os=require('os'),path=require('path');
const {chromium}=require('playwright-core');
const argOf=(n,d)=>{const i=process.argv.indexOf(n);return i>-1&&process.argv[i+1]?process.argv[i+1]:d;};
const BASE=argOf('--base','http://127.0.0.1:8787');
function findChrome(){const c=[];if(process.env.CHROME_PATH)c.push(process.env.CHROME_PATH);
 const lad=process.env.LOCALAPPDATA;if(lad){const m=path.join(lad,'ms-playwright');
 if(fs.existsSync(m))for(const d of fs.readdirSync(m))if(/^chromium/.test(d)){c.push(path.join(m,d,'chrome-win64','chrome.exe'));c.push(path.join(m,d,'chrome-win','chrome.exe'));}}
 c.push(path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'));return c.find(x=>x&&fs.existsSync(x))||null;}
function probe(){
  const out={};
  function m(sel,label){const el=document.querySelector(sel);if(!el)return;
    const cs=getComputedStyle(el),r=el.getBoundingClientRect();
    out[label]={sel:sel,fs:Math.round(parseFloat(cs.fontSize)*100)/100,lh:cs.lineHeight,
      lhPx:Math.round(parseFloat(cs.lineHeight)*10)/10,
      ratio:+(parseFloat(cs.lineHeight)/parseFloat(cs.fontSize)).toFixed(3),
      mb:parseFloat(cs.marginBottom),h:Math.round(r.height)};}
  m('.article p:not(.page-desc):not(.page-meta):not(.alert-title)','prose_p');
  m('.article li','prose_li');
  m('.article h2','h2');
  m('.article h3','h3');
  m('.article h4','h4');
  m('.article pre code','code_pre');
  m('.article td','table_td');
  m('.article .alert-body p','alert_p');
  m('.sidebar .side-sec a','sidebar_link');
  m('.sidebar .side-group-title','sidebar_group_title');
  m('.sidebar .side-section-title','sidebar_section_title');
  m('.sidebar .side-legend','sidebar_legend');
  m('.toc-side a','toc_link');
  m('.crumbs a','crumbs');
  m('.page-footer','footer');
  m('.pager a','pager');
  // 代码块内行推进
  const pre=document.querySelector('.article pre');
  if(pre){const cs=getComputedStyle(pre);out.pre_strut={fs:parseFloat(cs.fontSize),lh:cs.lineHeight,lhPx:Math.round(parseFloat(cs.lineHeight)*10)/10};}
  // 正文列实际宽度
  const p=document.querySelector('.article p:not(.page-desc)');
  if(p)out.prose_width=Math.round(p.getBoundingClientRect().width);
  // 统计卡数值 vs 小节标题
  const sb=document.querySelector('.stat b'), sh=document.querySelector('.section-head h2');
  if(sb)out.stat_b_fs=parseFloat(getComputedStyle(sb).fontSize);
  if(sh)out.section_h2_fs=parseFloat(getComputedStyle(sh).fontSize);
  const h1=document.querySelector('.hero h1');
  if(h1)out.hero_h1_fs=parseFloat(getComputedStyle(h1).fontSize);
  return out;
}
(async()=>{
 const exe=findChrome();const b=await chromium.launch({executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const pg of ['/paper/dev/dialogs/','/']){
  const ctx=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const page=await ctx.newPage();
  await page.goto(BASE+pg,{waitUntil:'load',timeout:45000});await page.waitForTimeout(80);
  const d=await page.evaluate(probe,{});
  console.log('=== '+pg+' ===');
  for(const k of Object.keys(d))console.log('  '+k+': '+JSON.stringify(d[k]));
  await ctx.close();
 }
 await b.close();
})();
