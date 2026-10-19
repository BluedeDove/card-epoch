/* tools/rational_agent.cjs · 玩法量表代理（定案 §7.1 条 17：留在 tools/，不进气口层）
   只回答这一个问题：按收益折现决策的代理，会不会主动踩矿、打地形卡。
   与 AISource 同一条输入通道：poll(dt) → {fwd,back,left,right,jump,cast,lookYaw,lookPitch}，
   只读 match 状态（players / world.lodes / lodeSys / Rules.canPlay），永不写权威状态；
   随机只用 m.rng（与 AISource 同一条流，同 seed 端到端可复现）。
   它**不是产品 AI**：路径场用开局一次性缓存的柱高表算 BFS（与 ReachabilityGate 同一把尺：
   camGroundY、4 邻、高差 ≤1、岩浆盖顶不走），walk 缓存只在首张 poll 建一次，不进 tick 账。 */
'use strict';
const SPEED = 5.6;                 // battle.js SPEED（只读估计走位秒数用，不写回）
const HOLD_HORIZON = 120;          // 矿分折现视界（秒）：超过这个跨度的矿分不打折进当下决策

function wrapPi(a) { return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }

class RationalAgent {
  constructor(match, side) {
    this.m = match; this.side = side;
    this.plan = null;              // {type:'lode',i} | {type:'fight'} | {type:'wall'} | {type:'chase'}
    this.replanT = 0;
    this.grid = null;              // {h:Int16Array, lava:Uint8Array, SX, SZ} 一次性柱高缓存
    this.field = null;             // 当前目标的 BFS 距离场 {dist:Int32Array, tx, tz}
    this.lastPos = null; this.stuckT = 0; this.unstickT = 0;
  }

  /* ---------- 只读感知 ---------- */
  me() { return this.m.players[this.side]; }
  foe() { return this.m.players[1 - this.side]; }
  lodes() { return (this.m.world.lodes && this.m.world.lodes.list) || []; }
  cellOf(p) { return [Math.floor(p.pos.x), Math.floor(p.pos.z)]; }

  /* 一次性柱高缓存（camGroundY 口径，与闸门同尺）：64²=4096 格，开局一次，之后零 world.get。 */
  ensureGrid() {
    if (this.grid) return;
    const w = this.m.world, SX = w.SX, SZ = w.SZ, B = window.GW.BLOCK;
    const h = new Int16Array(SX * SZ), lava = new Uint8Array(SX * SZ);
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      const g = w.camGroundY(x, z);
      h[z * SX + x] = g < 0 ? -1 : g;
      if (g >= 0 && w.get(x, g + 1, z) === B.LAVA) lava[z * SX + x] = 1;
    }
    this.grid = { h, lava, SX, SZ };
  }
  /* 从 (tx,tz) 的 BFS 距离场（-1 不可达）。 */
  bfsFrom(tx, tz) {
    const { h, lava, SX, SZ } = this.grid;
    const dist = new Int32Array(SX * SZ).fill(-1);
    if (tx < 0 || tz < 0 || tx >= SX || tz >= SZ) return dist;
    const si = tz * SX + tx;
    if (h[si] < 0 || lava[si]) return dist;
    const qx = new Int32Array(SX * SZ), qz = new Int32Array(SX * SZ);
    let head = 0, tail = 0;
    dist[si] = 0; qx[tail] = tx; qz[tail] = tz; tail++;
    const DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1];
    while (head < tail) {
      const x = qx[head], z = qz[head]; head++;
      const d0 = dist[z * SX + x], y0 = h[z * SX + x];
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], nz = z + DZ[k];
        if (nx < 0 || nz < 0 || nx >= SX || nz >= SZ) continue;
        const ni = nz * SX + nx;
        if (dist[ni] >= 0 || h[ni] < 0 || lava[ni]) continue;
        if (Math.abs(h[ni] - y0) > 1) continue;
        dist[ni] = d0 + 1; qx[tail] = nx; qz[tail] = nz; tail++;
      }
    }
    return dist;
  }
  distOn(field, x, z) {
    if (x < 0 || z < 0 || x >= this.grid.SX || z >= this.grid.SZ) return -1;
    return field[z * this.grid.SX + x];
  }

  /* ---------- 收益评估（矿分按剩余时间折现、击杀分按命中概率折现） ---------- */
  evalPlans(me, foe, myField) {
    const m = this.m, out = [];
    const [mx, mz] = this.cellOf(me);
    const horizon = Math.max(0, Math.min(HOLD_HORIZON, m.timeCap - m.time));
    const lodes = this.lodes(), sys = m.lodeSys ? m.lodeSys.lodes : [];
    for (let i = 0; i < lodes.length; i++) {
      const L = lodes[i];
      const steps = this.distOn(myField, L.x, L.z);
      if (steps < 0) continue;                                  // 不可达的矿不值钱（闸门保证可达，这里是兜底）
      const travel = steps / SPEED;
      const foeSteps = foe && foe.alive ? this.distOn(myField, ...this.cellOf(foe)) : -1;
      /* 对手比我先到/正在矿上：独占概率打折；矿已归我且我就在矿上：基本锁定 */
      const owner = sys[i] ? sys[i].owner : -1;
      const onIt = Math.hypot(me.pos.x - L.x - 0.5, me.pos.z - L.z - 0.5) < 2.2;
      let lock = owner === this.side ? (onIt ? 0.95 : 0.75) : 0.8;
      if (foeSteps >= 0 && foeSteps < steps * 0.8) lock = Math.min(lock, 0.45);
      if (foe && foe.alive && Math.hypot(foe.pos.x - L.x - 0.5, foe.pos.z - L.z - 0.5) < 2.2) lock = Math.min(lock, 0.3);
      /* 量具修盲（A2-c 机制线批准这几行）：速率读 lodeSys 实账（rateOf 出口），
         归属读 sys[i].owner——宽限期的保留归属因此对估值可见，不再"看不见归属与宽限"。 */
      const rate = (m.lodeSys && m.lodeSys.rateOf) ? m.lodeSys.rateOf(sys[i]) : 1 / 3;
      const holdPts = Math.max(0, horizon - travel) * rate * lock;       // 按实际速率折现
      const matsPts = Math.max(0, horizon - travel) / 6 * 0.35 * lock; // 被动素材折成小分（约等于多打墙）
      let v = holdPts + matsPts - travel * 0.06;
      if (this.plan && this.plan.type === 'lode' && this.plan.i === i) v += 1.5;   // 滞回：别在矿之间抖
      out.push({ type: 'lode', i, v });
    }
    if (foe && foe.alive) {
      const dist = Math.hypot(foe.pos.x - me.pos.x, foe.pos.z - me.pos.z);
      if (dist < 26) {
        const pKill = Math.max(0.1, Math.min(0.9, 0.5 + (me.hp - foe.hp) / 220));
        const pDie = Math.max(0.05, Math.min(0.9, 0.5 + (foe.hp - me.hp) / 220));
        const aggr = me.hp < 30 ? 0.45 : 1;
        const vFight = (15 * pKill - 15 * pDie) * aggr + (dist < 18 ? 2.5 : 0);
        out.push({ type: 'fight', v: vFight });
        if (foe.hp <= 35) out.push({ type: 'chase', v: 5 + 15 * 0.45 - dist * 0.05 });
        /* 垒墙/掩体：对手贴脸且我手上有可负担的地形卡才有收益；残血时收益上调 */
        if (dist < 13 && this.bestWall(me)) out.push({ type: 'wall', v: 3 + (me.hp < 30 ? 2.5 : 0) + (me.mats >= 6 ? 0.5 : 0) });
      }
    }
    out.sort((a, b) => b.v - a.v);
    return out;
  }

  /* ---------- 手牌政策（只读 mana/cooldowns/mats/hand；canPlay 只作建议性查询） ---------- */
  cardAt(me, id) { for (let i = 0; i < me.hand.length; i++) if (me.hand[i] === id && !(me.cooldowns && me.cooldowns[id] > 0)) return i; return -1; }
  bestWall(me) {
    for (const id of ['wall2', 'icewall', 'raise']) {
      const i = this.cardAt(me, id);
      if (i >= 0 && me.mats >= 1) return i;
    }
    return -1;
  }
  faceToward(o, me, tx, ty, tz) {
    const ex = me.pos.x, ey = me.pos.y + 1.55, ez = me.pos.z;
    const dx = tx - ex, dz = tz - ez, dh = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(dx, dz);
    const wantPitch = Math.max(-1.5, Math.min(1.5, Math.atan2(ty - ey, dh)));
    o.lookYaw = wrapPi(wantYaw - me.yaw);
    o.lookPitch = wantPitch - (me.pitch || 0);
  }
  /* 直伤/功能牌：M6a 口径——敌在 20 格内且有魔力就打直伤 */
  tryCombatCast(o, me, foe, dist) {
    if (me.mana < 1) return false;
    const prefer = dist < 15 ? ['bolt', 'strike', 'shard', 'void_lance', 'snare_trap', 'golem', 'bloom']
                             : ['void_lance', 'bolt', 'shard', 'strike', 'golem'];
    if (me.hp < me.maxHp * 0.4) prefer.unshift('heal');
    if (dist < 9 && this.bestWall(me) >= 0 && me.mats >= 3 && this.m.rng() < 0.5) prefer.unshift('wall2');
    for (const id of prefer) {
      const i = this.cardAt(me, id);
      if (i < 0) continue;
      const c = window.GW.CARDS_BY_ID[id];
      if (!c || c.cost > me.mana) continue;
      if ((c.type === 'terrain') && me.mats < 1) continue;
      this.faceToward(o, me, foe.pos.x, foe.pos.y + 0.4, foe.pos.z);
      o.cast = i;
      return true;
    }
    return false;
  }
  /* 采晶：占矿后优先（M6a 口径）；敲自己矿上还剩的晶体，+3 魔 +1 素材 */
  tryHarvest(o, me, lode) {
    if (me.mana >= me.manaCap - 1 && me.mats >= 8) return false;
    const i = this.cardAt(me, 'harvest');
    if (i < 0 || me.mana < 1) return false;
    const w = this.m.world, B = window.GW.BLOCK;
    let best = null, bd = 10.5;
    for (const c of lode.crystals) {
      if (w.get(c[0], c[1], c[2]) !== B.CRYSTAL) continue;
      const d = Math.hypot(c[0] + 0.5 - me.pos.x, c[2] + 0.5 - me.pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return false;
    this.faceToward(o, me, best[0] + 0.5, best[1] + 0.5, best[2] + 0.5);
    o.cast = i;
    return true;
  }

  /* ---------- 主循环 ---------- */
  poll(dt) {
    const m = this.m, me = this.me();
    const o = { fwd: 0, back: 0, left: 0, right: 0, jump: 0, cast: undefined, lookYaw: 0, lookPitch: 0 };
    if (!me || !me.alive || m.aiOff) { this.lastPos = null; return o; }
    this.ensureGrid();
    const foe = this.foe();
    const [mx, mz] = this.cellOf(me);
    this.replanT -= dt;
    if (this.replanT <= 0 || !this.planValid(me, foe)) {
      this.replanT = 0.7 + m.rng() * 0.5;
      const myField = this.bfsFrom(mx, mz);
      const plans = this.evalPlans(me, foe, myField);
      const best = plans[0] || { type: 'fight', v: 0 };
      this.plan = best;
      this.field = null;
    }
    /* 卡死自救：位置 0.7s 没挪 0.4 格就跳+侧移 */
    if (this.lastPos) {
      const moved = Math.hypot(me.pos.x - this.lastPos.x, me.pos.z - this.lastPos.z);
      this.stuckT = moved < 0.4 ? this.stuckT + dt : 0;
    }
    this.lastPos = { x: me.pos.x, z: me.pos.z };
    if (this.stuckT > 0.7) { this.stuckT = 0; this.unstickT = 0.45; }
    if (this.unstickT > 0) { this.unstickT -= dt; o.jump = 1; o.right = m.rng() < 0.5 ? 1 : 0; o.left = 1 - o.right; o.fwd = 1; return o; }

    this.execute(o, me, foe, dt);
    return o;
  }
  planValid(me, foe) {
    const p = this.plan;
    if (!p) return false;
    if (p.type === 'lode') return this.lodes()[p.i] !== undefined;
    if (p.type === 'fight' || p.type === 'chase') return foe && foe.alive;
    return true;
  }
  execute(o, me, foe, dt) {
    const m = this.m, p = this.plan;
    if (!p) return;
    if (p.type === 'lode') return this.execLode(o, me, foe, p.i, dt);
    if (p.type === 'wall') {
      if (foe && foe.alive) {
        const wi = this.bestWall(me);
        if (wi >= 0 && me.mana >= window.GW.CARDS_BY_ID[me.hand[wi]].cost) {
          this.faceToward(o, me, foe.pos.x, foe.pos.y - 1, foe.pos.z);
          o.cast = wi;
          this.replanT = 0;                       // 垒完立刻重新评估
          return;
        }
      }
      this.plan = { type: 'fight', v: 0 }; return;
    }
    /* fight / chase：中距环绕 + 直伤 */
    if (!foe || !foe.alive) { this.replanT = 0; return; }
    const dist = Math.hypot(foe.pos.x - me.pos.x, foe.pos.z - me.pos.z);
    const range = p.type === 'chase' ? 6 : 9;
    const wantYaw = Math.atan2(foe.pos.x - me.pos.x, foe.pos.z - me.pos.z);
    o.lookYaw = wrapPi(wantYaw - me.yaw) * Math.min(1, 6 * dt);
    const along = dist - range;
    if (along > 1.5) o.fwd = 1; else if (along < -1.5) o.back = 1;
    if (Math.abs(along) < 5) { if (m.rng() < 0.5) o.right = 1; else o.left = 1; }
    if (me.onGround && dist > 12 && m.rng() < 0.03) o.jump = 1;
    this.tryCombatCast(o, me, foe, dist);
  }
  execLode(o, me, foe, i, dt) {
    const m = this.m, L = this.lodes()[i];
    const cx = L.x, cz = L.z;
    const distC = Math.hypot(me.pos.x - (cx + 0.5), me.pos.z - (cz + 0.5));
    /* 到站：踩住（平台 3×3 任意格都算在矿上），采晶、迎击靠近的对手 */
    if (distC < 1.8) {
      if (foe && foe.alive) {
        const fd = Math.hypot(foe.pos.x - me.pos.x, foe.pos.z - me.pos.z);
        if (fd < 20 && this.tryCombatCast(o, me, foe, fd)) return;
      }
      if (this.tryHarvest(o, me, L)) return;
      /* 没事做就面向来敌方向站桩（省得背对挨打） */
      if (foe && foe.alive) this.faceToward(o, me, foe.pos.x, foe.pos.y, foe.pos.z);
      return;
    }
    /* 赶路：跟随目标距离场；场过期/换目标才重算（零逐 tick 成本） */
    if (!this.field || this.field.tx !== cx || this.field.tz !== cz) this.field = { dist: this.bfsFrom(cx, cz), tx: cx, tz: cz };
    const [mx, mz] = this.cellOf(me);
    const here = this.distOn(this.field.dist, mx, mz);
    if (here <= 0) { this.field = null; this.replanT = 0; return; }   // 路径断了（被堵）→ 重评估
    const DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1];
    let bx = 0, bz = 0, bd = here;
    for (let k = 0; k < 4; k++) {
      const d = this.distOn(this.field.dist, mx + DX[k], mz + DZ[k]);
      if (d >= 0 && d < bd) { bd = d; bx = DX[k]; bz = DZ[k]; }
    }
    if (!bx && !bz) { this.field = null; this.replanT = 0; return; }
    const wantYaw = Math.atan2(bx, bz);
    o.lookYaw = wrapPi(wantYaw - me.yaw) * Math.min(1, 8 * dt);
    o.fwd = 1;
    if (me.onGround && m.rng() < 0.02) o.jump = 1;
    /* 路过也打仗：敌在 14 格内且脸基本对着，就打一张 */
    if (foe && foe.alive) {
      const fd = Math.hypot(foe.pos.x - me.pos.x, foe.pos.z - me.pos.z);
      if (fd < 14) this.tryCombatCast(o, me, foe, fd);
    }
  }
}
module.exports = { RationalAgent };
