#!/usr/bin/env node
/* tools/jump_window.cjs · 起跳容错与冰面滑行的行为回归（开发工具，index.html 不引用）

   为什么单独一把尺子：coyote time / 输入缓冲这类东西**截图看不出来**，手感探针（feel_probe）量的是
   水平位移的丝滑度，也量不到"这一下跳没跳起来"。这里直接驱动权威层 applyInput，逐 tick 判定。

   判据（都在 20Hz tick 下量，dt=0.05）：
     A 离地 0.10s 内按下跳 → 必须起跳（coyote 窗口内不被吞）；
     B 落地前 0.10s 按下跳 → 落地那一 tick 必须自动起跳（输入缓冲）；
     C 落地前 0.40s 就按下 → 落地后不许起跳（窗口不是无限容错，否则空中乱按会莫名弹起）；
     D 按住跳键走出崖边 → 不许自跳（coyote 只认"新鲜按下"，不然顺手按着跳键会自己蹦下去）；
     E 冰面滑行 → 冰上 1 秒的位移不得低于同条件普通地面的 50%
       （旧的 acc×0.06 写在位移上，实测只有 ~6%，那是被粘住不是打滑）。

   用法：node tools/jump_window.cjs [seed]
   退出码：0 全过；1 判据不过；2 环境错误。 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const seed = +(process.argv.find(a => /^\d+$/.test(a)) || 490706);
const { createRequire } = require('module'); const req = createRequire(__filename);
let PW = null;
for (const c of ['playwright','playwright-core','/data/miniconda3/miniconda3/lib/node_modules/playwright','/data/miniconda3/miniconda3/lib/node_modules/playwright-core']) { try { PW = req(c); break; } catch (e) {} }
if (!PW) { console.error('找不到 playwright'); process.exit(2); }
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css', '.json':'application/json' };
const srv = http.createServer((q, rsp) => {
  const rel = decodeURIComponent(q.url.split('?')[0]);
  const fp = path.join(ROOT, rel === '/' ? '/index.html' : rel);
  if (!fp.startsWith(ROOT)) { rsp.writeHead(403).end(); return; }
  fs.readFile(fp, (e, b) => { if (e) { rsp.writeHead(404).end('nf'); return; } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(b); });
});

const RUN = async (sd) => {
  const G = window.GW, S = window.GWAPP;
  /* 并行会话正在改音频引擎：它此刻在开局路径上抛异常（H.hideInventory→G.Audio.play→envShape 里 g.gain 不存在）。
     那与光影无关，探针不该被它绑住：只在"确实会抛"时把 play 旁路掉，并在输出里记 audioBypassed，绝不静默。 */
  window.__audioBypassed = false;
  try { if (window.GW && window.GW.Audio) window.GW.Audio.play('ui'); }
  catch (e) { window.__audioBypassed = true; window.GW.Audio.play = function () { return false; }; }
  window.__GW_START({ mode: 'train', seed: sd, deck: 'starter' });
  const F = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 40; i++) await F();
  if (S.sources) S.sources.length = 0;              // 掐掉键盘源：本探针自己喂输入，别两条时间线一起推
  S.running = false;                                 // 停主循环，理由同上（AGENTS：测抖动前先停 rAF）
  const M = S.match, B = G.BLOCK, w = S.world;
  const DT = 1 / 20, JUMP_MIN = 5;                   // JUMP=9.2，vel.y>5 就算"这一 tick 真起跳了"
  const out = { fails: [], seed: sd };
  out.audioBypassed = !!window.__audioBypassed;
  const p = M.players[0];
  const YAW_X = Math.PI / 2;                         // fwd=(sinθ,cosθ)，θ=90° 才是 +x；写 0 会往 +z 跑（我第一版就栽在这儿）

  /* 场地：x∈[PX0-6,PX1] 有地面（顶面 y=PY+1），再往 +x 全空，跑向 +x 才会真的踏空。
     先把整箱清空再铺台：生成的树会长在测试道上（landTick=2 其实是"落"在树干上，
     踏空样本跑不出来是一路撞进林子），这类样本被地形污染的坑必须在建场时就堵掉。 */
  const PY = 20, PX0 = 40, PX1 = 46, PZ = 40;
  function arena(x0, x1, z0, z1, floorId) {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      for (let y = PY - 3; y <= PY + 10; y++) w.set(x, y, z, 0);
      w.set(x, PY, z, floorId);
      for (let y = PY - 1; y >= PY - 3; y--) w.set(x, y, z, B.DIRT);
    }
  }
  arena(PX0 - 6, PX1 + 8, PZ - 3, PZ + 3, B.STONE);
  // 跑道尽头（PX1 之后）把地板撤掉形成悬崖；而且**一路清到底**——
  // 只清一层的话，跳出去的人会掉到坑底的生成地形上站住，那之后的"起跳"会被误判成 coyote 生效（我第一版就是这么假绿的）
  for (let x = PX1 + 1; x <= PX1 + 8; x++) for (let z = PZ - 3; z <= PZ + 3; z++) for (let y = 1; y <= PY + 10; y++) w.set(x, y, z, 0);

  function inp(o) { return Object.assign(G.blankInput(), o || {}); }
  /* onGround 交给 collideAABB 决定：以前在 reset 里写死 true，unstick 一短路就永远以为还在地上 */
  function reset(x, y, z, opt) {
    p.pos.set(x, y + p.h / 2, z); p.vel.set(0, (opt && opt.vy) || 0, 0);
    if (opt && opt.vx) p.vel.x = opt.vx;
    p.onGround = false; p.onIce = !!(opt && opt.ice); p.groundT = (opt && opt.groundT) || 99;
    p.jumpBuf = 0; p.prevJump = false; p.st = {}; p.swim = false; p.yaw = (opt && opt.yaw) || 0;
    p.alive = true;
  }
  /* 站定：不吃"上次残留速度"，所以这里必须无条件清零，写 if (p.vel.x) 是零不回 5.6 那个值 */
  function settle(n) { for (let i = 0; i < (n || 5); i++) { p.vel.x = 0; p.vel.z = 0; M.applyInput(p, inp(), DT); } p.vel.x = 0; p.vel.z = 0; }
  /* 同一条轨迹跑两遍：第一遍不按键，量出"关键 tick"；第二遍在那个 tick 按键。
     权威层是确定性的（同一个 seed、同样的 dt），所以两遍的初始条件可比 —— 这是这类窗口唯一能量准的办法。 */
  function walkOff(probe) {
    reset(PX0 + 1, PY + 1, PZ, { vx: 5.6, yaw: YAW_X });
    let leaveTick = -1, jumped = false, guard = 0, wasGround = false;
    while (guard++ < 80) {
      const pressing = probe && leaveTick > 0 && guard === leaveTick + probe.at;
      M.applyInput(p, inp(pressing ? { jump: 1 } : (probe && probe.hold ? { jump: 1 } : null)), DT);
      p.vel.x = 5.6;
      /* "离地"要以 onGround 翻假为准（与实现里读的同一个量），不能拿中心高度判：
         pos.y 是身体中心，脚底还在平台上时中心就已经比台顶低不了 0.83 格，
         用 pos.y<PY+1.02 判会晚 3 个 tick 才认出离地，按键窗口整个被推歪（第一版 coyote 全红就是这么来的）。 */
      if (leaveTick < 0 && wasGround && !p.onGround) leaveTick = guard;
      if (p.onGround) wasGround = true;
      // 只在按键后的 4 tick 内认这次起跳，超窗就判失败（否则掉到坑底站住后的跳跃会被算成 coyote）
      if (leaveTick > 0 && probe && p.vel.y > JUMP_MIN && guard <= leaveTick + probe.at + 4) { jumped = true; break; }
      if (p.pos.y < PY - 4) break;
    }
    return { leaveTick: leaveTick, jumped: jumped, guard: guard };
  }
  const base = walkOff(null);
  out.base = base;
  if (base.leaveTick < 0) out.fails.push('踏空样本没建立：跑不出平台边缘（场地或碰撞体不对，探针失效）');
  else {
    const cases = { at2: 2, at4: 4, at9: 9 };
    out.coyote = {};
    for (const name in cases) {
      const r = walkOff({ at: cases[name] });
      out.coyote[name] = r.jumped;
    }
    if (!out.coyote.at2) out.fails.push('离地 0.10s 内按下跳没起跳 → coyote 窗口失效（20Hz 下这半帧的吞键最容易被读成"操作失灵"）');
    if (out.coyote.at9) out.fails.push('离地 0.45s 后按跳仍然起跳 → coyote 窗口大于 0.12s，空中乱按会莫名弹起');
    /* 按住跳键走出崖边：不许被 coyote 触发 */
    /* 按住跳键走出崖边不许自跳。测法要避开一个坑：站着按住跳键本来就该跳（保留的原行为），
       所以这里把 prevJump 预置成 true，表示"按键在我们开始观察之前就已经按下了"，全程不再有新鲜按下。 */
    let jumpedWhileHeld = false, gg = 0, lt = -1;
    reset(PX0 + 1, PY + 1, PZ, { vx: 5.6, yaw: YAW_X });
    p.prevJump = true;
    while (gg++ < 40) {
      M.applyInput(p, inp({ jump: 1 }), DT);
      p.vel.x = 5.6;
      if (lt < 0 && !p.onGround) lt = gg;
      else if (lt > 0 && gg - lt <= 6 && p.vel.y > JUMP_MIN) { jumpedWhileHeld = true; break; }
      if (p.pos.y < PY - 6 || (lt > 0 && gg - lt > 6)) break;
    }
    out.holdNoAutoJump = !jumpedWhileHeld;
    if (jumpedWhileHeld) out.fails.push('按住跳键走出崖边时空中自跳了 → coyote 被"持续按住"触发，正确做法是只认新鲜按下');
  }

  /* 输入缓冲：先跑一遍量出落地 tick，再在同一场景提前 k tick 按键 */
  /* 按键发生在落地**之前**，所以不能在同一次运行里现算 landTick（那样条件永远不成立，
     我第一次跑就是这样测出"缓冲失效"的假红）：先跑一遍量出落地 tick，再把它当已知量喂进第二遍。 */
  function fall(probe) {
    reset(PX0 + 1, PY + 3.4, PZ, { vy: -6 });
    let landTick = -1, jumped = false, guard = 0;
    const pressTick = probe && probe.landTick > 0 ? probe.landTick - probe.at : -1;
    while (guard++ < 60) {
      const pressing = pressTick > 0 && guard === pressTick;
      M.applyInput(p, inp(pressing ? { jump: 1 } : null), DT);
      if (landTick < 0 && p.onGround) landTick = guard;
      else if (landTick > 0 && guard > landTick && p.vel.y > JUMP_MIN) { jumped = true; break; }
      else if (landTick > 0 && guard > landTick + 3) break;
      if (p.pos.y < PY - 6) break;
    }
    return { landTick: landTick, jumped: jumped };
  }
  const fb = fall(null);
  out.fall = fb;
  if (fb.landTick < 0) out.fails.push('落地样本没建立（探针失效）');
  else {
    out.buffer = { at2: fall({ at: 2, landTick: fb.landTick }).jumped, at8: fall({ at: 8, landTick: fb.landTick }).jumped };
    if (!out.buffer.at2) out.fails.push('落地前 0.10s 按下跳、落地时没自动起跳 → 输入缓冲失效（按键必须掐在 20Hz 的缝上才算数）');
    if (out.buffer.at8) out.fails.push('落地前 0.40s 的按键还被记住 → 缓冲窗口大于 0.14s，会凭空补跳');
  }

  /* 冰面：位移不再被打折，"滑"改由 applyInput 的转向加速度做 */
  function slide(ice) {
    const SX0 = 60, SZ = 44;
    arena(SX0 - 2, SX0 + 16, SZ - 2, SZ + 2, ice ? B.ICE : B.STONE);   // 同样要清箱：直道上长树一挡，位移就量歪了
    reset(SX0, PY + 1, SZ, { yaw: YAW_X, ice: ice });
    settle(4);
    if (!p.onGround) return { dist: 0, grounded: false };
    const x0 = p.pos.x;
    for (let i = 0; i < 20; i++) { p.onIce = !!ice; M.applyInput(p, inp({ fwd: 1 }), DT); }   // onIce 要在 applyInput **之前**给
    return { dist: Math.abs(p.pos.x - x0), vEnd: +p.vel.x.toFixed(2), grounded: true };
  }
  /* F) 比一个 tick 还短的点击（按下+抬起都落在同一个 1/20s 内）：
     键盘源若只报"电平"，这一下会被整个吞掉——用户感受就是"我明明按了跳"。
     对照跑法：同一个 case 在 /tmp/gw_head（改动前的副本）里应当判 false，那才是"吞键"的证据。 */
  out.tapEdge = (function () {
    const KS = G.Net && G.Net.KeyboardSource;      // 类挂在 GW.Net 下面，不是 GW 上
    if (!KS) return { ok: false, why: 'GW.Net.KeyboardSource 拿不到' };
    const src = new KS({ fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', jump2: 'Space', cast: ['Digit1'] }, {});
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
    const first = src.poll(DT);
    reset(PX0 + 1, PY + 1, PZ, {});
    settle(3);
    M.applyInput(p, first, DT);
    const jumpedOnTap = p.vel.y > JUMP_MIN;
    const second = src.poll(DT);
    return { ok: true, seenNextTick: !!first.jump, jumpedOnTap: jumpedOnTap, edgeCleared: !second.jump };
  })();
  if (!out.tapEdge.ok) out.fails.push('短点击样本没跑成：' + out.tapEdge.why);
  else {
    if (!out.tapEdge.seenNextTick) out.fails.push('40ms 的按下+抬起没被下一个 tick 看到 → 跳键还是"电平"，手点会被吞');
    if (!out.tapEdge.jumpedOnTap) out.fails.push('看到按键却没起跳 → 战斗层没把边沿当新鲜按下处理');
    if (out.tapEdge.edgeCleared === false) out.fails.push('边沿取走后没清 → 会自己补跳第二下');
  }

  const g = slide(false), ic = slide(true);
  out.ice = { ground: +g.dist.toFixed(2), ice: +ic.dist.toFixed(2), ratio: +(ic.dist / Math.max(0.001, g.dist)).toFixed(2), grounded: g.grounded && ic.grounded };
  if (!out.ice.grounded) out.fails.push('滑行样本没站在地面上（场地没建好，探针失效）');
  else {
    if (!(g.dist > 3)) out.fails.push('普通地面 1 秒只走 ' + g.dist.toFixed(2) + ' 格（SPEED=5.6 应 ≥3）→ 输入没喂进去');
    if (!(out.ice.ratio >= 0.5)) out.fails.push('冰上 1 秒走 ' + out.ice.ice + ' 格 / 地面 ' + out.ice.ground + ' 格（比值 ' + out.ice.ratio + '）→ 又回到"被粘住"的 0.06 位移口径');
    if (!(out.ice.ratio < 1.02)) out.fails.push('冰面与地面几乎一样（比值 ' + out.ice.ratio + '）→ 结冰/霜卡失去战术价值');
  }
  return out;
};

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const browser = await PW.chromium.launch({});
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html?cb=' + Math.random().toString(36).slice(2));
  // 只等引导完成：开局是 RUN 里 __GW_START 干的，别在这儿等 match（等不到，直接超时）
  await page.waitForFunction(() => window.GWAPP && window.__GW_START && window.GW && window.GW.blankInput, null, { timeout: 60000 });
  const r = await page.evaluate(RUN, seed);
  if (errs.length) r.fails.push('页面异常：' + errs.slice(0, 3).join(' | '));
  console.log(JSON.stringify(Object.assign({ pass: r.fails.length === 0 }, r), null, 1));
  await browser.close(); srv.close();
  process.exit(r.fails.length ? 1 : 0);
})().catch(e => { console.error('JUMP WINDOW ENV ERROR: ' + (e && e.stack || e)); process.exit(2); });
