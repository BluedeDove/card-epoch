/* ================= GW.HUD =================
   DOM 覆盖层：手牌、资源条、准星信息、日志、菜单、结算。
   卡面图案用 canvas 程序化绘制（像素风，不依赖图片文件）。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  function el(id) { return document.getElementById(id); }
  var refs = {}, handSig = ['', ''];
  var H = G.HUD = { sel: [0, 0] };

  H.init = function (handlers) {
    refs = {
      seed: el('ui-seed'), time: el('ui-time'), tick: el('ui-tick'), fps: el('ui-fps'),
      biome: el('ui-biome'), mode: el('ui-mode'), log: el('log'), toast: el('toast'),
      cross: el('cross'), aim: el('aiminfo'), hand: [el('hand1'), el('hand2')],
      cam: el('ui-cam'), err: el('ui-err'),
      help: el('help')
    };
    H.handlers = handlers || {};
    el('btnStart').onclick = function () { G.Audio.resume(); H.handlers.start && H.handlers.start(H.config()); };
    el('btnHelp').onclick = function () { H.spec(true); };
    el('seedRand').onclick = function () { el('seedInput').value = String(Math.floor(Math.random() * 999999)); };
    el('btnAgain').onclick = function () { H.hideResult(); H.handlers.start && H.handlers.start(H.config(true)); };
    el('btnNew').onclick = function () { var s = String(Math.floor(Math.random() * 999999)); el('seedInput').value = s; H.hideResult(); H.handlers.start && H.handlers.start(H.config()); };
    el('btnMenu').onclick = function () { H.hideResult(); H.showMenu(); };
    Array.prototype.forEach.call(el('modeRow').children, function (b) {
      b.onclick = function () {
        if (b.dataset.mode === 'net') { H.toast('联网 PVP 需先启动 server.js（接口已预留）', '#ff9f9f'); return; }
        Array.prototype.forEach.call(el('modeRow').children, function (x) { x.classList.remove('on'); });
        b.classList.add('on'); G.Audio.play('ui');
      };
    });
    Array.prototype.forEach.call(el('deckRow').children, function (b) {
      b.onclick = function () {
        Array.prototype.forEach.call(el('deckRow').children, function (x) { x.classList.remove('on'); });
        b.classList.add('on'); G.Audio.play('ui');
      };
    });
    H.spec(false);
    // 页面加载即处于菜单：先淡出战斗 HUD，避免与菜单面板叠字
    if (document.getElementById('menu') && !document.getElementById('menu').classList.contains('hidden')) {
      if (document.getElementById('hud')) document.getElementById('hud').style.opacity = '0';
    }
  };
  H.config = function (keepSeed) {
    var mb = el('modeRow').querySelector('.on') || el('modeRow').children[0];
    var db = el('deckRow').querySelector('.on') || el('deckRow').children[0];
    var s = el('seedInput').value.trim();
    if (!s || !keepSeed) { s = s || String(Math.floor(Math.random() * 999999)); el('seedInput').value = s; }
    return { mode: mb.dataset.mode, deck: db.dataset.deck, seed: s };
  };
  H.spec = function (force) {
    var box = el('spec');
    if (!box) return;
    if (!box.dataset.done || force) {
      box.innerHTML =
        '<span>验收</span><span>同种子两次开局地形逐格一致 · 地形改动本局持久 · 除移动外操作必须出牌</span>' +
        '<span>数值</span><span>1 魔力 = 6 伤害 = 5 护盾 = 1 格地形；单卡地形 ≤ 9 格</span>' +
        '<span>内容</span><span>' + G.CARDS.length + ' 张卡 · 6 流派 · ' + Object.keys(G.SIGILS).length + ' 种魔法阵 · 3 个生物群系</span>' +
        '<span>引擎</span><span>逻辑 20Hz 权威 tick，渲染与逻辑分离；越肩相机遮挡自动收缩</span>';
      box.dataset.done = '1';
    }
  };
  H.showMenu = function () { el('menu').classList.remove('hidden'); if (el('hud')) el('hud').style.opacity = '0'; };
  H.hideMenu = function () { el('menu').classList.add('hidden'); if (el('hud')) el('hud').style.opacity = '1'; };
  H.showResult = function () { el('result').classList.remove('hidden'); if (el('hud')) el('hud').classList.add('no-aim'); };
  H.hideResult = function () { el('result').classList.add('hidden'); if (el('hud')) el('hud').classList.remove('no-aim'); };

  var logs = [];
  var now = function () { return (performance.now() / 1000); };
  H.log = function (msg, color) {
    color = color || '#e7e3ff';
    var last = logs[logs.length - 1];
    if (last && last.msg === msg && last.color === color && now() - last.t < 1.6) {
      last.n = (last.n || 1) + 1; last.t = now();
    } else {
      logs.push({ msg: msg, color: color, t: now(), n: 1 });
      if (logs.length > 8) logs.shift();
    }
    if (!refs.log) return;
    refs.log.innerHTML = logs.map(function (l) { return '<div style="color:' + l.color + '">' + esc(l.msg) + (l.n > 1 ? ' ×' + l.n : '') + '</div>'; }).join('');
  };
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  var toastT = 0;
  H.toast = function (msg, color) {
    if (!refs.toast) return;
    refs.toast.innerHTML = esc(msg); refs.toast.style.color = color || '#ffd86b';
    refs.toast.classList.add('on'); toastT = 1.1;
  };
  H.tickTimers = function (dt) { if (toastT > 0) { toastT -= dt; if (toastT <= 0) refs.toast.classList.remove('on'); } };

  /* ---------- 像素卡面图案 ---------- */
  function art(canvas, card) {
    var s = 16, c = canvas.getContext('2d');
    canvas.width = s; canvas.height = s;
    c.imageSmoothingEnabled = false;
    var col = G.ELEMENTS[card.element].color, ac = G.ELEMENTS[card.element].accent;
    c.fillStyle = '#0a0813'; c.fillRect(0, 0, s, s);
    function px(x, y, cc) { c.fillStyle = cc; c.fillRect(x, y, 1, 1); }
    function rect(x, y, w, h, cc) { c.fillStyle = cc; c.fillRect(x, y, w, h); }
    function diamond(cx, cy, r, cc) { for (var y = -r; y <= r; y++) for (var x = -r; x <= r; x++) if (Math.abs(x) + Math.abs(y) <= r) px(cx + x, cy + y, cc); }
    var k = card.art;
    // 背景条纹（按类型区分底纹）
    for (var y = 0; y < s; y += 4) for (var x = 0; x < s; x++) px(x, y, ac);
    if (k === 'flame' || k === 'burst') { diamond(8, 9, 4, col); diamond(8, 9, 2, '#fff3c4'); for (var i = 0; i < 6; i++) px(4 + i * 2, 3 + (i % 2), col); }
    else if (k === 'bolt' || k === 'shard') { rect(7, 2, 2, 12, col); rect(5, 4, 6, 2, col); rect(4, 3, 2, 2, '#fff'); }
    else if (k === 'pillar' || k === 'cube') { rect(4, 6, 8, 8, col); rect(4, 6, 8, 2, '#fff2'); rect(3, 5, 10, 1, ac); for (var q = 0; q < 8; q++) px(5 + (q % 4) * 2, 9 + (q >> 2), ac); }
    else if (k === 'fence' || k === 'wallfire') { for (var b = 0; b < 3; b++) { rect(3 + b * 4, 5, 3, 9, col); rect(2 + b * 4, 4, 5, 2, ac); } if (k === 'wallfire') diamond(8, 3, 2, '#ff7a45'); }
    else if (k === 'ring' || k === 'hammer') { c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.arc(8, 8, 5.2, 0, 6.283); c.stroke(); c.beginPath(); c.arc(8, 8, 2.6, 0, 6.283); c.stroke(); px(8, 8, '#fff'); if (k === 'hammer') rect(6, 2, 4, 3, col); }
    else if (k === 'leaf' || k === 'tree') { rect(7, 9, 2, 5, '#7a5230'); diamond(8, 6, 4, col); diamond(6, 7, 2, ac); }
    else if (k === 'golem') { rect(4, 4, 8, 9, col); rect(5, 6, 2, 2, '#0a0813'); rect(9, 6, 2, 2, '#0a0813'); rect(3, 13, 4, 2, ac); rect(9, 13, 4, 2, ac); }
    else if (k === 'snow') { for (var a = 0; a < 6; a++) { var an = a / 6 * 6.283; for (var r = 1; r < 6; r++) px(Math.round(8 + Math.cos(an) * r), Math.round(8 + Math.sin(an) * r), col); } px(8, 8, '#fff'); }
    else if (k === 'skull') { rect(5, 4, 6, 6, col); rect(6, 10, 4, 2, ac); rect(6, 6, 2, 2, '#0a0813'); rect(9, 6, 2, 2, '#0a0813'); }
    else if (k === 'eye') { diamond(8, 8, 5, col); diamond(8, 8, 2, '#0a0813'); px(8, 8, '#fff'); }
    else if (k === 'spiral') { for (var t = 0; t < 34; t++) { var th = t * 0.45, rr = 1 + t * 0.13; px(Math.round(8 + Math.cos(th) * rr), Math.round(8 + Math.sin(th) * rr), col); } }
    else if (k === 'pick') { rect(4, 11, 8, 2, '#8b8b93'); rect(7, 4, 2, 8, '#7a5230'); rect(3, 3, 6, 2, col); }
    else if (k === 'shield' || k === 'anchor') { diamond(8, 8, 5, col); diamond(8, 8, 3, ac); px(8, 8, '#fff'); }
    else if (k === 'down' || k === 'ramp') { for (var i2 = 0; i2 < 5; i2++) rect(3 + i2 * 2, 11 - i2 * 2, 2, 2 + i2 * 2, col); }
    else if (k === 'bridge' || k === 'shift') { for (var x2 = 2; x2 < 14; x2 += 3) rect(x2, 8, 2, 3, col); rect(2, 11, 12, 1, ac); }
    else if (k === 'spike') { for (var p = 0; p < 4; p++) { var bx = 3 + p * 3; for (var hh = 0; hh < 3 + (p % 2) * 2; hh++) px(bx, 12 - hh, col); } }
    else if (k === 'lava') { rect(2, 9, 12, 5, '#c8341a'); for (var l = 0; l < 10; l++) px(2 + Math.floor(Math.random() * 12), 9 + Math.floor(Math.random() * 5), Math.random() < .5 ? '#ffe066' : '#ff7519'); }
    else if (k === 'crystal') { diamond(8, 8, 4, col); for (var yv = 4; yv < 12; yv++) px(8, yv, '#fff'); }
    else if (k === 'plus') { rect(7, 4, 2, 9, col); rect(4, 8, 9, 2, col); }
    else if (k === 'bird') { rect(6, 7, 5, 4, col); rect(3, 5, 4, 2, ac); rect(10, 6, 3, 2, ac); px(11, 7, '#fff'); }
    else if (k === 'vine') { for (var t2 = 0; t2 < 12; t2++) px(Math.round(8 + Math.sin(t2 * .8) * 4), 2 + t2, col); }
    else if (k === 'battery' || k === 'totem') { rect(5, 3, 6, 11, col); rect(6, 2, 4, 1, ac); rect(6, 6, 4, 2, '#fff2'); rect(7, 9, 2, 3, ac); }
    else if (k === 'trap') { rect(3, 10, 10, 2, col); for (var tp = 0; tp < 5; tp++) px(4 + tp * 2, 7, ac); }
    else if (k === 'shatter') { rect(4, 4, 8, 8, col); c.strokeStyle = '#0a0813'; c.beginPath(); c.moveTo(4, 12); c.lineTo(12, 4); c.stroke(); }
    else if (k === 'star') { diamond(8, 8, 5, col); rect(7, 1, 2, 14, ac); rect(1, 7, 14, 2, ac); }
    else if (k === 'lava' || k === 'burst') { diamond(8, 8, 5, col); }
    else { rect(3, 3, 10, 10, col); rect(5, 5, 6, 6, ac); px(8, 8, '#fff'); }
    // 边框
    c.strokeStyle = card.rarity === 'rare' ? '#ffd86b' : (card.rarity === 'uncommon' ? '#5b8fd8' : '#3a2f5c');
    c.lineWidth = 1; c.strokeRect(0.5, 0.5, s - 1, s - 1);
  }

  H.renderHands = function (match, split) {
    var sides = split ? [0, 1] : [0];
    for (var sIdx = 0; sIdx < sides.length; sIdx++) {
      var side = sides[sIdx], p = match.players[side], box = refs.hand[side === 0 ? 0 : 1];
      if (!p || !box) continue;
      var sig = p.hand.join(',') + '|' + H.sel[side] + '|' + Math.floor(p.mana) + '|' + p.cooldowns._;
      if (handSig[side] === sig) continue;
      handSig[side] = sig;
      box.innerHTML = '';
      for (var i = 0; i < p.hand.length; i++) {
        var card = G.CARDS_BY_ID[p.hand[i]]; if (!card) continue;
        var d = document.createElement('div');
        var playable = G.Rules.canPlay(card, p, match.ctx).ok;
        d.className = 'card r-' + card.rarity + (i === H.sel[side] ? ' sel' : '') + (playable ? '' : ' deny');
        d.style.borderColor = i === H.sel[side] ? '#ffd86b' : G.ELEMENTS[card.element].accent;
        var cv = document.createElement('canvas');
        d.innerHTML = '<div class="cost">' + card.cost + '</div><div class="nm">' + esc(card.name) + '</div>' +
          '<div class="tp">' + (G.TYPE_CN[card.type] || card.type) + ' · ' + G.ELEMENTS[card.element].cn + '</div>' +
          '<div class="tx">' + esc(card.text) + '</div>' +
          (card.cooldown ? '<div class="cd">' + (p.cooldowns[card.id] ? p.cooldowns[card.id].toFixed(1) + 's' : 'CD ' + card.cooldown + 's') + '</div>' : '') +
          '<div class="rar">' + (G.RARITY_CN[card.rarity] || '') + '</div><div class="kb">' + (i + 1) + '</div>';
        art(cv, card);
        d.insertBefore(cv, d.children[1]);
        (function (ii) { d.onclick = function () { H.sel[side] = ii; G.Audio.resume(); match.fx && match.fx.requestCast && match.fx.requestCast(side, ii); if (match.playCard) {} H.cast(side, ii); }; })(i);
        box.appendChild(d);
      }
    }
  };
  H.cast = function (side, i) { if (H.handlers.cast) H.handlers.cast(side, i); };
  H.invalidate = function () { handSig = ['', '']; };
  H.setSplit = function (on) {
    refs.hand[1].style.display = on ? 'flex' : 'none';
    el('v2').style.display = on ? 'block' : 'none';
    // 分屏时左右视口各一个准星，否则 P2 没有瞄准基准
    if (!refs.cross2) {
      refs.cross2 = document.createElement('div');
      refs.cross2.id = 'cross';
      refs.cross.parentNode.appendChild(refs.cross2);
    }
    refs.cross.style.display = 'block';
    refs.cross.style.left = on ? '25%' : '50%';
    refs.cross2.style.display = on ? 'block' : 'none';
    refs.cross2.style.left = '75%';
    if (window.__layoutSplit) window.__layoutSplit(!!on);
    refs.aim.style.display = on ? 'none' : 'block';
  };
  H.update = function (match, split) {
    var sides = split ? [0, 1] : [0];
    for (var s = 0; s < 2; s++) {
      var p = match.players[s]; if (!p) continue;
      var pre = s + 1;
      setW('ui-hp' + pre, p.hp / p.maxHp * 100); setText('ui-hpt' + pre, Math.max(0, Math.ceil(p.hp)) + '/' + p.maxHp + (p.st.burn > 0 ? ' 🔥' : '') + (p.st.frozen > 0 ? ' ❄' : '') + (p.st.root > 0 ? ' ⛓' : '') + (p.st.vuln > 0 ? ' 💢' : ''));
      setW('ui-sh' + pre, Math.min(100, (p.shield || 0) / 30 * 100)); setText('ui-sht' + pre, '护盾 ' + Math.floor(p.shield || 0));
      setW('ui-mn' + pre, p.mana / p.manaCap * 100); setText('ui-mnt' + pre, '魔力 ' + p.mana + '/' + p.manaCap);
      setText('ui-mat' + pre, String(p.mats)); setText('ui-dk' + pre, String(p.deck.length));
      setText('ui-ds' + pre, String(p.discard.length)); setText('ui-k' + pre, String(p.kills));
      setText('ui-n' + pre, p.name + (p.alive ? '' : ' (倒下 ' + p.respawn.toFixed(1) + 's)'));
      setText('ui-l' + pre, '♥'.repeat(Math.max(0, p.lives)) || '—');
      if (sides.indexOf(s) < 0) continue;
      H.renderHands(match, split && s === 1 ? true : split);
    }
    setText('ui-seed', String(match.seed));
    setText('ui-time', match.time.toFixed(1));
    setText('ui-tick', String(match.tick));
    setText('ui-mode', { train: '训练 vs AI', split: '分屏 PVP', hotseat: '热座 PVP', net: '联网 PVP' }[match.mode] || match.mode);
    var camObj = window.GWAPP && window.GWAPP.cams && window.GWAPP.cams[0];
    if (refs.cam && camObj) refs.cam.textContent = camObj.modeName ? camObj.modeName() : camObj.mode;
    if (refs.err) refs.err.style.display = (window.GWAPP && window.GWAPP.stepErrors) ? '' : 'none';
    var p0 = match.players[0];
    if (p0) setText('ui-biome', match.world.biomeNames[match.world.biomeAt(Math.floor(p0.pos.x), Math.floor(p0.pos.z))] ? match.world.biomeCN[match.world.biomeAt(Math.floor(p0.pos.x), Math.floor(p0.pos.z))] : '—');
  };
  H.aimInfo = function (txt, hit) {
    // 无目标时整块隐藏：留着会是一个压在准星下方的小灰块（内联 display 覆盖 CSS class）
    if (refs.aim) { refs.aim.innerHTML = esc(txt || ''); refs.aim.style.display = txt ? 'block' : 'none'; }
    if (refs.cross) refs.cross.classList.toggle('hit', !!hit);
  };
  function setW(id, v) { var e = el(id); if (e) e.style.width = Math.max(0, Math.min(100, v)) + '%'; }
  function setText(id, v) { var e = el(id); if (e) e.innerHTML = v; }
  H.fps = function (v) { setText('ui-fps', String(v)); };
})(window.GW);
