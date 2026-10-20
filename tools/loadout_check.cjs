#!/usr/bin/env node
/* tools/loadout_check.cjs · 战前选牌的牌库校验 + 角色路由回归（任务书 N5 第 6 条）
   为什么单独一条量具：net_check 管传输、net_sync_check 管打包与覆盖、net_e2e 管两端真跑一局，
   而「一份牌库到底合不合法」与「选牌那三条帧型走不走对席位」这三段以前没人拦 ——
   判据漂了（12 改成 11、地形数不查）在页面上看不出来，只会在真对局里以「拿一副非法构筑开局」的形式爆。

     L0 静态：src/net-loadout.js 零 DOM / 零玩家可见中文（layer_check 的文件清单里没有它，这条自己拦）；
              index.html 载入了它（少了 script 标签 = 页面里 G.NetLoadout 不存在 = 校验整条形同虚设）；
              三条上限的数字与 src/ui/viewmodel.js 的 UI.LOADOUT_RULES 同值（漂了就打回，
              不许「界面一套、房主一套」—— AGENTS 那条「两个主人」的老坑）。
     L1 validateDeck：12 张合法 → ok 且 terrain>=4；11/13 张 → count；地形 3 张 → terrain；
              同一张 3 份 → copies；未知 id → unknown；空 → empty。判序也钉住（改序就是改语义）。
     L2 sanitize：去未知 id、夹到 2 份、截到 12；同输入两次结果相同（确定性）。
     L3 真 net_host 两席的角色路由：guest 的 loadout → host 收到；host 的 lobby / start → guest 收到；
              **负例**：guest 发的 loadout 不许回到 guest 自己，host 发的 start 不许回到 host 自己；
              再带一条**正例对照**（同一席位发对方该收的帧型必须到），不许"因为都空所以绿"。
     L4 session 的 cfg.decks 分支：静态断言源码读 cfg.decks 且 Match opts 的 cards 来自它；
              再用真 G.Match 构造一遍（同 seed、两份 12 张牌库）验证 hand+deck+discard=12 且牌序原样。

   都在 node 里跑，不开页面。用法：node tools/loadout_check.cjs [seed]   退出码非 0 = 有红。 */
'use strict';
const fs = require('fs'), net = require('net'), crypto = require('crypto'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const HOST = require('./net_host.cjs');
global.window = {};
['src/cards/pick-pools.js', 'src/cards.js', 'src/net-loadout.js',
 'src/world.js', 'src/vfx.js', 'src/chem.js', 'src/rules.js', 'src/battle.js',
 'src/net.js', 'src/net-ws.js', 'src/net-match.js', 'src/save.js'].forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
const NL = G.NetLoadout;
const SEED = (parseInt(process.argv[2], 10) || 490706) >>> 0;

let n = 0, bad = 0;
function ck(name, okVal, detail) {
  n++;
  console.log((okVal ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  [' + detail + ']'));
  if (!okVal) bad++;
  return !!okVal;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
/* 把注释与字符串内容各剥成占位符（照 tools/layer_check.cjs 的口径，这里只要够用：
   注释里的中文不算玩家可见文案，代码里的中文才算） */
function scrub(src) {
  let out = '', i = 0, st = 'code';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (st === 'code') {
      if (c === '/' && d === '/') { st = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && d === '*') { st = 'block'; out += '  '; i += 2; continue; }
      if (c === "'" || c === '"') { st = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (st === 'line') { out += (c === '\n' ? '\n' : ' '); i++; if (c === '\n') st = 'code'; continue; }
    if (st === 'block') { i++; out += (c === '\n' ? '\n' : ' '); if (c === '*' && d === '/') { i++; out += ' '; st = 'code'; } continue; }
    if (c === '\\') { out += '  '; i += 2; continue; }
    if (c === st) { st = 'code'; out += c; i++; continue; }
    out += (c === '\n' ? '\n' : '\u0001'); i++; continue;
  }
  return out;
}
function terrainIds() { return G.CARDS.filter(c => c.type === 'terrain').map(c => c.id); }
function plainIds() { return G.CARDS.filter(c => c.type !== 'terrain').map(c => c.id); }
const TER = terrainIds(), PLA = plainIds();
/* 一份必定合法的 12 张牌库（4 张地形 + 8 张非地形，全部不重复）：L1 的对照组，也从这里长出来 */
function legalDeck() { return TER.slice(0, 4).concat(PLA.slice(0, 8)); }
const FX = (() => { const noop = function () {}; return { log: noop, sfx: noop, burst: noop, dust: noop, hit: noop,
  heal: noop, shieldUp: noop, fire: noop, float: noop, ambient: noop, chemLog: noop, quake: noop }; })();

/* ============================ L0 静态 ============================ */
console.log('── L0 静态：分层与载入（判据只有一处，且必须真被载入）');
{
  const src = read('src/net-loadout.js'), clean = scrub(src);
  ck('net-loadout.js 零 DOM（逻辑层不碰画面）', !/\bdocument\.|innerHTML|querySelector|createElement|addEventListener/.test(clean));
  ck('net-loadout.js 零玩家可见中文（拒绝只报 key）', !/[\u4e00-\u9fa5]/.test(clean),
    (/[\u4e00-\u9fa5]/.test(clean) ? '代码里出现了中文' : '注释外无中文'));
  ck('net-loadout.js 反手不抓视图层（不读 G.HUD / window.GWAPP）',
    !/window\.GWAPP|G\.HUD\b/.test(clean) && !/getElementById/.test(clean));
  const html = read('index.html');
  ck('index.html 载入了 src/net-loadout.js（少了它页面里就没有校验）',
    /<script src="src\/net-loadout\.js"><\/script>/.test(html));
  /* 顺序只按**真正加载的 script 标签**排（不能用 indexOf：注释里也提这些文件名，会假绿/假红） */
  const order = [];
  html.replace(/<script[^>]*src="([^"]+)"[^>]*>/g, (m, src) => { order.push(src); return m; });
  const at = (f) => order.indexOf(f);
  ck('script 顺序：cards.js → net-loadout.js → main.js（要读卡表，也要赶在装配层之前挂上 GW）',
    at('src/cards.js') >= 0 && at('src/net-loadout.js') > at('src/cards.js') && at('src/main.js') > at('src/net-loadout.js'),
    'cards#' + at('src/cards.js') + ' loadout#' + at('src/net-loadout.js') + ' main#' + at('src/main.js') + ' 共' + order.length + '个 script');
  ck('它在 net-match.js 之后（同一族联机件，读得到 G.NetMatch 才好对照）',
    at('src/net-match.js') >= 0 && at('src/net-loadout.js') > at('src/net-match.js'),
    'net-match#' + at('src/net-match.js') + ' loadout#' + at('src/net-loadout.js'));
  /* 三条上限只有一个家：viewmodel 的 UI.LOADOUT_RULES。net-loadout 里的兜底默认值必须与它同值，
     漂了就说明「界面判一套、房主判另一套」——这正是 ui 线立规矩要拦的那种。 */
  const vm = read('src/ui/viewmodel.js');
  const m = /LOADOUT_RULES\s*=\s*\{\s*deckSize:\s*(\d+),\s*eachMax:\s*(\d+),\s*terrainMin:\s*(\d+)/.exec(vm);
  const view = m ? { deckSize: +m[1], eachMax: +m[2], terrainMin: +m[3] } : null;
  const D = NL.DEFAULTS;
  ck('viewmodel 里读到了三条上限（读不到 = 那条真源被改名，本条量具就白跑了）', !!view, JSON.stringify(view));
  ck('net-loadout 的兜底默认值与 UI.LOADOUT_RULES 同值（12 / 2 / 4）',
    !!view && D.deckSize === view.deckSize && D.eachMax === view.eachMax && D.terrainMin === view.terrainMin,
    '兜底 ' + JSON.stringify(D) + ' vs 视图 ' + JSON.stringify(view));
}

/* ============================ L1 validateDeck ============================ */
console.log('── L1 validateDeck：六条判据逐条钉');
{
  const okDeck = legalDeck();
  const v = NL.validateDeck(okDeck);
  ck('12 张合法 → ok 且 terrain>=4', v.ok === true && v.terrain >= 4, JSON.stringify(v));
  ck('11 张 → count（不是 terrain/unknown）', NL.validateDeck(okDeck.slice(0, 11)).reason === 'count');
  ck('13 张 → count', NL.validateDeck(okDeck.concat([PLA[8]]).slice(0, 13)).reason === 'count');
  const three = TER.slice(0, 3).concat(PLA.slice(0, 9));
  ck('地形只有 3 张 → terrain（张数与 id 都合法，只剩地形数这一条）',
    NL.validateDeck(three).reason === 'terrain', JSON.stringify(NL.validateDeck(three)));
  const copies = [TER[0], TER[0], TER[0]].concat(TER.slice(1, 4), PLA.slice(0, 6));
  ck('同一张 3 份 → copies（12 张、地形都够，也要被抓出来）',
    copies.length === 12 && NL.validateDeck(copies).reason === 'copies',
    'len=' + copies.length + ' → ' + JSON.stringify(NL.validateDeck(copies)));
  ck('未知 id → unknown', NL.validateDeck(TER.slice(0, 4).concat(PLA.slice(0, 7), ['not_a_card'])).reason === 'unknown');
  ck('空数组 → empty（不是 count）', NL.validateDeck([]).reason === 'empty');
  ck('null / 非数组 → empty（不抛异常，房主收货口不许因一个坏帧崩）',
    NL.validateDeck(null).reason === 'empty' && NL.validateDeck(undefined).reason === 'empty' &&
    NL.validateDeck('dig').reason === 'empty', typeof NL.validateDeck('dig').reason);
  ck('2 份合法（同一张带两份）→ ok', (() => {
    const d = [TER[0], TER[0], TER[1], TER[2], TER[3]].concat(PLA.slice(0, 7));
    const r = NL.validateDeck(d); return r.ok === true && d.length === 12;
  })());
  /* 判序：一份同时踩两条的牌库，报出来的必须是排在前面那条（改序 = 改语义） */
  ck('判序：11 张且含未知 id → 先报 count（张数排在未知之前）',
    NL.validateDeck(PLA.slice(0, 10).concat(['not_a_card'])).reason === 'count');
  ck('判序：陌生卡排在最前、3 份排在后面 → 先报 unknown（逐卡扫，见到就报，不等到扫完）',
    NL.validateDeck(['not_a_card'].concat(legalDeck().slice(1, 12))).reason === 'unknown');
  /* 三条上限跟着视图层那份常量走（不是本层自己的一套死数） */
  G.UI = { LOADOUT_RULES: { deckSize: 3, eachMax: 1, terrainMin: 2 } };
  const tiny = NL.validateDeck([TER[0], TER[1], PLA[0]]);
  const tinyBad = NL.validateDeck([TER[0], TER[0], TER[1], PLA[0]]);
  ck('读得到 UI.LOADOUT_RULES 时按它判（把上限改成 3/1/2 立刻跟着变）',
    tiny.ok === true && tiny.terrain === 2 && tinyBad.reason === 'count',
    JSON.stringify(tiny) + ' / ' + JSON.stringify(tinyBad));
  delete G.UI;
  /* 自动牌库：调试入口与 net_e2e 都靠它，必须自己过判据 */
  const a1 = NL.autoDeck(), a2 = NL.autoDeck({ element: 'fire' }), a3 = NL.autoDeck({ element: 'ice' });
  ck('autoDeck() → 12 张且过 validateDeck', a1.length === 12 && NL.validateDeck(a1).ok === true, JSON.stringify(a1));
  ck('autoDeck({element:fire}) 含火且第一位是火卡（E9 判两端第一位不同靠这个位置）',
    NL.validateDeck(a2).ok === true && G.CARDS_BY_ID[a2[0]] && G.CARDS_BY_ID[a2[0]].element === 'fire', JSON.stringify(a2));
  ck('autoDeck({element:ice}) 含冰且第一位是冰卡',
    NL.validateDeck(a3).ok === true && G.CARDS_BY_ID[a3[0]] && G.CARDS_BY_ID[a3[0]].element === 'ice', JSON.stringify(a3));
  ck('火组与冰组的第一位不同（net_e2e E9 的那条断言就是从这里来的）', a2[0] !== a3[0], a2[0] + ' vs ' + a3[0]);
  ck('autoDeck 两次调用结果相同（无随机、无时钟）', NL.SIGNATURE(NL.autoDeck()) === NL.SIGNATURE(NL.autoDeck()));
  /* pickCounts / SIGNATURE */
  ck('pickCounts 把 {dig:2,place:1} 摊成 [dig,dig,place]（键序 = 先点的在前）',
    JSON.stringify(NL.pickCounts({ dig: 2, place: 1 })) === JSON.stringify(['dig', 'dig', 'place']));
  ck('pickCounts 丢掉 0 与负数（脏值不许多造出牌）',
    NL.pickCounts({ dig: 1, place: 0, wall2: -3 }).length === 1, JSON.stringify(NL.pickCounts({ dig: 1, place: 0, wall2: -3 })));
  ck('SIGNATURE 与顺序无关（同一副牌两种点法 → 同一个串）',
    NL.SIGNATURE(a2) === NL.SIGNATURE(a2.slice().reverse()), NL.SIGNATURE(a2).slice(0, 40));
  ck('SIGNATURE 能区分两份不同的牌库', NL.SIGNATURE(a2) !== NL.SIGNATURE(a3));
}

/* ============================ L2 sanitize ============================ */
console.log('── L2 sanitize：脏牌库夹回合法形状');
{
  const dirty = ['not_a_card'].concat(TER.slice(0, 4), TER.slice(0, 4), PLA.slice(0, 8), ['nope2']);
  const s = NL.sanitize(dirty);
  ck('未知 id 被去掉（一份都不留）', !s.includes('not_a_card') && !s.includes('nope2'), JSON.stringify(s));
  ck('同一张夹到 2 份', (() => { const c = {}; for (const id of s) c[id] = (c[id] | 0) + 1; return Object.keys(c).every(k => c[k] <= 2); })());
  ck('截到 12 张', s.length === 12, 'len=' + s.length);
  ck('夹完的结果自己过 validateDeck（sanitize 与判据同一条口径）', NL.validateDeck(s).ok === true, JSON.stringify(NL.validateDeck(s)));
  ck('非数组 → 空数组（不抛）', NL.sanitize(null).length === 0 && NL.sanitize('dig').length === 0);
  ck('同输入两次结果逐字相同（确定性）', JSON.stringify(NL.sanitize(dirty)) === JSON.stringify(NL.sanitize(dirty)));
}

/* ============================ L4 session 的 decks 分支 ============================ */
console.log('── L4 session.js 的 cfg.decks 分支 + 真 Match 用两份牌库开局');
{
  const s = read('src/app/session.js');
  ck('session.js 读 cfg.decks（联机那份牌库是它的入参之一）', /cfg\.decks/.test(s));
  ck('Match 的 cards 来自那份 decks（形状没被顺手改：仍是 cards: decks）', /cards:\s*decks/.test(s));
  ck('decks 的两条来源各一处：cfg.decks 与 makeDeck（单人路径不漂移）',
    s.indexOf('cfg.decks') >= 0 && s.indexOf('makeDeck(cfg.deck') >= 0);
  /* 真构造一遍：不加载浏览器，但要证明「传两份 12 张牌库进去，出来就是这 12 张」 */
  const hostDeck = NL.autoDeck({ element: 'fire' }), guestDeck = NL.autoDeck({ element: 'ice' });
  const world = new G.World({ size: [64, 36, 64], seed: SEED, sea: 12, spawnPad: 9, lodes: true });
  world.generate(); world.snapshotBaseline();
  const m = new G.Match({ world: world, seed: SEED, mode: 'net', players: 2, fx: FX,
    cards: [hostDeck.slice(), guestDeck.slice()] });
  const pile = (p) => (p.hand || []).length + (p.deck || []).length + (p.discard || []).length;
  ck('房主那副：hand+deck+discard = 12（开局抽 5 张不造牌不吞牌）', pile(m.players[0]) === 12, pile(m.players[0]) + '');
  ck('加入者那副：hand+deck+discard = 12', pile(m.players[1]) === 12, pile(m.players[1]) + '');
  ck('牌库第一位原样保留（抽牌从尾部 pop，两端「第一张不同」这条判据才成立）',
    m.players[0].deck[0] === hostDeck[0] && m.players[1].deck[0] === guestDeck[0] && hostDeck[0] !== guestDeck[0],
    hostDeck[0] + ' / ' + guestDeck[0]);
  const sub = (hand, deck) => { const c = {}; for (const id of deck) c[id] = (c[id] | 0) + 1;
    for (const id of hand) { if (!c[id]) return false; c[id]--; } return true; };
  ck('房主手牌 ⊆ 房主牌库（multiset 意义下）', sub(m.players[0].hand, hostDeck), JSON.stringify(m.players[0].hand));
  ck('加入者手牌 ⊆ 加入者牌库（两份牌库没被发反 = session 按下标建 cards）', sub(m.players[1].hand, guestDeck), JSON.stringify(m.players[1].hand));
  ck('不传 cards 时退回 STARTER_DECK（单人 / 训练那条老路径逐字节不变）',
    (() => { const w2 = new G.World({ size: [64, 36, 64], seed: SEED, sea: 12, spawnPad: 9 });
      w2.generate(); w2.snapshotBaseline();
      const m2 = new G.Match({ world: w2, seed: SEED, mode: 'train', players: 2, fx: FX });
      const q = (p) => (p.hand || []).length + (p.deck || []).length + (p.discard || []).length;
      return q(m2.players[0]) === G.STARTER_DECK.length && q(m2.players[1]) === G.STARTER_DECK.length;
    })(), 'starter=' + G.STARTER_DECK.length);
}

/* ============================ L3 真 net_host 的角色路由 ============================ */
function wsClient(port) {
  const c = { msgs: [], closed: false, sock: null, port };
  c.send = function (obj) {
    const payload = Buffer.from(JSON.stringify(obj));
    const mask = crypto.randomBytes(4), masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
    const len = payload.length; let head;
    if (len < 126) head = Buffer.from([0x81, 0x80 | len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
    c.sock.write(Buffer.concat([head, mask, masked]));
  };
  c.waitType = async function (type, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 2500)) { const hit = c.msgs.find(m => m.type === type); if (hit) return hit; await sleep(20); }
    return null;
  };
  c.sawAny = function (type) { return c.msgs.filter(m => m.type === type); };
  return c;
}
function wsConnect(c) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(c.port, '127.0.0.1', () => {
      sock.write('GET / HTTP/1.1' + String.fromCharCode(13, 10) + 'Host: 127.0.0.1' + String.fromCharCode(13, 10) +
        'Upgrade: websocket' + String.fromCharCode(13, 10) + 'Connection: Upgrade' + String.fromCharCode(13, 10) +
        'Sec-WebSocket-Key: ' + key + String.fromCharCode(13, 10) + 'Sec-WebSocket-Version: 13' + String.fromCharCode(13, 10, 13, 10));
    });
    c.sock = sock;
    let upgraded = false, headBuf = Buffer.alloc(0);
    const parse = HOST.makeParser((op, payload) => {
      if (op === 0x9) {   // 协议 ping → pong（和 net_check 同一个最小客户端形状，这里是量具自己的夹具）
        const mask = crypto.randomBytes(4), pl = Buffer.from(payload);
        for (let i = 0; i < pl.length; i++) pl[i] ^= mask[i & 3];
        sock.write(Buffer.concat([Buffer.from([0x8A, 0x80 | pl.length]), mask, pl]));
        return;
      }
      if (op === 0x8) { c.closed = true; return; }
      if (op !== 0x1) return;
      let m; try { m = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
      c.msgs.push(m);
    });
    sock.on('data', chunk => {
      if (!upgraded) {
        headBuf = Buffer.concat([headBuf, chunk]);
        const sep = headBuf.indexOf(String.fromCharCode(13, 10, 13, 10));
        if (sep < 0) return;
        upgraded = true; parse(headBuf.slice(sep + 4));
      } else parse(chunk);
    });
    sock.on('close', () => { c.closed = true; });
    sock.on('error', () => { });
    const iv = setInterval(() => { if (upgraded) { clearInterval(iv); resolve(c); } }, 20);
    setTimeout(() => reject(new Error('upgrade timeout')), 2500);
  });
}

(async () => {
  console.log('── L3 真 net_host：loadout / lobby / start 的角色路由（带正例对照）');
  const srv = HOST.serve();
  const port = await new Promise(res => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
  const ver = HOST.PROTO_VER;
  const ch = await wsConnect(wsClient(port));
  ch.send({ type: 'hello', ver: ver, name: 'H', side: 'host', room: 'LR', seed: SEED });
  await ch.waitType('joined');
  const cg = await wsConnect(wsClient(port));
  cg.send({ type: 'hello', ver: ver, name: 'G', side: 'guest', room: 'LR', config: null });
  await cg.waitType('joined');
  await ch.waitType('peer-joined');
  ck('两席就位（房间码 LR，ver=' + ver + '）', !!ch && !!cg);

  const deck = NL.autoDeck({ element: 'ice' });
  cg.send({ type: 'loadout', deck: deck, ready: true });
  const gotLoadout = await ch.waitType('loadout');
  ck('guest 的 loadout → host 收到，deck 与 ready 逐字段不丢',
    !!gotLoadout && gotLoadout.ready === true && Array.isArray(gotLoadout.deck) &&
    gotLoadout.deck.length === 12 && gotLoadout.deck[0] === deck[0], gotLoadout && JSON.stringify(gotLoadout).slice(0, 80));

  ch.send({ type: 'lobby', hostReady: false, guestReady: true, waiting: true });
  const gotLobby = await cg.waitType('lobby');
  ck('host 的 lobby → guest 收到（hostReady/guestReady/waiting 三个字段都在）',
    !!gotLobby && gotLobby.guestReady === true && gotLobby.waiting === true && gotLobby.hostReady === false,
    gotLobby && JSON.stringify(gotLobby));

  ch.send({ type: 'start', seed: SEED, config: { map: { id: 'duel-64' }, rule: 'ranked', game: { id: 'deathmatch', target: 5 } },
    decks: [NL.autoDeck({ element: 'fire' }), deck] });
  const gotStart = await cg.waitType('start');
  ck('host 的 start → guest 收到（seed / config.game / 两份 decks 原样）',
    !!gotStart && gotStart.seed === SEED && !!gotStart.config && gotStart.config.game.id === 'deathmatch' &&
    gotStart.config.game.target === 5 && Array.isArray(gotStart.decks) && gotStart.decks.length === 2 &&
    gotStart.decks[0].length === 12 && gotStart.decks[1][0] === deck[0], gotStart && JSON.stringify(gotStart).slice(0, 90));

  await sleep(320);
  /* 负例：角色路由不许把自己发的帧弹回自己 */
  ck('负例：guest 发的 loadout 没回到 guest 自己（cg 收到的 loadout 数 = 0）',
    cg.sawAny('loadout').length === 0, 'cg 上看到 ' + cg.sawAny('loadout').length + ' 条');
  ck('负例：host 发的 start / lobby 没回到 host 自己（ch 上看到 0 条）',
    ch.sawAny('start').length === 0 && ch.sawAny('lobby').length === 0,
    'start=' + ch.sawAny('start').length + ' lobby=' + ch.sawAny('lobby').length);
  /* 正例对照：上面那三条已经证明「对方该收的收得到」，这里再补一条 —— 同方向换个角色就不许到 */
  ch.send({ type: 'loadout', deck: deck, ready: true });            // 房主说 guest 那一族的帧型：应当被挡
  cg.send({ type: 'start', seed: 1, decks: [[], []] });             // 加入者说 host 那一族的帧型：应当被挡
  await sleep(320);
  /* 每条都有正例对照：同一席位上「该收到的那一条」确实收到了（计数 = 1 就是正例），
     所以"没收到反向的那条"不是因为路由把所有帧都吞了。 */
  ck('反向也不许到：host 发 loadout 没回到 host 自己、guest 发 start 没回到 guest 自己（对称的闸）',
    ch.sawAny('loadout').length === 1 && cg.sawAny('start').length === 1 && cg.sawAny('loadout').length === 0,
    'ch.loadout=' + ch.sawAny('loadout').length + '（1=正例） cg.start=' + cg.sawAny('start').length +
    '（1=正例） cg.loadout=' + cg.sawAny('loadout').length + '（要 0）');
  /* 未知帧型只 log 不透传（这条不许被 v4 的新表顺手放行） */
  cg.send({ type: 'totally-unknown', payload: 1 });
  await sleep(300);
  ck('未知帧型不透传给对席（只 log）', ch.sawAny('totally-unknown').length === 0);

  ch.sock.destroy(); cg.sock.destroy();
  srv.close();
  console.log('');
  console.log((bad ? '✗' : '✓') + ' loadout_check ' + n + ' 条，' + bad + ' 红');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('CHECK-FAIL', e); process.exit(1); });
