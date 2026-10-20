/* ================= GW.Net =================
   输入抽象：真人键盘、AI、（预留）WebSocket 远端 都产出同一种"指令流"。
   权威状态只在 Match.step(dt, inputs) 里被推进 —— 换成联网时只替换 InputSource。
   同步方案（按调研结论）：服务端权威 + 定 tick 快照（15~20Hz），客户端插值；
   坐标用整数格，避免浮点漂移导致的 desync。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  function blank() { return { fwd: 0, back: 0, left: 0, right: 0, jump: 0, crouch: 0, sprint: 0, cast: -1, lookYaw: 0, lookPitch: 0 }; }
  G.blankInput = blank;

  /* ---------- 键盘 / 鼠标 ---------- */
  function KeyboardSource(bindings, opts) {
    this.keys = {}; this.b = bindings; this.out = blank();
    this.mouseDX = 0; this.mouseDY = 0; this.pressed = -1; this.jumpEdge = 0;
    this.sprintLatch = 0; this.lastFwdAt = 0;
    this.mouseLook = !!(opts && opts.mouseLook);
    var self = this;
    window.addEventListener('keydown', function (ev) {
      if (ev.repeat) return;
      // 正在输入（菜单种子框、背包搜索框）时不吞按键：以前在种子里打 "R" 会直接重开一局
      var tn = (ev.target && ev.target.tagName) || '';
      if (tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT') return;
      self.keys[ev.code] = 1;
      /* 双击前进 = 疾跑（Minecraft 口径）：Ctrl+W 会关掉浏览器标签页，所以默认键改成 Q，
         双击 W 作为"不用记键位"的那条路；松开前进才解除。 */
      if (self.b.fwd === ev.code) {
        var nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (nowMs - self.lastFwdAt < 300) self.sprintLatch = 1;
        self.lastFwdAt = nowMs;
      }
      if (self.b.cast && self.b.cast.indexOf(ev.code) >= 0) {
        var i = self.b.cast.indexOf(ev.code);
        self.pressed = i;
      }
      if (self.b.jump === ev.code || (self.b.jump2 && self.b.jump2 === ev.code)) {
        self.keys.__jump = 1;
        /* 跳键要**闩锁**：poll 只在 20Hz 的 tick 里读一次状态，
           手快点按（按下与抬起都落在同一个 tick 内）会被整个吞掉：读的是电平，
           那个 tick 恰好没人读就什么都不剩（tools/jump_window.cjs 的 tapEdge 用例，改动前跑是 seenNextTick:false）。
           战斗层靠"上一次是否按下"判新鲜按下，所以这里必须把边沿留着，取走才清。 */
        self.jumpEdge = 1;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].indexOf(ev.code) >= 0) ev.preventDefault();
    });
    window.addEventListener('keyup', function (ev) {
      self.keys[ev.code] = 0;
      if (ev.code === self.b.fwd) self.sprintLatch = 0;
      if (ev.code === self.b.jump || (self.b.jump2 && ev.code === self.b.jump2)) self.keys.__jump = 0;
    });
    if (this.mouseLook) {
      window.addEventListener('mousemove', function (ev) {
        if (!G.pointerLocked) return;
        self.mouseDX += ev.movementX || 0; self.mouseDY += ev.movementY || 0;
      });
    }
  }
  /* 转向速率与灵敏度：只有 flushLook 一处用，别再复制第二份（符号依据见 flushLook 注释） */
  var LOOK_RATE = { yaw: 2.4, pitch: 1.7 };        // 键盘自转 rad/s
  var MOUSE_SENS = { yaw: 0.0026, pitch: 0.0022 }; // 鼠标每 pixel 转角 rad

  KeyboardSource.prototype.poll = function (dt) {
    var k = this.keys, b = this.b, o = blank();
    o.fwd = k[b.fwd] ? 1 : 0; o.back = k[b.back] ? 1 : 0;
    o.left = k[b.left] ? 1 : 0; o.right = k[b.right] ? 1 : 0;
    o.jump = (k.__jump || this.jumpEdge) ? 1 : 0;    // 边沿闩锁见 keydown；本 tick 取走即清
    o.crouch = (b.crouch && k[b.crouch]) ? 1 : 0;   // 创造模式飞行下降用
    o.sprint = ((b.sprint && k[b.sprint]) || this.sprintLatch) ? 1 : 0;   // 疾跑：Q 或双击前进
    // 转向不在这里取：poll 由主循环按 1/20s 的 tick 调用，鼠标是连续输入，
    // 绑在 tick 上会让视角每 4~8 个渲染帧才动一次、一次跳近 10°（真机 160FPS 更明显），
    // 就是用户 2026-10-16 报的"视角拉扯"。转向统一走 flushLook（每渲染帧一次）。
    // 离散输入（出牌/跳）仍留在 tick 里，保证结算与 tick 对齐。
    o.cast = this.pressed; this.pressed = -1;
    this.jumpEdge = 0;
    return o;
  };

  /* 每渲染帧调用一次，产出这一帧的视角增量。dt 必须是真实帧时长，不是 STEP。
     符号的根据（别照感觉改）：相机 fwd=(sinθ,0,cosθ)，屏幕右=(-cosθ,0,sinθ)，
     故 d(fwd)/dθ=(cosθ,0,-sinθ)=-右向，即 θ 增大=视线往【左】偏、θ 减小=往【右】偏。
     所以"向右"（E 键、movementX>0）必须让 yaw 减小。这里曾写成 +=，
     让鼠标右移和 E 键都把画面转向左（用户报"鼠标反轴"）。
     移动侧 battle.js 用 right=(-fz,fx)，本来就是对的，不要跟着一起改。
     pitch 方向实测正确：movementY<0（上移）→ 抬头。 */
  KeyboardSource.prototype.flushLook = function (dt) {
    var k = this.keys, b = this.b, ly = 0, lp = 0;
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    if (k[b.lookL]) ly += LOOK_RATE.yaw * dt;    // Q 向左
    if (k[b.lookR]) ly -= LOOK_RATE.yaw * dt;    // E 向右
    if (k[b.lookU]) lp += LOOK_RATE.pitch * dt;  // F 抬头
    if (k[b.lookD]) lp -= LOOK_RATE.pitch * dt;  // V 低头
    if (this.mouseLook) {
      ly -= this.mouseDX * MOUSE_SENS.yaw;
      lp += -this.mouseDY * MOUSE_SENS.pitch;
      this.mouseDX = 0; this.mouseDY = 0;
    }
    return { lookYaw: ly, lookPitch: lp };
  };

  /* ---------- AI 对手：与真人走完全相同的指令通道 ---------- */
  function AISource(match, side, level) {
    this.match = match; this.side = side; this.t = 0; this.out = blank();
    this.plan = { strafe: 1, want: 0, range: 8 };
    this.level = level || 1;
  }
  AISource.prototype.poll = function (dt) {
    var m = this.match, me = m.players[this.side], o = blank();
    if (!me || !me.alive) return o;
    if (m.aiOff) return o;                       // 创造模式可以要一个干净场地（AI 与真人走同一通道，这里只是不给指令）
    var foe = m.players[1 - this.side];
    this.t -= dt;
    // 目标：优先残血敌方玩家；被 taunt 吸引交给随从逻辑
    var tx, tz;
    if (foe && foe.alive) { tx = foe.pos.x; tz = foe.pos.z; }
    else { var s = m.summons.find(function (e) { return e.side !== this.side; }, this); if (s) { tx = s.pos.x; tz = s.pos.z; } else { tx = me.pos.x; tz = me.pos.z; } }
    var dx = tx - me.pos.x, dz = tz - me.pos.z, dist = Math.hypot(dx, dz);
    if (this.t <= 0) {
      this.t = 0.35 + m.rng() * 0.4;
      this.plan.range = 6 + m.rng() * 8;
      this.plan.strafe = m.rng() < 0.5 ? -1 : 1;
      if (me.hp < me.maxHp * 0.45) this.plan.range = 13;
    }
    // 朝向：平滑跟踪目标（越肩视角下 AI 也用自己的 pitch）
    var wantYaw = Math.atan2(dx, dz);
    var dYaw = ((wantYaw - me.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    o.lookYaw = Math.max(-4 * dt, Math.min(4 * dt, dYaw * 6 * dt));
    o.lookPitch = Math.max(-2 * dt, Math.min(2 * dt, (-0.1 - me.pitch) * 3 * dt));
    // 移动：保持中距 + 侧移，并做落点安全检查（不跳崖、不进岩浆/深水）
    var along = (dist - this.plan.range);
    var wantF = 0, wantS = 0;
    if (along > 1.5) wantF = 1; else if (along < -1.5) wantF = -1;
    if (Math.abs(along) < 6) wantS = this.plan.strafe;
    var trial = 0, safe = false;
    while (trial++ < 5 && !safe) {
      safe = this.safeStep(me, wantF, wantS);
      if (!safe) { wantS = -wantS || (m.rng() < 0.5 ? 1 : -1); if (trial > 2) wantF = -wantF; }
    }
    o.fwd = wantF > 0 ? 1 : 0; o.back = wantF < 0 ? 1 : 0;
    o.right = wantS > 0 ? 1 : 0; o.left = wantS < 0 ? 1 : 0;
    if (me.onGround && safe && (dist > 14 || m.rng() < 0.02)) o.jump = 1;
    // 选牌：给每张手牌打分，够魔力就打分最高的
    if (me.mana >= 1 && m.rng() < (this.level === 1 ? 0.22 : 0.4)) {
      var bi = -1, bs = -1;
      for (var i = 0; i < me.hand.length; i++) {
        var c = G.CARDS_BY_ID[me.hand[i]]; if (!c) continue;
        var s = this.score(c, me, dist);
        if (s > bs) { bs = s; bi = i; }
      }
      if (bi >= 0 && bs > 0) { o.cast = bi; this.t = 0.16; }
    }
    return o;
  };
  AISource.prototype.safeStep = function (me, f, s) {
    var w = this.match.world, BLK = G.BLOCK;
    var yaw = me.yaw;
    var dirX = Math.sin(yaw) * f + Math.cos(yaw) * s, dirZ = Math.cos(yaw) * f - Math.sin(yaw) * s;
    var L = Math.hypot(dirX, dirZ); if (L < 0.01) return true;
    dirX /= L; dirZ /= L;
    var gx = Math.floor(me.pos.x + dirX * 1.15), gz = Math.floor(me.pos.z + dirZ * 1.15);
    var sy = w.surfaceY(gx, gz);
    if (me.pos.y - (sy + 1) > 2.6) return false;
    var body = w.get(gx, Math.floor(me.pos.y), gz), foot = w.get(gx, sy + 1, gz);
    if (body === BLK.LAVA || foot === BLK.LAVA) return false;
    if (body === BLK.WATER && foot === BLK.WATER) return false;
    return true;
  };
  AISource.prototype.score = function (c, me, dist) {
    if (c.cost > me.mana) return -1;
    var s = 1 + (G.Rules.canPlay(c, me, this.match.ctx).ok ? 2 : -20);
    if (me.hp < me.maxHp * 0.4 && (c.id === 'heal' || c.id === 'regrow' || c.id === 'bulwark' || c.id === 'guard')) s += 6;
    if (c.type === 'terrain') s += (dist > 7 ? 2.2 : 0.6);          // 远程时地形更有价值
    if (c.type === 'summon') s += 2.4;
    if (c.type === 'sigil') s += (dist < 12 ? 2.8 : 0.4);
    if (c.element === 'fire') s += (me.mana >= c.cost + 2 ? 1.4 : 0);
    if (c.element === 'ice' && dist < 6) s += 1.2;
    if (c.element === 'void' && c.id === 'blink' && dist > 16) s += 2;
    return s;
  };

  /* ---------- 联网预留：把远端输入映射成本地指令流 ----------
     协议（服务端权威，客户端只发输入、收快照）：
       C→S  {t:'i', f:frame, side, fwd,back,left,right,jump,cast,yaw,pitch}
       S→C  {t:'s', f:frame, seed, players:[{x,y,z,hp,mana,...}], sigils:[...], events:[...]}
     启用方式：index.html?net=ws://host:port&room=xxx  → main.js 会改用 RemoteSource
  -------------------------------------------------------------- */
  function RemoteSource(ws, side) {
    this.ws = ws; this.side = side; this.last = blank(); this.frame = 0;
    var self = this;
    if (ws && ws.addEventListener) ws.addEventListener('message', function (ev) {
      try { var msg = JSON.parse(ev.data); if (msg.t === 'i' && msg.side !== self.side) self.last = msg; } catch (e) { }
    });
  }
  RemoteSource.prototype.poll = function () { var o = Object.assign(blank(), this.last); return o; };
  /* ---------- N3（NET.md §9.1/§9.2）：远端输入源——房主每 tick 消费一条 guest 的 input 帧 ----------
     帧形 {keys:{fwd,back,left,right,jump,crouch,cast}, yaw, pitch}：与 KeyboardSource/AISource 产出同一种指令流，
     权威层不为联网开后门（Match.step 只认 poll 出来的指令）。
     队列 FIFO，poll 每 tick 取一条；缺帧 = 空白输入（guest 掉线不许把角色推着继续走，也不许沿用上一帧的出牌）。
     yaw/pitch 是【绝对角】（guest 的镜像上鼠标/键盘已作用过），不进 lookYaw/lookPitch 增量通道——
     否则房主按增量再转一遍，同一次鼠标位移被吃两次。 */
  function RemoteInputSource() { this.queue = []; }
  RemoteInputSource.prototype.push = function (msg) {
    if (!msg || typeof msg !== 'object') return false;
    var one = { keys: msg.keys || null, yaw: msg.yaw, pitch: msg.pitch };   // 只收这三样，帧外的字段不落地
    if (this.queue.length >= 8) this.queue.shift();   // 房主 tick 落后/刷帧时丢最旧：输入债不许堆积
    this.queue.push(one);
    return true;
  };
  RemoteInputSource.prototype.poll = function (dt) {
    var msg = this.queue.shift();
    var o = (G.blankInput ? G.blankInput() : blank());
    if (!msg) return o;                                // 缺帧 = 空白输入
    var k = msg.keys || {};
    o.fwd = k.fwd ? 1 : 0; o.back = k.back ? 1 : 0; o.left = k.left ? 1 : 0; o.right = k.right ? 1 : 0;
    o.jump = k.jump ? 1 : 0; o.crouch = k.crouch ? 1 : 0; o.sprint = k.sprint ? 1 : 0;
    o.cast = (typeof k.cast === 'number') ? k.cast : -1;
    o.lookYaw = 0; o.lookPitch = 0;                     // 朝向走 applyTo（绝对角），这里恒 0
    return o;
  };
  /* 把远端绝对朝向写到权威玩家身上。夹取用唯一真源 G.LOOK_LIMIT：
     该表当前形状是 {up, down}（battle.js 定义，movement.applyLook 同口径），没有 yaw 上下界——
     yaw 是自由角，只归一化到 (-π,π]（同 applyLook，防累成大数让相机绕远路）；
     若日后表里出现 yaw/pitch 字段（任务书 N1 的写法），这里同样按它夹。 */
  RemoteInputSource.applyTo = function (p, msg) {
    if (!p || !msg) return;
    var L = G.LOOK_LIMIT || { up: 89 * Math.PI / 180, down: -89 * Math.PI / 180 };
    if (typeof msg.pitch === 'number' && isFinite(msg.pitch)) {
      var up = (typeof L.pitch === 'number' && isFinite(L.pitch)) ? Math.abs(L.pitch)
        : (typeof L.up === 'number' ? L.up : 89 * Math.PI / 180);
      var down = (typeof L.pitch === 'number' && isFinite(L.pitch)) ? -up
        : (typeof L.down === 'number' ? L.down : -up);
      p.pitch = Math.max(down, Math.min(up, msg.pitch));
    }
    if (typeof msg.yaw === 'number' && isFinite(msg.yaw)) {
      var y = msg.yaw;
      if (typeof L.yaw === 'number' && isFinite(L.yaw)) { var yl = Math.abs(L.yaw); y = Math.max(-yl, Math.min(yl, y)); }
      y = ((y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      p.yaw = y;
    }
  };

  G.Net = { KeyboardSource: KeyboardSource, AISource: AISource, RemoteSource: RemoteSource, RemoteInputSource: RemoteInputSource };
})(window.GW);
