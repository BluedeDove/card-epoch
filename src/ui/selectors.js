/* js/ui/selectors.js · 派生视图模型（纯函数；S3 的 selector 层）
   输入 AppLike = { match, ui, cards }，输出面板要读的扁平字段。
   规矩：
     · 只读、不写、不碰 DOM、不出文案；
     · key() 只由 rev / ui 字段拼成，面板用它判断要不要重算；
     · 同一份状态永远得到同一份输出（可直接在 node 里断言）。
   现状：match 还是 Match 实例（S1 之后是 GameState.game），接口不变。 */
window.GW = window.GW || {};
(function (G) {
  'use strict';

  function mOf(app) { return (app && (app.match || (app.game && app.game.match))) || null; }
  function p0(app) { var m = mOf(app); return m && m.players ? m.players[0] : null; }
  function rev(app, which, i) {
    var m = mOf(app);
    if (!m) return 0;
    if (which === 'player') return (m.players && m.players[i || 0] && m.players[i || 0].rev) || 0;
    if (which === 'match') return m.rev || 0;
    return m.rev || 0;
  }
  function repeatHearts(n) { var t = ''; for (var i = 0; i < Math.max(0, n | 0); i++) t += '\u2665'; return t; }
  function uiRev(app) { return (app && app.ui && app.ui.rev) || 0; }

  var hud = {
    key: function (app) {
      return [rev(app, 'player', 0), rev(app, 'player', 1), uiRev(app),
              (app.ui && app.ui.sel ? app.ui.sel.join(',') : '')].join('|');
    },
    /* deps 缺省 = 原始字段（node 断言用）；传 deps（fmt/makeItem/ask/split）= 玩家/手持栏的完整视图模型，
       与旧 ViewModel 的格式逐字段一致。这样 HUD 的玩家数据只有一个翻译处。 */
    get: function (app, deps) {
      var m = mOf(app), out = { players: [], hands: [[], []] };
      if (!m) return out;
      out.tick = String(m.tick || 0);
      out.time = (m.time || 0).toFixed(1);
      out.seed = String(m.seed != null ? m.seed : '—');
      out.over = m.over || null;
      if (!deps) {
        for (var s0 = 0; s0 < m.players.length && s0 < 2; s0++) {
          var q0 = m.players[s0];
          out.players.push({ side: s0, name: q0.name, alive: !!q0.alive, hp: q0.hp, maxHp: q0.maxHp,
            hpRatio: q0.maxHp ? Math.max(0, Math.min(1, q0.hp / q0.maxHp)) : 0,
            shield: q0.shield || 0, mana: q0.mana, manaCap: q0.manaCap, mats: q0.mats,
            score: q0.score | 0, kills: q0.kills | 0, lives: q0.lives | 0,
            deckN: q0.deck ? q0.deck.length : 0, discardN: q0.discard ? q0.discard.length : 0,
            handClass: q0.handClass || 'all' });
          var h0 = out.hands[s0];
          for (var j0 = 0; j0 < 5; j0++) { var id0 = q0.hand ? q0.hand[j0] : null; h0[j0] = id0 ? { kind: 'card', id: id0, count: 1 } : null; }
        }
        return out;
      }
      var fmt = deps.fmt || {}, makeItem = deps.makeItem || null;
      var ask = deps.ask || function () { return null; };
      var split = !!deps.split;
      out.discard = [];
      for (var s = 0; s < 2; s++) {
        var p = m.players ? m.players[s] : null;
        if (!p) { out.players.push(null); continue; }
        var infMana = !!(p.creative && p.creative.infiniteMana);
        out.players.push({
          name: p.name || ('P' + (s + 1)),
          alive: !!p.alive,
          lives: p.lives > 0 ? repeatHearts(p.lives) : '—',
          respawn: p.alive ? '' : (fmt.respawn ? fmt.respawn(p.respawn || 0) : ''),
          hpRatio: p.maxHp ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 0,
          hpLow: !!(p.maxHp && p.hp / p.maxHp <= 0.3),
          statusList: fmt.status ? fmt.status(p) : [],
          hpText: fmt.hp ? fmt.hp(p) : String(Math.max(0, Math.ceil(p.hp)) + '/' + p.maxHp),
          shRatio: Math.max(0, Math.min(1, (p.shield || 0) / 30)),
          shText: fmt.sh ? fmt.sh(p) : String(Math.floor(p.shield || 0)),
          mnRatio: p.manaCap ? Math.max(0, Math.min(1, p.mana / p.manaCap)) : 0,
          mnText: infMana ? (fmt.manaInf ? fmt.manaInf(p) : '∞') : (fmt.mana ? fmt.mana(p) : (p.mana + '/' + p.manaCap)),
          matText: String(p.mats | 0),
          deckText: String(p.deck ? p.deck.length : 0),
          discardText: String(p.discard ? p.discard.length : 0),
          killText: String(p.kills | 0),
          deckN: p.deck ? p.deck.length : 0,
          classKey: p.handClass || 'all',
          classLabel: (function () { var L = ask('classLabels') || {}; var k = p.handClass || 'all'; return L[k] || k; })(),
          mana: p.mana, manaCap: p.manaCap, mats: p.mats
        });
        var hand = out.hands[s];
        for (var i = 0; i < 5; i++) {
          var id = p.hand ? p.hand[i] : null;
          if (!id) { hand[i] = null; continue; }
          var cd = p.cooldowns ? (p.cooldowns[id] || 0) : 0;
          var card = G.CARDS_BY_ID ? G.CARDS_BY_ID[id] : null;
          var can = ask('canPlay', card, p, m);
          hand[i] = makeItem ? makeItem('card', id, 1, { cd: cd, card: card, deny: can ? can.ok === false : false }) : null;
        }
        if (s === 1 && !split) out.hands[1] = [];
        if (s === 0 && p.discard) {
          var recent = p.discard.slice(-9);
          for (var d = recent.length - 1; d >= 0; d--) {
            var it = makeItem ? makeItem('card', recent[d], 1, { seq: p.discard.length - d }) : null;
            if (it) out.discard.push(it);
          }
        }
      }
      return out;
    }
  };

  var bag = {
    key: function (app) {
      var u = (app && app.ui) || {};
      var b = u.bag || {};
      return [rev(app, 'player', 0), uiRev(app), b.profile || '', b.page || '',
              (u.filters && [u.filters.tab, u.filters.el, u.filters.ty, u.filters.q].join(',')) || ''].join('|');
    },
    get: function (app) {
      var u = (app && app.ui) || {};
      var b = u.bag || {};
      var forced = b.profile && G.BAG_PROFILES ? G.BAG_PROFILES[b.profile] : null;
      var prof = forced || (G.bagProfileFor
        ? G.bagProfileFor((mOf(app) && mOf(app).cfg) || { debug: { creative: !!(p0(app) && p0(app).creative) } },
                          (mOf(app) && mOf(app).modeState) || {})
        : null);
      if (!prof) return { profile: null, pages: [], caps: {} };
      var pages = [];
      for (var i = 0; i < prof.pages.length; i++) {
        var key = prof.pages[i];
        var src = G.CardSources && G.CardSources[key];
        if (!src) continue;
        var snap = src.snapshot(app, b.side || 0);
        pages.push({ key: key, labelKey: src.page.labelKey, layout: src.page.layout, cols: src.page.cols,
                     items: snap.items, total: snap.total, extra: snap.extra || null, caps: src.caps });
      }
      return { profile: prof, pages: pages, caps: prof.caps, page: b.page || prof.pages[0] };
    }
  };

  var result = {
    key: function (app) { return [rev(app, 'match'), uiRev(app)].join('|'); },
    get: function (app) {
      var m = mOf(app);
      if (!m || !m.over) return null;
      return { over: m.over, stats: G.MatchStats && G.MatchStats.snapshot ? G.MatchStats.snapshot(m) : null };
    }
  };

  G.Selectors = { hud: hud, bag: bag, result: result };
})(window.GW);
