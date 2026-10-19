#!/usr/bin/env node
/* tools/bag_check.cjs · 背包纯层回归（S3.5 前置）
   只测 src/ui/bags/{profiles,sources}.js：聚合、牌库顶、弃牌堆最近、profile 分版、意图映射。
   不依赖 DOM/GL/页面。 */
'use strict';
global.window = {};
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const fs = require('fs');
['src/cards.js', 'src/ui/bags/profiles.js', 'src/ui/bags/sources.js'].forEach(function (f) { require(path.join(ROOT, f)); });
const G = global.window.GW;
let pass = 0, fail = 0;
function ok(n, c, extra) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? '  ← ' + extra : '')); } }

const deck = ['strike', 'strike', 'bolt', 'heal', 'strike', 'golem'];
const app = {
  match: { players: [
    { side: 0, hand: ['bolt', null, 'heal', null, null], deck: deck.slice(), discard: ['wall2', 'dig', 'wall2'] },
    { side: 1, hand: [], deck: [], discard: [] }
  ] },
  ui: { tray: [{ kind: 'card', id: 'strike', count: 1 }, null] },
  cards: { list: G.CARDS, byId: G.CARDS_BY_ID }
};

console.log('1) 牌库聚合与牌库顶');
{
  const d = G.CardSources.deck.snapshot(app, 0);
  ok('总数 = 6', d.total === 6, '实测 ' + d.total);
  const byId = {};
  d.items.forEach(function (it) { byId[it.id] = it.count; });
  ok('strike 聚合 ×3', byId.strike === 3, '实测 ' + byId.strike);
  ok('bolt ×1 / golem ×1', byId.bolt === 1 && byId.golem === 1);
  ok('牌库顶 = 数组尾部（top3 第一张 = golem）', d.extra.top3[0] === 'golem', '实测 ' + d.extra.top3[0]);
  ok('top3 顺序 = 从尾部往前', d.extra.top3.join(',') === 'golem,strike,heal', d.extra.top3.join(','));
}

console.log('2) 弃牌堆最近在前');
{
  const x = G.CardSources.discard.snapshot(app, 0);
  ok('总数 = 3', x.total === 3);
  ok('最近一张 = 数组尾部（wall2）', x.items[0].id === 'wall2', '实测 ' + x.items[0].id);
  ok('wall2 聚合 ×2', x.items[0].count === 2, '实测 ' + x.items[0].count);
}

console.log('3) 手持栏 5 格');
{
  const h = G.CardSources.hand.snapshot(app, 0);
  ok('5 个格位', h.items.length === 5);
  ok('空格为 null', h.items[1] === null && h.items[3] === null);
  ok('总数只数有牌的', h.total === 2, '实测 ' + h.total);
}

console.log('4) 图鉴与随身格');
{
  ok('图鉴 = 全部卡牌', G.CardSources.catalog.snapshot(app, 0).total === G.CARDS.length, '实测 ' + G.CardSources.catalog.snapshot(app, 0).total + ' / ' + G.CARDS.length);
  ok('随身格 10 格、1 张', G.CardSources.tray.snapshot(app, 0).items.length === 10 && G.CardSources.tray.snapshot(app, 0).total === 1);
}

console.log('5) 模式分版');
{
  const surv = G.bagProfileFor({ debug: { creative: false } }, {});
  const crea = G.bagProfileFor({ debug: { creative: true } }, {});
  ok('生存页 = hand/deck/discard', surv.pages.join(',') === 'hand,deck,discard', surv.pages.join(','));
  /* 口径变更（2026-10-18）：创造版不再有 tray 页 —— 取卡货架是面板中间栏底部常驻的 10 格，
     再给它一个页签只会把"全部 76 张卡"画进同一个网格（见 profiles.js 的注释）。
     方块页与调试页必须在：调试页以前因为"没有 CardSource"被 selector 过滤掉，界面上根本点不开。 */
  ok('创造页含 catalog/blocks/debug', crea.pages.indexOf('catalog') >= 0 && crea.pages.indexOf('blocks') >= 0 && crea.pages.indexOf('debug') >= 0, crea.pages.join(','));
  ok('生存不显示图鉴/随身', surv.pages.indexOf('catalog') < 0 && surv.pages.indexOf('tray') < 0);
  ok('模式自带 bagProfile 可覆盖', G.bagProfileFor({ debug: {} }, { bagProfile: 'creative' }).id === 'creative');
}

console.log('6) 意图只重路由、不删词');
{
  ok('ui.reorderHand → hand.reorder', G.CardSources.hand.intent('ui.reorderHand', {}).type === 'hand.reorder');
  ok('ui.give → catalog.take', G.CardSources.hand.intent('ui.give', {}).type === 'catalog.take');
  ok('未知意图返回 null', G.CardSources.hand.intent('ui.nope', {}) === null);
}

console.log('7) 静态：sources 里没有 creative 分支 / 没有 DOM / 没有中文文案');
{
  const raw = fs.readFileSync(path.join(ROOT, 'src/ui/bags/sources.js'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('sources 不读 creative', src.indexOf('creative') < 0);
  ok('sources 不碰 document', src.indexOf('document') < 0);
  ok('sources 无 innerHTML', src.indexOf('innerHTML') < 0);
}

console.log('\n共 ' + (pass + fail) + ' 条，失败 ' + fail);
process.exit(fail ? 1 : 0);
