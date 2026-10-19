#!/usr/bin/env node
/* tools/feel_probe.cjs · 移动"丝滑度"量化探针（开发工具，不参与游戏运行，index.html 不引用它）

   为什么单独有它：tools/audit.cjs 的 15 项判的是相机连续性与构图，D 项阈值 1.2 格/frame
   抓不到"画面位置退回 20Hz 权威值直连"这类台阶感回归（20Hz 直连时单帧最大位移才 0.28 格）。
   手感必须量"有多少渲染帧根本没在动"，所以另开一把尺子：
     · zeroPct  零位移帧占比：按住 W 巡航时，这一帧相对上一帧位移 < 1e-6 的帧数比例
     · ratio    单帧最大位移 / 平均位移：阶跃式更新会把它顶到 3~8，连续运动应在 1.5 以下
     · jerk     |Δ²pos|/dt²（格/s²）
   三个量分别对 权威 p.pos（应当仍是台阶：那是 20Hz 逻辑）、hero mesh（应当连续）、
   cam.pos（跟随弹簧臂让路会贡献尖峰，tele 位用来区分"传送帧"）取数。

   口径：**只统计"逻辑确实在推进"的帧**（4 帧窗口内权威位移全为 0 = 走进死路/贴住墙，剔除），
   否则零位移帧会被"卡住"污染成台阶感。改动前后放在同一次采样里对照：
   旧版渲染就是 1:1 抄权威 p.pos，所以"未插值"那一行 = 改动前的渲染行为。
     基准（seed 490706，按住 W 巡航，自动化环境 ~60FPS，移动段 245 帧）：
       未插值  zeroPct 66.5%   最大÷平均 3.23   jerk 2027
       插值后  zeroPct  0.8%   最大÷平均 1.10   jerk  284
     seed 88092 那条路多半被地形挡住（移动段只剩 76 帧）：65.8%→0%，2.92→1.01。
     hero 行（权威 pos 本身）不该被"优化"掉：那是 20Hz 逻辑本来的样子。

   用法：node tools/feel_probe.cjs [seed] [--tag 名字]
   注意：SwiftShader 软件光栅下 FPS 只有 ~60，真机 160FPS 时台阶感会更明显；
        所以这里的 zeroPct 是**下界**，真机更差。别拿它当帧率指标。
*/
'use strict';
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=require('path').resolve(__dirname,'..');
const argv=process.argv.slice(2);
const seed=+(argv.find(a=>/^\d+$/.test(a))||490706);
const tagI=argv.indexOf('--tag');const tag=tagI>=0?argv[tagI+1]:'';
const N=+(argv.find(a=>/^N=/.test(a))||'N=300').slice(2);
function loadPW(){const{createRequire}=require('module');const c=['playwright','playwright-core','$(npm root -g)/playwright','$(npm root -g)/playwright-core'];for(const x of c){try{return createRequire(__filename)(x);}catch(e){}}return null;}
const PW=loadPW(); if(!PW){console.error('no playwright');process.exit(2);}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2'};
(async()=>{
const srv=http.createServer((q,s)=>{const rel=decodeURIComponent(q.url.split('?')[0]);const fp=path.join(ROOT,rel==='/'?'/index.html':rel);fs.readFile(fp,(e,b)=>{if(e){s.writeHead(404).end('nf');return;}s.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'}).end(b);});});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+srv.address().port+'/index.html?cb='+Math.random().toString(36).slice(2);
const browser=await PW.chromium.launch({});
const page=await browser.newPage({viewport:{width:960,height:540}});
const errs=[];page.on('pageerror',e=>errs.push(e.message));page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await page.goto(url);
await page.waitForFunction(()=>window.GWAPP&&window.__GW_START,null,{timeout:60000});
const out=await page.evaluate(async(sd)=>{
  window.__GW_START({mode:'train',seed:sd,deck:'starter'});
  const st=window.GWAPP; const F=()=>new Promise(r=>requestAnimationFrame(r));
  for(let i=0;i<30;i++) await F();
  st.sources=[{poll:()=>({fwd:1,back:0,left:0,right:0,jump:0,cast:-1,lookYaw:0,lookPitch:0})},
              {poll:()=>({fwd:0,back:0,left:0,right:0,jump:0,cast:-1,lookYaw:0,lookPitch:0})}];
  const p=st.match.players[0],cam=st.cams[0],hero=window.__dbg.ent.children[0];
  for(let i=0;i<60;i++) await F();
  const rec={t:[],px:[],pz:[],cx:[],cy:[],cz:[],ticks:[],mx:[],mz:[],py:[],rad:[],fl:[],held:[],tele:[],hard:[],es:[],alpha:[]};
  for(let i=0;i<300;i++){ await F();
    rec.t.push(performance.now());
    rec.px.push(p.pos.x); rec.pz.push(p.pos.z); rec.py.push(p.pos.y);
    rec.cx.push(cam.pos.x); rec.cy.push(cam.pos.y); rec.cz.push(cam.pos.z);
    rec.mx.push(hero.position.x); rec.mz.push(hero.position.z);
    rec.ticks.push(st.match.tick); rec.alpha.push(+(st.alpha||0).toFixed(3));
    rec.rad.push(+(cam.curRadius||0).toFixed(3)); rec.fl.push(+(cam.floorSm||0).toFixed(3));
    rec.held.push(String(cam.dbg&&cam.dbg.held)); rec.tele.push(!!cam._teleJump);
    rec.hard.push(cam.hardUnstick||0); rec.es.push(cam.emergencySnaps||0); }
  return rec;
},seed);
function stats(t,xs,ys,zs){const d=[],v=[];
for(let i=1;i<xs.length;i++){const dt=(t[i]-t[i-1])/1000;const dist=Math.hypot(xs[i]-xs[i-1],ys[i]-ys[i-1],zs[i]-zs[i-1]);d.push({dist,dt});v.push(dist/Math.max(1e-6,dt));}
let zero=0,sum=0,max=0,jerk=0,dtSum=0;
for(const s of d){if(s.dist<1e-6)zero++;sum+=s.dist;if(s.dist>max)max=s.dist;dtSum+=s.dt;}
for(let i=1;i<v.length;i++)jerk=Math.max(jerk,Math.abs(v[i]-v[i-1])/Math.max(1e-6,d[i].dt));
const mean=sum/d.length;
return {frames:d.length,fps:+(d.length/Math.max(1e-6,dtSum)).toFixed(1),mean:+mean.toFixed(4),max:+max.toFixed(4),zeroPct:+(100*zero/d.length).toFixed(1),ratio:mean>0?+(max/mean).toFixed(2):0,jerk:+jerk.toFixed(0)};}

/* 只看"逻辑确实在推进"的帧：每帧取权威位移，用 4 帧窗口判这段路是不是在走，
   走进死路/贴住墙（4 帧内一步没动）的帧不计入，否则零位移帧会被"卡住"污染成台阶感。 */
function maskedStats(t, xsA, zsA, xsB, zsB){
  const n = xsA.length, dh = [], dm = [];
  for(let i=1;i<n;i++){
    dh.push(Math.hypot(xsA[i]-xsA[i-1], zsA[i]-zsA[i-1]));
    dm.push(Math.hypot(xsB[i]-xsB[i-1], zsB[i]-zsB[i-1]));
  }
  const W = 4, act = [];
  for(let i=0;i<dh.length;i++){
    let any = false;
    for(let k=i;k<Math.min(dh.length,i+W);k++) if(dh[k] > 1e-4) any = true;
    act.push(any);
  }
  function calc(useMask){
    let z=0,c=0,sum=0,max=0,jerk=0,prevV=0;
    for(let i=0;i<dh.length;i++){
      if(useMask && !act[i]) continue;
      const dt=(t[i+1]-t[i])/1000, d=dm[i];
      c++; sum+=d; if(d<1e-6)z++; if(d>max)max=d;
      const v=d/Math.max(1e-6,dt); jerk=Math.max(jerk, Math.abs(v-prevV)/Math.max(1e-6,dt)); prevV=v;
    }
    const mean=sum/Math.max(1,c);
    return {frames:c, zeroPct:+(100*z/Math.max(1,c)).toFixed(1), mean:+mean.toFixed(4),
            max:+max.toFixed(4), ratio: mean>0?+(max/mean).toFixed(2):0, jerk:+jerk.toFixed(0)};
  }
  let inact=0; for(const a of act) if(!a) inact++;
  return { movingFrames: calc(true), stuckPct: +(100*inact/act.length).toFixed(1), rawAll: calc(false) };
}
const simRow = maskedStats(out.t, out.px, out.pz, out.px, out.pz);   // 权威 pos：旧版渲染就是 1:1 抄它 → 相当于"改动前"
const meshRow = maskedStats(out.t, out.px, out.pz, out.mx, out.mz);  // 插值后的渲染位置 → "改动后"

const hero=stats(out.t,out.px,out.px.map(()=>0),out.pz);
const mesh=stats(out.t,out.mx,out.mx.map(()=>0),out.mz);
const cam=stats(out.t,out.cx,out.cy,out.cz);
const big=[];
for(let i=1;i<out.cx.length;i++){
  const d=Math.hypot(out.cx[i]-out.cx[i-1],out.cy[i]-out.cy[i-1],out.cz[i]-out.cz[i-1]);
  big.push({i,d:+d.toFixed(3),dt:+((out.t[i]-out.t[i-1])/1000).toFixed(4),py:+out.py[i].toFixed(2),rad:out.rad[i],fl:out.fl[i],held:out.held[i],tele:out.tele[i],dHard:out.hard[i]-out.hard[i-1],dEs:out.es[i]-out.es[i-1]});
}
big.sort((a,b)=>b.d-a.d);
console.log(JSON.stringify({tag,seed,hero,mesh,cam,sim_改动前口径:simRow.rawAll,渲染_改动后:meshRow.movingFrames,stuckPct:meshRow.stuckPct,对照_同窗口未插值:simRow.movingFrames,top:big.slice(0,6),
  hardTotal:out.hard[out.hard.length-1]-out.hard[0],emergencySnaps:out.es[out.es.length-1]-out.es[0],
  teleFrames:out.tele.filter(Boolean).length,
  held:out.held.reduce((a,v)=>{a[v]=(a[v]||0)+1;return a;},{}),
  errors:errs.slice(0,5)},null,1));
await browser.close();srv.close();
})().catch(e=>{console.error('PROBE ERROR '+(e&&e.stack||e));process.exit(2);});