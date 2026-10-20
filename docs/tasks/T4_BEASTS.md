# 任务 T4 · 晶甲兽（中立生态）

先读：`docs/CARD_ECONOMY.md` §2 S3、`docs/GAMEPLAY.md` §2.5。
只允许修改：`src/systems/summon.js`、`src/battle.js`、`src/app/entity-view.js`（只加一个模型分支），
并新建 `tools/beast_check.cjs`。**不许**碰 UI/文案（名字进 `G.SUMMON_CN` 即可，它已存在于 battle.js）、不许 git commit。

## 要做的事

1. `src/systems/summon.js` 的索敌改成"敌我表"，不再写死两人：

       // side<0 = 中立：谁都是敌人
       var foes = s.side >= 0 ? [m.players[1 - s.side]] : m.players.slice();
       var foe = nearest(s, foes);

   其余分支（taunt → enemies / aiAggro / nearest）保持原逻辑；`m.players[s.side]` 那条治疗分支保持
   （中立兽不是 healer，但要有 null 守卫，不许把 undefined 塞进 Math.hypot）。
2. `src/battle.js`：
   - 构造函数里，`opts.beasts` 为真（数字或 true）时，为每条矿生成一只晶甲兽：
     `side: -1`、`aiKind: 'crystal_beast'`、`name: '晶甲兽'`、`hp/maxHp: 40`、`dmg: 6`、`speed: 2.8`、
     `ai: 'melee'`、`mode: 'direct'`、`home: {x,z}` = 矿点平台中心、`leash: 10`、`ttl: 1e9`、`atkCd: 0`、
     `alive: true`、`pos` 放在矿点旁边一格的可站面（用 `G.GroundProbe.find` 或 `world.surfaceY`，不许埋进方块）。
     生成走 `m.summons.push` + `m.touch('summons')`，不要走 `spawnSummon`（那是"玩家打牌召唤"的入口，带施法特效与随机落点）。
     生成顺序按 `world.lodes.list` 下标，零 rng。
   - `kill(t, src, ctx)` 的 summon 分支：若 `t.side < 0`（中立兽），击杀者是玩家时：
     `src.mats += 3`；`this.offerDraft(src.side, 'beast', 'neutral')`；`this.fx.log` 一条；
     **不走**原来那条"击杀随从抽 1 张"（设计只有 +3 素材 + 一次三选一）；
     中立兽不重生，不重复发奖。其余 side>=0 的随从行为逐字不变。
   - `G.SUMMON_CN` 加 `crystal_beast: '晶甲兽'`。
3. `src/app/entity-view.js`：`summonMesh` 加 `crystal_beast` 分支——
   深紫蓝色石壳（#5a4a8a / #7a63b8）+ 顶部晶体（#b26bff）+ 两眼（#e0d0ff），块数与现有种类同量级（4–6 块），
   零 DOM、零文案。别动其它分支。
4. 新建 `tools/beast_check.cjs`（node，零依赖，构造照 `tools/play_probe.cjs`；测试世界必须传
   `{ size:[64,36,64], seed, lodes: true }`，否则没有 `world.lodes`、也不会有晶甲兽）。断言：
   - B1 `opts.beasts:3` → `match.summons` 里 3 只、`side===-1`、`hp===40 && dmg===6 && speed===2.8`、落在矿点 2 格内、没被埋（`pos.y` 高于该柱可站面）；
   - B2 玩家站在兽旁 3 格内跑 2 秒 → 兽进入 chase/attack 且玩家 `hp` 下降；
   - B3 玩家传送到 25 格外跑 3 秒 → 兽与 home 的水平距离变小（回守），且不掉血；
   - B4 跑 60 秒（1200 tick）兽仍在（`ttl` 不退场）；
   - B5 玩家把它打死：`mats` +3、`pendingDraft().source==='beast'` 且 biome 是 `neutral`、牌库张数不变；第二次 kill 不会重复给奖；
   - B6 `opts.beasts:0` → 0 只；
   - B7 中立兽不会打矿脉晶体/方块：跑 2 秒后 world blocks 校验和不变。
   每条 PASS/FAIL + 汇总 + 退出码。

## 验收（自己跑，贴真实输出）

       node tools/beast_check.cjs
       node tools/draft_check.cjs
       node tools/cards_probe.cjs
       node tools/play_probe.cjs 490706 1 10800 starter 1
       node tools/layer_check.cjs

判据：beast_check 全绿；draft_check 仍全绿（T3 的，不许被破坏）；cards_probe 67 条全绿；
play_probe H/U 组全绿，L/T 组照实贴（不许改阈值、不许为了绿灯改断言）；layer_check 退出 0。
注意：默认 Match（play_probe）不传 `opts.beasts` 时**不生成**晶甲兽（默认关闭，误提交不改变现有对局），
只有关卡配置显式传 3 才生成——这条写进代码注释。

## 报告

改了哪些文件各做了什么；5 条命令关键输出；不确定处。