/* ================= GW.HUD（门面 + 文案表：整个游戏唯一允许出现玩家可见中文的地方） =================
   新的分工（2026-10-17 UI 重构）：
     · js/ui/*.js  框架与面板：结构、布局、交互、拖拽代数 —— **一个中文都没有**；
     · js/hud.js   本文件：文案表 H.TEXT（含格式化函数）、物品注册（把画法与说明接进 GW.UI.Items）、
                   以及历史入口 H.*（main.js / 回归脚本只认这些名字）；
     · js/main.js  装配：键位、把 GW.UI.channel 的意图接到权威层。
   要换一套界面：改 js/ui/panels.js 的 spec + 这里的文案；要改一句中文：只动 H.TEXT。

   硬规则（tools/layer_check.cjs 机检）：
     · H.TEXT 只能合并写（Object.assign），别整段赋值覆盖掉别人注册的段；
     · 面板开着必须 exitPointerLock() 交还鼠标、必须收起锁鼠标提示、主循环暂停判据问 H.uiPanelOpen()；
     · 视图层不判定能不能出牌：canPlay 由 app（main.js）注册进 GW.UI.channel 探针，这里只 ask。
   ================================================= */
window.GW = window.GW || {};
(function (G) {
  'use strict';
  const UI = G.UI;
  const H = G.HUD = { sel: [0, 0] };
  let ui = null, vm = null, ready = false;

  /* ==================== 1. 文案表 ==================== */
  H.TEXT = H.TEXT || {};
  Object.assign(H.TEXT, {
    topbar: {
      title: '卡牌纪元', seedLabel: 'seed ', modeLabel: '', timeLabel: '⏱ ', tickLabel: 'tick ',
      fpsLabel: 'FPS ', biomeLabel: '群系 ', camLabel: '视角 ', err: '⚠ 逻辑异常',
      /* 占矿读数的三个标签（T5）：比分与三矿在第一行，倒计时在第二行监控带 */
      scoreLabel: '比分', timeLeftLabel: '剩余 ', lodeLabel: '矿脉'
    },
    /* ---------- 积分榜（docs/MODES.md §5）：编排类只给 key 与数值，中文只能出现在这张表 ----------
       有哪几行、行序如何由玩法表的 display.rows 决定（src/app/game-modes.js），面板按那个顺序渲染；
       本表只负责"每个 key 怎么说人话"。新玩法带来一个新 key 而这里没补 → 面板照 key 显示（不空着、不抛）。
       target / unlimited 是 chip 的两面（有胜分写"目标 N 杀"，不限写"不限"），timeLeft 是倒计时 chip 的抬头。 */
    board: {
      rows: { score: '比分', kills: '击杀', deaths: '死亡' },
      target: '目标', targetUnit: ' 分', unlimited: '不限', timeLeft: '剩余 ',
      /* 目标线的量词跟着玩法走：lode 的 100 是分、死亡竞赛的 10 是杀（chip.unit 由编排类给，
         认不出的 key 退 targetUnit 那一份，宁可说"分"也不许空着） */
      units: { score: ' 分', kill: ' 杀' },
      /* 剩余时间只有这一个显示口径（顶栏与结算共用；viewmodel 的 fmtMMSS 是同一条格式的另一处实现，
         本层不许反向读它，故这里自带一份——两处格式若漂移，ui_shot 的截图会当场看出来） */
      fmtTime: function (sec) {
        const t = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(t / 60), s = t % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
      }
    },
    /* ---------- 玩法（docs/MODES.md §6）：id 的真源是 src/app/game-modes.js 的表，这里只翻译 ----------
       追加一个玩法 = 数据表加一条 + 本表两个条目（名字 + 一句话）+（如需要）档位文案。
       选关面板与顶栏都不认识具体玩法，它们只按 key 查这几张表。 */
    game: {
      names: { lode: '以太争锋', deathmatch: '死亡竞赛' },
      notes: {
        lode: '占矿每 3 秒 +1 分、击杀 +15 分：先到胜分，或时间到按分数判',
        deathmatch: '杀人得分，矿不再给分（素材与魔力照给）：先到击杀数，或时间到按比分判'
      },
      /* 死亡竞赛的「胜分」三档的人话（档位本身在 game-modes.js 的 DM_TARGETS，这里不重复数字含义） */
      dmTargets: { 5: '5 杀', 10: '10 杀', 0: '不限' },
      dmTargetNotes: {
        5: '快节奏：先拿 5 杀的一方胜',
        10: '定档：先拿 10 杀的一方胜',
        0: '不设胜分：时间到按比分判，平局进加时（下一个得分事件定胜负）'
      }
    },
    vitals: {
      hp: '生命', shield: '护盾', mana: '魔力', mat: '素材', deck: '牌库', discard: '弃牌', kill: '击杀',
      chipClass: '类别',            // 手持栏当前类别那枚片（中文只在本表）
      /* 状态印章（2026-10-17 重做）：旧版把 🔥❄⛓💢 四个彩色 emoji 塞进血量字符串里，
         与整套像素硬边打架。改成"一个字 + 一条元素色左标"——色与字双通道，色盲也分得清（WCAG 1.4.1）。
         色值与 js/cards.js 的 G.ELEMENTS 同源（tools/ui_shot.cjs 的令牌表把它一起收进白名单）。 */
      statusTags: {
        burn: { label: '灼', color: 'var(--el-fire)' }, frozen: { label: '冻', color: 'var(--el-ice)' },
        root: { label: '缚', color: 'var(--el-rock)' }, vuln: { label: '脆', color: 'var(--bad)' },
        haste: { label: '急', color: 'var(--el-nature)' }
      },
      /* 数值条上的字符串都在这几张格式化函数里：视图只算比例，不说中文 */
      fmt: {
        hp: function (p) { return Math.max(0, Math.ceil(p.hp)) + '/' + p.maxHp; },
        status: function (p) {
          const st = p.st || {}, T = (H.TEXT.vitals && H.TEXT.vitals.statusTags) || {}, out = [];
          for (const k in T) if (st[k] > 0) out.push({ key: k, label: T[k].label, color: T[k].color });
          return out;
        },
        /* 标签列已经写着"护盾 / 魔力"了，数值就只给数字（旧版两处各说一遍，读起来像坏了） */
        sh: function (p) { return String(Math.floor(p.shield || 0)); },
        mana: function (p) { return p.mana + '/' + p.manaCap; },
        manaInf: function () { return '∞ 创造'; },
        respawn: function (t) { return ' (倒下 ' + t.toFixed(1) + 's)'; }
      }
    },
    aim: {
      lockHintMain: '点击画面', lockHintSub: '锁定鼠标开始操作（转向只靠鼠标，Minecraft 那样）· 不看键盘转身：F / V 俯仰兜底 · 1–5 出牌 · 滚轮或 Tab 切卡',
      helpLines: [
        ['P1', ' WASD 移动 · 空格跳 · 点画面锁鼠标转向（键盘不转身，F/V 只兜底俯仰）· 左键：攻击组按住连发、放置/破坏/移动/辅助组打出选中那张 · 1–5 指定出牌 · 滚轮/Tab 切卡 · Shift 触发移动牌 · Shift+滚轮换出牌组'],
        ['背包', ' 按 E 打开（I 同）：生存模式也有，看得见手持栏 / 随身格 / 牌库 / 弃牌堆。点图鉴 = 放进选中格，按住拖动 = 拿起来一格一个，右键 = 对半 / 放一个，Shift+点 = 甩进手持栏，双击 = 归拢同类，拖到画面上 = 往那个点出牌'],
        ['视角', ' C 循环：越肩 → 第一人称 → 越肩不画自己；越肩时身体压到准星会自动不画自己，贴墙会自己换另一侧肩'],
        ['P2', '（分屏）方向键 移动 · 右Shift 或 Enter 跳 · N M , . / 出牌 · [ ] 微调视角 · 自动锁向对手'],
        ['全局', ' T 切分屏 · H 帮助 · M 静音 · R 重开 · F9 本地存档 · P 光影'],
        ['调试', ' G 创造模式（图鉴任意取卡才开放）· X 飞行（空格升 / 左Shift 降）· 背包打开时逻辑暂停'],
        ['规则', ' 移动不耗卡；挖地形、技能、魔法阵、召唤一律靠出牌。1 魔力 ≈ 6 伤害 ≈ 1 格地形。']
      ],
      /* 键位带：只放"当下最常用"的 8 组，其余全部进 H 帮助（旧版是一整句 10px 灰字，扫一眼抓不到重点） */
      keycaps: [
        ['WASD', '移动'], ['空格', '跳'], ['左键', '出牌 / 连发'], ['1–5', '指定出牌'],
        ['滚轮 / Tab', '切卡'], ['Shift', '移动牌'], ['Shift+滚轮', '换组'],
        ['C', '视角'], ['E', '背包'], ['T', '分屏'], ['H', '全部键位']
      ],
      /* 准星下方那行：main.js 只报 key 与数字，中文在这里拼 */
      fmt: {
        terrain: function (o) { return '◇ ' + o.name + ' · 将改造 ' + o.cells + ' 格（上限 ' + o.cap + '）' + (o.blocked ? ' · 视线被挡' : ''); },
        sigil: function (o) { return '◎ ' + o.name + ' · 法阵半径 ' + o.radius + ' · 延时 ' + o.delay + 's'; },
        block: function (o) { return '◎ ' + o.name + ' (' + o.at + ')' + (o.blocked ? ' · 视线被挡（命中点已回退）' : ''); },
        empty: '—'
      }
    },
    toast: {},
    log: { title: '战斗日志', tail: '' },
    /* 手持栏：空位字 + 出牌组指示条（当前组 + 前后切换箭头）。组名与"自动开火"徽章都在这里。 */
    hotbar: {
      emptySlot: '空', chipClass: '出牌组',
      classTip: '切到哪一组，手持栏就只出这一组（Shift+滚轮也能换）',
      prev: '‹', next: '›',
      autoOn: '自动开火', autoOff: '左键出牌 / 连发',
      /* 组中文名与背包左栏那张表同源（hud 初始化时从 H.TEXT.inv.categories 指过来） */
      classNames: {},
      autoTip: '攻击组（远程/法阵/超阶/召唤）与「全部」：按住左键自动挑能打的攻击牌；放置/破坏/移动/辅助组：左键打出选中那一格'
    },

  /* ---------- 背包：文案 + 单位 + 卡面/方块说明 ---------- */
    inv: {
      options: '调试选项', quick: '快捷',
      /* 面板头与各块的小标题（旧版三栏之间没有一块有名字，玩家不知道哪排是能拖的手持栏） */
      head: '背包', headDebug: '背包 · 图鉴', headHint: '按 E 或 Esc 关闭',
      /* 这两句要说清"它是谁"：背包里那排与画面下方那排是**同一副手牌**（不是两个背包），
         随身格是创造模式的取卡货架（不是第二个背包）。以前写成"本地收藏"，玩家会以为牌能存在那儿。 */
      handLabel: '手持栏 · 与画面下方那排是同一副牌（拖动换位）',
      trayLabel: '取卡货架 · 点一下复制到选中格',
      detailHead: '卡页', kvCost: '费用', kvCd: '冷却', kvStack: '数量',
      hint: '点卡=看这张卡\n拖起来=拿在手上（一格一个）\n右键=对半 / 放一个\n双击=归拢同类（手持栏里=打出）\nEsc 或 E 关闭',
      dragHint: '按住拖动：跨格分堆；松手在画面上 = 朝那个方向打出',
      /* 方块页的提示：这一页现在是"方块图鉴"（放置进世界还没接通道），别写卡牌那套手势 */
      blockHint: '方块图鉴：这里看每种方块的可踩/遮光/耐久/可燃/化冻属性。\n把方块放进世界这条路还没接上（通道留着，等机制层）。',
      search: '搜索卡名 / 描述 / id',
      allElements: '全元素', allTypes: '全类型',
      defaultTab: 'cards',
      tabLabels: { cards: '卡牌', blocks: '方块', tray: '随身', debug: '调试', deck: '牌库', discard: '弃牌堆' },
      /* 页签不在这里定：由 BagProfile.pages 决定（生存 hand/deck/discard；创造 catalog/blocks/hand/tray/debug） */
      /* 类别：真源是 cards.js 每张卡的 type 字段，这里只给中文与顺序 */
      /* Shift+滚轮 / 手持栏类别条转的是**出牌组**（cards.js 的 role 字段，2026-10-18 用户）：
         "所有放出来干同一件事的卡分一组" —— 放置方块 / 破坏方块 / 增加移动 / 放出远程攻击 /
         放出法阵 / 放出超阶法术 / 召唤 / 辅助。它管手感（手里是哪一类东西），不按功能流派切。
         细分类型（terrain/spell/sigil/summon/utility）仍在，给图鉴的类型筛选与老量具用。 */
      classOrder: ['all', 'place', 'dig', 'move', 'shot', 'sigil', 'ultra', 'summon', 'aid'],
      classTypes: ['all', 'terrain', 'spell', 'sigil', 'summon', 'utility'],
      categories: {
        all: '全部', place: '放置', dig: '破坏', move: '移动', shot: '远程',
        sigil: '法阵', ultra: '超阶', summon: '召唤', aid: '辅助',
        terrain: '挖掘', spell: '法术', utility: '实用',
        hint: '切到哪一组，手持栏就只出这一组（同类打光宁可空着，也不掺别组）',
        set: function (name, n) { return '出牌组：' + name + '（' + n + ' 张同类进手持栏）'; },
        empty: function (name) { return '出牌组：' + name + ' —— 这一组没有可用的牌了（牌库与弃牌堆都翻过一遍）'; }
      },
      chipClass: '类别',
      count: function (shown, total) { return shown + ' / ' + total + ' 项'; },
      /* 牌库 / 弃牌堆那一页：显示的是"张"（聚合后的条目数另算），别把 6 种写成 6/7 项 ——
         以前那一行同时混了"条目数"和"张数"，玩家数不出自己牌库里到底有几张。 */
      pileCount: function (cards, kinds) { return '共 ' + cards + ' 张 · ' + kinds + ' 种'; },
      /* 详情栏顶部那行"这张现在在哪"：同一个卡面在牌库/手持栏/弃牌堆都长一样，不写清位置会看错。 */
      loc: {
        hand: '在手持栏 · 这一张现在就能打',
        deck: '在牌库 · 拖到手持栏可以换一张进来（能打的是手持栏那张）',
        discard: '在弃牌堆 · 洗回牌库才会再抽到',
        catalog: '图鉴 · 创造模式取卡',
        tray: '取卡货架 · 点一下复制到选中格'
      },
      /* 灰掉的按钮为什么灰：鼠标停上去要有解释（不许"点了没反应"）。 */
      why: {
        give: '图鉴 / 取卡货架上的卡要开创造模式（按 G）才能取；牌库里那张可以直接拖进手持栏换一张',
        cast: '牌库/弃牌堆里的牌要抽到手才能打；手持栏里这张也要能付得起费用',
        tray: '生存模式没有取卡货架（那是创造模式的调试能力）',
        drop: '只有手持栏里的牌能扔（这张在别处）'
      },
      pileDeck: '牌库', pileDiscard: '弃牌堆',
      trayEmpty: '随身格（空）', emptySlot: '空',
      detailNone: '把鼠标停在一张卡上看这里',
      btnToSlot: '放进手持栏', btnCast: '立刻打出', btnTray: '收进随身格', btnDrop: '扔掉这张',
      toggles: {
        infiniteMana: '无限魔力', noConsume: '卡牌不消耗', noCooldown: '无冷却',
        invuln: '无敌 / 免控', freeMats: '免素材判定', ai: 'AI 对手上场',
        noclip: '穿墙飞行', unlimitedCells: '解除地形上限'
      },
      segments: {
        timeScale: { label: '时间流速', values: [1, 0.5, 0.25], format: function (v) { return v + '\u00d7'; } },
        dayLock: { label: '昼夜', values: ['off', 'day', 'night'], format: { off: '跟随', day: '锁昼', night: '锁夜' } }
      },
      actions: { resetHand: '重掷手牌', healUp: '回满状态', spawnDummy: '放训练假人', clearField: '清空场面' },
      units: {
        cd: function (secs) { return secs.toFixed(1) + 's'; },
        cd0: function (secs) { return 'CD ' + secs + 's'; },
        cost: function (n) { return String(n); },
        /* 方块说明：属性驱动，别在这里 if 方块名 */
        block: function (d) {
          const bits = [];
          if (d.solid) bits.push('可踩'); else bits.push('非固体');
          if (d.opaque) bits.push('遮光');
          if (d.hp && isFinite(d.hp)) bits.push('耐久 ' + d.hp);
          if (d.flammable) bits.push('可燃 ' + d.burnDur + 's');
          if (d.meltsTo) bits.push('受热化' + (G.BLOCK_DEFS ? cnOf(G.blockKeyToId[d.meltsTo]) : d.meltsTo));
          if (d.freezesTo) bits.push('可冻成' + cnOf(G.blockKeyToId[d.freezesTo]));
          if (d.coolsTo) bits.push('遇冷成' + cnOf(G.blockKeyToId[d.coolsTo]));
          if (d.drop) bits.push('采集得' + cnOf(G.blockKeyToId[d.drop]));
          if (d.slip) bits.push('打滑');
          if (d.light) bits.push('发光 ' + d.light);
          return bits.join(' · ');
        },
        blockKind: function () { return '方块'; },
        cardKind: function (card) { return (G.TYPE_CN[card.type] || card.type) + ' · ' + G.ELEMENTS[card.element].cn + ' · ' + (G.RARITY_CN[card.rarity] || ''); },
        stack: function (n) { return '×' + n; }
      },
      say: {
        given: function (card, slot) { return '已放入卡槽 ' + (slot + 1) + '：' + card.name; },
        cast: function (card) { return '已打出 ' + card.name; },
        none: '这张卡放不进去', emptySlot: '空',
        trayAdd: function (card) { return '收进随身格：' + card.name; },
        trayFull: '随身格满了',
        toWorld: '已经把这一格交给世界层（当前机制层还没接住它）'
      },
      badge: {
        root: '创造', fly: '飞行', noclip: '穿墙', noAi: '无 AI',
        day: '锁昼', night: '锁夜', unlimited: '地形解禁', speed: function (v) { return v + '\u00d7'; }
      }
    },
    /* ---------- 通用选择面板（三选一复用，禁止另写一套列表） ---------- */
    choice: { title: '选择一项', hint: '', skip: '先跳过', head: '抉择', headTail: '点一条确认 · Esc 取消' },
    /* ---------- 三选一（占矿 / 晶甲兽首杀）：main.js 只报 source，标题与提示在这里翻 ---------- */
    draft: {
      lodeTitle: '首占矿脉 · 三选一',
      beastTitle: '晶甲兽首杀 · 三选一',
      hint: '选一张，×2 进本局牌库；Esc 先跳过（次数不返还）',
      /* takeDraft / skipDraft 被权威层拒绝时的两句人话（不许静默：拒绝必须演出来） */
      takeFail: '这张牌没进牌库（不在这一次的候选里，或被拒绝），请重新选一次',
      skipFail: '这次跳过没有被接受，三选一仍然挂着，可以再选或再跳过'
    },
    /* ---------- 主菜单 ---------- */
    menu: {
      title: '卡牌纪元',
      hist: '战绩',
      badge: 'PIXEL 3D · EARLY BUILD',
      tips: ['左键分两种：攻击组按住连发（自动挑能打的），放置/破坏/移动/辅助组点一下打出选中那张', 'Shift+滚轮 换出牌组（放置·破坏·移动·远程·法阵·超阶·召唤·辅助）· Shift 触发移动牌', 'E 背包 · H 全部键位 · T 分屏 · P 光影'],
      histVal: function (n, rate, avg) { return n + ' 局 · 胜率 ' + Math.round((rate || 0) * 100) + '% · 均 ' + (avg || 0).toFixed(0) + 's'; },
      sub: 'PIXEL 3D CARD DUEL · 越肩视角 / 开放世界 / 卡牌驱动一切',
      hMode: '对战模式', hSeed: '世界种子（同一种子 → 同一张地图，逐格一致）',
      hDeck: '你的卡组流派', hMap: '地图', maps: [{ key: 'island-96', label: '翠屿 96' }, { key: 'duel-64', label: '决斗 64（实验）' }, { key: 'atoll-128', label: '环礁 128（实验）' }],
      hCreative: '调试 · 创造模式（无限魔力 / 卡牌不消耗 / 背包任意取卡）',
      hSave: '存档（种子 + 地形变更，可分享复现）',
      modes: [
        { key: 'train', label: '单人训练（对手为 AI）' },
        { key: 'split', label: '同屏分屏双人 PVP' },
        { key: 'net', label: '联网 PVP（局域网）', tip: '点了会进选关填服务器与房间码 —— 房主先跑 net_host.cjs' }
      ],
      decks: [
        { key: 'starter', label: '初始 12 张' }, { key: 'fire', label: '焰 · 爆发' },
        { key: 'ice', label: '霜 · 控场' }, { key: 'rock', label: '岩 · 地形' },
        { key: 'nature', label: '林 · 召唤' }, { key: 'void', label: '虚 · 位移' },
        { key: 'random', label: '随机 20 张' }
      ],
      seedPlaceholder: '留空随机', seedRand: '随机', seedLabel: '种子',
      creativeLabel: '进入世界时开启',
      creativeNote: '局内随时按 G 开关（图鉴任意取卡、飞行这些调试能力才开）· 背包按 E 或 I 都开：生存模式一样有物品栏与随身格。X 飞行（空格升 / 左Shift 降）。只影响 P1，不影响手感与判定回归。',
      savePlaceholder: '局内按 F9 保存、Ctrl+F9 导出到这里；粘贴 JSON 后点导入',
      btnExport: '导出本局存档', btnImport: '导入存档', btnLocal: '读取本地存档（F9 保存过）',
      /* 开始 = 去选关（docs/LEVELS.md §0）：菜单不再直接开局，开局是选关面板的「开始对局」 */
      btnStart: '开始游戏', btnHelp: '查看规则与验收标准',
      note: '操作：移动用键盘（不消耗卡牌）；其余全部操作都要出手牌——挖地、填地、垒墙、放技能、布魔法阵、召唤随从。世界用单一 seed 驱动（地形 / 掉落 / 洗牌都可复现），HUD 上的 seed 可分享给朋友复现同一张图。',
      spec: []
    },
    /* ---------- 结算（字段名与文案都在这里，main.js 只说"对局结束了"） ---------- */
    result: {
      kicker: 'MATCH RESULT', statHead: '对局统计',
      /* 行清单在这里，值在 H.showMatchResult 里填（本表是行数的唯一真源：面板按它渲染，
         creative_check 的「面板字段与文案表一致」比的就是两边的条数）。
         最后那两行读编排类的 snapshot（击杀/死亡分账，docs/MODES.md §5）：没有 director 时值给「—」，
         行还在、不空真——宁可显示"—"也不许静默少一行，那是"点了没反应"的另一张脸。 */
      rows: [['胜者', 'name'], ['胜负原因', 'reason'], ['关卡', 'level'], ['用时', 'time'], ['tick 数', 'ticks'],
             ['P1 得分', 'p1score'], ['P2 得分', 'p2score'],
             ['P1 击杀', 'p1kills'], ['P2 击杀', 'p2kills'],
             ['P1 击杀/死亡', 'p1kd'], ['P2 击杀/死亡', 'p2kd'],
             ['seed', 'seed'], ['改造上限', 'cap'],
             ['历史对局', 'histGames'], ['历史胜率', 'histWin'], ['历史平均时长', 'histAvg']],
      /* 终局原因（src/systems/scoreboard.js 的 winReason）：权威层只报 key，中文在这张表里。
         认不出的 key 交给 reasonFor 兜底，宁可显示原文也不许空着（"点了没反应"就是这么来的）。 */
      reason: {
        score: '先到胜分（占矿积分 + 击杀）',
        time: '时间到，按分数定胜负',
        overtime: '加时判定（占矿秒数 → 血量 → 分数）',
        'overtime-tie': '加时后仍全平，判平局',
        /* 联机掉线（docs/NET.md §9.5）：权威层没分胜负，是对局被「人少了」打断的——
           这一条由装配层（main.js 的 netOpponentLeft）写进 match.over.winReason，
           认不出的 key 仍走 reasonFor 兜底，宁可显示原文也不许空着。 */
        'opponent-left': '对手已离开',
        manual: '人为结束'
      },
      /* 关卡两个 id 的中文名（真源在 src/app/map-presets.js 与 docs/LEVELS.md §1.2，这里只翻译） */
      mapNames: { 'duel-64': '决斗岛', 'island-96': '翠屿', 'atoll-128': '环礁' },
      ruleNames: { ranked: '以太争锋', blitz: '速攻', training: '训练场' },
      /* 同一个 reason key 在不同玩法里说的是两种事（lode 的分数来自占矿 + 击杀，
         死亡竞赛只有击杀），所以先问玩法那一份，没有再回公共那一份（默认玩法逐字不变）。 */
      reasonFor: function (k, modeId) {
        const T = (H.TEXT.result && H.TEXT.result.reason) || {};
        const BY = (H.TEXT.result && H.TEXT.result.reasonByMode) || {};
        const key = k == null || k === '' ? 'manual' : String(k);
        const one = modeId && BY[modeId] && BY[modeId][key];
        return one || T[key] || key;
      },
      /* 玩法专属的胜负原因（key 与权威层的 winReason 同名；未知 key 仍走 reasonFor 兜底说原文） */
      reasonByMode: {
        deathmatch: {
          score: '先到击杀数',
          time: '时间到，按比分定胜负',
          overtime: '加时判定（击杀数 → 死亡数少者）',
          'overtime-tie': '加时后仍全平，判平局'
        }
      },
      /* 关卡那行说的是"我在哪张图上打了什么局"。默认玩法（lode）那一条沿用规则名，逐字不变；
         选了别的玩法时再写"以太争锋"就是骗人——那一栏改说玩法名（名字仍在本表，不在装配层）。 */
      level: function (mapId, ruleId, modeId) {
        const R = H.TEXT.result || {};
        const M = R.mapNames || {}, N = R.ruleNames || {};
        const GNM = (H.TEXT.game && H.TEXT.game.names) || {};
        const m = mapId ? (M[String(mapId)] || String(mapId)) : '';
        const mid = modeId ? String(modeId) : '';
        const n = (mid && mid !== 'lode' && GNM[mid]) ? GNM[mid] : (ruleId ? (N[String(ruleId)] || String(ruleId)) : '');
        if (!m && !n) return '—';
        return m + (n ? ' · ' + n : '');
      },
      win: '你赢了', lose: '你输了', beat: function (name) { return name + ' 获胜'; },
      p1: 'P1 得分', p2: 'P2 得分',
      histGames: '历史对局', histWin: '历史胜率', histAvg: '历史平均时长',
      histWinText: function (v) { return Math.round((v || 0) * 100) + '%'; },
      histSec: function (v) { return (v || 0).toFixed(1) + ' 秒'; },
      seconds: function (v) { return v.toFixed(1) + ' 秒'; },
      cells: function (n) { return n + ' 格/卡'; },
      again: '再来一局（同种子）', newSeed: '换个种子', backMenu: '返回菜单', backLevel: '回选关'
    },
    /* ---------- 选关（docs/LEVELS.md §4）：id → 人话的唯一一处，panels.js 只读合成好的字段 ----------
       数字（尺寸 / 胜分 / 时长 / 晶甲兽）不写在这张表里：levelCopy() 从 src/app/map-presets.js 与
       src/app/rule-presets.js 现取，文档与数据漂移时漂移的是数字，不是这里再抄一份。 */
    level: {
      title: '选择关卡', sub: '玩法 × 地图 × 规则 × 模式 —— 这几样决定这一局怎么打',
      hMap: '地图', hRule: '规则', hMode: '模式',
      /* 第二条轴（docs/MODES.md §6）：「玩法」栏两张卡 + 选中 deathmatch 时那行「胜分」
         （条目在 levelCopy() 里现从 G.GAME_MODES / G.DM_TARGETS 合成，数字不抄第二份） */
      hGame: '玩法', hGameTarget: '胜分', hSeed: '世界种子（同一种子 → 同一张地图，逐格一致）', hDeck: '你的卡组流派',
      mapOrder: ['duel-64', 'island-96', 'atoll-128'],
      mapNames: { 'duel-64': '决斗岛', 'island-96': '翠屿', 'atoll-128': '环礁' },
      mapNotes: {
        'duel-64': '定案尺寸：三矿一步之遥，前中期就抢起来',
        'island-96': '大图：视野开阔、跑图成本高；相机在个别种子有一处俯仰误隐藏（C4）',
        'atoll-128': '超大图：交火距离远；相机在部分种子会把角色误隐藏（C4），节奏也没实测过'
      },
      ruleOrder: ['ranked', 'arcade', 'blitz', 'training'],
      ruleNames: { ranked: '以太争锋', arcade: '街机 · 爽玩', blitz: '速攻', training: '训练场' },
      ruleNotes: {
        ranked: '定案档：占矿攒到胜分，或时间到按分数判；三矿各一只晶甲兽',
        arcade: '魔力回得更快、上限更高：按住左键就能一路连发，系统自动挑能打出去的那张',
        blitz: '快节奏：胜分更低、钟更短，离开矿台后还有 6 秒占矿宽限',
        training: '不设胜分、没有晶甲兽、AI 最弱：练连段与地形卡用'
      },
      expTag: '实验', recoTag: '推荐',
      modes: [
        { key: 'train', label: '单人（AI 对手）' },
        { key: 'split', label: '同屏分屏双人' },
        { key: 'net', label: '联网 PVP（局域网）', tip: '房主先跑 node tools/net_host.cjs 8787；两端填同一房间码' }
      ],
      decks: [],
      seedPlaceholder: '留空随机', seedRand: '随机',
      btnStart: '开始对局', btnBack: '返回标题',
      /* 不进联机也能先配牌（2026-10-18 用户「还是没看到选牌」）：配好的牌库在下一局使用。 */
      btnDeck: '先配一副牌（可选）',
      /* 联机的三字段（docs/NET.md §9.5）：选中「联网 PVP」才长出来，值走 ui.levelPick 写进 vm.level。
         netNote 里那句命令行是给玩家看的原话——tools/level_check.cjs 认 net_host.cjs 这个串，
         命令改名必须连这里一起改，不许只改一半。 */
      hNet: '联机',
      netUrlLabel: '服务器', netRoomLabel: '房间码', netRoleLabel: '角色',
      netHost: '创建房主', netGuest: '加入对局',
      netRoomPlaceholder: '例如 ROOM',
      netNote: '房主跑 node tools/net_host.cjs 8787（Windows 双击 start-net.bat 也行）；两端用同一份目录，房间码要一样',
      /* 「怎么联机」三步（2026-10-18 用户反馈「不知道从开始界面怎么进联机」后加的）：
         三句都写在 .ui-level-net 顶部，选中联网 PVP 时会自动滚到这一块。命令串仍留 net_host.cjs，level_check 认它。 */
      netHelpTitle: '怎么联机（三步）',
      btnNetStart: '开始对局（连接并进入选牌）',
      netSteps: [
        '① 房主运行 node tools/net_host.cjs 8787（开着别关）',
        '② 两端填同一房间码；挑战者的服务器填房主局域网 IP',
        '③ 选角色 → 开始对局 → 各选 12 张牌 → 双方就绪自动开局'
      ],
      fmtSize: function (p) { return p.size.join(' × ') + ' · 海平面 ' + p.sea + (p.lodes ? ' · ' + p.lodes + ' 条矿脉' : ''); },
      fmtRule: function (r) {
        var base = '胜分 ' + r.scoreWin + ' · 限时 ' + Math.round(r.timeCap / 60) + ' 分钟 · 晶甲兽 ' + (r.beasts > 0 ? (r.beasts + ' 只') : '无');
        /* 只有声明了魔力档的规则（街机）才多这一截：数字现读数据层，这里不写第二份 */
        if (r.manaCap != null || r.manaRegen != null) base += ' · 魔力 ' + (r.manaCap != null ? r.manaCap : '—') + ' 上限 / +' + (r.manaRegen != null ? r.manaRegen : '—') + ' 每秒';
        return base;
      },
      /* 玩法卡的那行数字：全部现读 src/app/game-modes.js 的表（target 0 = 不限），
         这张表里不许出现第二份 100 / 480 / 15 之类的数字（与 fmtRule 同一条纪律）。 */
      fmtGame: function (m) {
        const w = (m && m.win) || {}, sc = (m && m.score) || {}, mp = (m && m.map) || {}, dr = mp.draft || {};
        const bits = [w.target > 0 ? ('胜分 ' + w.target) : '不限胜分'];
        bits.push('限时 ' + Math.round((w.timeCap || 0) / 60) + ' 分钟');
        bits.push('击杀 ' + (sc.kill | 0) + ' 分');
        bits.push((sc.lodePointsPerTick | 0) > 0 ? ('占矿 ' + (sc.lodePointsPerTick | 0) + ' 分/3s') : '占矿不给分');
        bits.push(mp.beasts > 0 ? ('晶甲兽 ' + mp.beasts + ' 只') : '无晶甲兽');
        bits.push(((dr.lode | 0) + (dr.beast | 0)) > 0 ? ('三选一 ' + (dr.lode | 0) + '+' + (dr.beast | 0) + ' 次') : '无三选一');
        return bits.join(' · ');
      }
    },
    /* ---------- 战前选牌（docs/ROUTER.md §2）：这一页的每一句中文都在这张表 ----------
       三条数字（12 张 / 每张 2 份 / 地形 ≥4）的真源是 src/ui/viewmodel.js 的 UI.LOADOUT_RULES，
       本表只出句子不写判据：面板读 vm.loadoutCount / Terrain / Eligible，句子由这里的函数现拼，
       于是「界面写的数」与「判就绪的数」永远是同一个数。 */
    loadout: {
      title: '战前选牌',
      sub: '联机开局前各配一副牌 —— 你选什么对手看不见，他也一样',
      hint: '卡池是全部卡；同一张最多带 2 份；整副正好 12 张，其中地形卡至少 4 张（这是挖掘游戏，不带挖掘卡是非法构筑）。',
      steps: '① 左边点卡加进牌库（满 12 张、地形 ≥4）  ② 点「就绪」  ③ 双方都就绪后自动开局',
      poolHead: '卡池（点一下加一张）', pickHead: '这一局的牌库',
      ready: '就绪', back: '返回选关',
      /* 配牌模式（不进联机也能先选：2026-10-18 用户「还是没看到选牌」） */
      localTitle: '配一副牌', localSub: '选好 12 张再开局 —— 也可以等对局里占矿/杀晶甲兽时拿新卡',
      readyLocal: '用这副开局', localDeck: '配牌中：选满 12 张（地形 ≥4），再用这副开局',
      localSaved: '这副牌已存下：下一局就用它',
      localSteps: '① 左边点卡加进牌库（满 12 张、地形 ≥4）  ② 点「用这副开局」  ③ 回到选关点开始',
      remove: '×', removeTip: '少带一张',
      emptyPicks: '牌库还空着 —— 从左边点一张卡加进来',
      /* 状态行：等待对手 / 我已就绪 / 对手已就绪 / 双方就绪 / 被房主退回 */
      waitPeer: '等待对手选牌…', readySelf: '我已就绪，等待对手',
      peerReady: '对手已就绪 —— 等你这边', bothReady: '双方就绪，房主正在建局',
      denied: '这一步没做成',
      backPeer: '已回到选关；这条连接还挂着（断开要等联机那一刀接上）',
      reject: '这份牌库被房主退回 —— 改完再点就绪',
      needJoin: ' · ',
      roles: { host: '房主', guest: '加入者' },
      /* 已选张数那一列（0 张留空，别画一个 ×0 当噪声） */
      each: function (n) { return (n | 0) > 0 ? ('×' + (n | 0)) : ''; },
      count: function (v) {
        return '总 ' + (v.loadoutCount | 0) + ' / ' + (v.loadoutDeckSize | 0) +
          ' 张' + ' · 地形 ' + (v.loadoutTerrain | 0) + ' / ' + (v.loadoutTerrainMin | 0);
      },
      needCount: function (v) {
        return '还差 ' + ((v.loadoutDeckSize | 0) - (v.loadoutCount | 0)) + ' 张才凑满整副';
      },
      needTerrain: function (v) {
        return '地形卡还差 ' + ((v.loadoutTerrainMin | 0) - (v.loadoutTerrain | 0)) + ' 张';
      },
      /* 状态行唯一的翻译处：认不出的 key 也不空着（原样演出来比沉默好查） */
      statusText: function (key, v) {
        const C = H.TEXT.loadout || {};
        const bits = [];
        const who = (C.roles && C.roles[v && v.loadoutRole]) || '';
        const room = (v && v.loadoutRoom) || '';
        if (who && room) bits.push(who + ' · 房间 ' + room);
        else if (who) bits.push(who);
        else if (room) bits.push('房间 ' + room);
        let s = '';
        const k = String(key || 'waiting');
        if (k.indexOf('reject') === 0) s = C.reject || '';
        else if (k === 'denied') s = (C.denied || '') + '：' + (H.denyText((v && v.loadoutDeny) || '') || '');
        else if (k === 'localDeck') s = C.localDeck || '';
    else if (k === 'waiting') s = (v && v.loadoutReady) ? (C.readySelf || '') : (C.waitPeer || '');
        else s = C[k] || C.waitPeer || '';
        if (s) bits.push(s);
        return bits.join(' —— ');
      }
    },

    /* ---------- 逻辑层报上来的 key → 中文（creative / 光影 / 物质 / 拒绝原因 / 提示） ---------- */
    creative: {
      on: { text: '创造调试模式：开（I 背包 · X 飞行）', color: 'var(--brass)', log: '创造模式已开启：无限魔力 · 卡牌不消耗 · 无冷却 · 无敌。按 I 打开背包任意取卡。' },
      off: { text: '创造调试模式：关', color: 'var(--txt-2)' },
      fly: { text: '飞行：开（空格升 / 左Shift 降）', color: 'var(--txt-2)' },
      noclip: { text: '穿墙飞行：开（会穿过地形，注意别卡进岩层）', color: 'var(--bad)' }
    },
    post: {
      on: { text: '光影：开（曝光 · 选择性泛光 · 冷暖分级 · 暗角）', color: 'var(--sh)' },
      off: { text: '光影：关（回到原始直渲）', color: 'var(--txt-2)' },
      broken: { text: '光影不可用：本机 WebGL 建立渲染目标失败，已固定走直渲', color: 'var(--bad)' }
    },
    /* ---------- 联机（N2 接线；docs/NET.md §9.5）：连不上/没房间/版本不符/对手离开 全部明说，
       不许假装开局。装配层（main.js）只报这些 key，颜色沿用 ui.colors 的档位。 */
    net: {
      connecting: '正在连接…',
      noHost: '没有这个房间（房主还没开）',
      version: '协议版本不符，请两端用同一份本目录',
      hostGone: '房主已离开',
      guestGone: '对手已离开',
      roomTaken: '这个房间已经有人了',
      joined: '已连上，对手来了',
      /* 名字标签（任务书 6b）：对局里两台的位置叫「你 / 对手」。
         H.TEXT.ui.names.p2 是「AI 对手」——那是单人训练的说法，联机里读着不对；
         两份表分开是因为它们说的是两种事实（对面是不是人），不是同一个词的两处写法。
         单人 / 分屏不传 mode，读的还是 ui.names 那一套，一个字节都没变。 */
      names: ['你', '对手'],
      hotkeyOff: '联机时快捷出牌不可用（出牌要等房主裁决）',
      /* 任务书 8 之外多备的一句：按 T 切分屏会重建输入源并挂上 AISource，
         在联机里等于让 AI 替对手出牌——这条拒绝也得有声音，不许静默吞按键 */
      splitOff: '联机时不能切分屏（对手那一席由他那台机器的键盘输入，分屏是同机验证用的）',
      /* 卡顿 vs 掉线（2026-10-18）：服务端 1 秒应用心跳缺席就发 peer-stalled，那只是"对面卡了"，
         不是"人走了"——装配层只提示不结算，真掉线由 bye / TCP 判死负责（tools/net_e2e.cjs 的 E8 守着）。 */
      stalled: '对手画面卡住了（只是掉帧，不是掉线）',
      unstall: '对手画面恢复了'
    },
    chem: {
      ignite: { text: '可燃物被点着了', color: 'var(--el-fire)' },
      steam: { text: '水浇在火上，腾起一片蒸汽', color: 'var(--txt-1)' },
      ash: { text: '烧完了，只剩灰烬', color: 'var(--txt-3)' },
      obsidian: { text: '岩浆遇水，凝成黑曜石', color: 'var(--txt-2)' },
      melt: { text: '冰被烤化，摊成一摊水', color: 'var(--el-ice)' },
      freeze: { text: '水面冻住了', color: 'var(--el-ice)' },
      caught: { text: '有人踏进了火里', color: 'var(--bad)' }
    },
    ui: {
      deny: {
        'read-only': '这一堆是对局发出来的，看可以，改不行',
        'slot-full': '这一格放不下了',
        'no-room': '没有地方放它',
        'creative-only': '这一页是创造模式的调试能力：按 G 开创造模式才拿得起来（生存模式照样有手持栏与随身格）',
        'no-class': '认不出这一类卡牌',
        'no-player': '先进入一局再切换类别',
        'select-only': '手持栏点一下就选中；要搬动请在背包里拖',
        'no-handler': '这条路还没接上（通道留着，等机制层）',
        /* 联网已经能真跑（N1/N2），这条拒绝只剩一个真实成因：服务器那一格没填，连谁都不知道。
           话要说得能照着做（docs/NET.md §9.5），但不许把它当成「联机没做」的假口实。 */
        'net-offline': '未启用：服务器那一格是空的——填成 ws://<房主 IP>:8787（房主先在本机跑 node tools/net_host.cjs 8787）',
        /* 战前选牌（docs/ROUTER.md §2）：三条超限各有一句人话。判据本身在 src/ui/viewmodel.js 的
           UI.LOADOUT_RULES 与 H.loadoutPick 里，这里只负责「被拒时必须演出来」——
           上一版这三条没句子，玩家点第三张的时候看到的就是英文 key。 */
        'limit': '同一张卡最多带 2 份 —— 先把这一张去掉一份再换别的',
        'deck-full': '牌库已经 12 张满了 —— 先在右边去掉一张再加',
        'nothing-picked': '这一张还没进牌库，去不掉',
        'not-enough': '牌库还没凑够：整副 12 张、地形卡至少 4 张',
        'unknown-card': '卡池里没有这张卡（卡牌数据没加载？）',
        'unknown-intent': '不认识的意图',
        'handler-error': '这条路出错了，已拦下',
        'not-running': '先进入一局',
        'bad-save': '这份存档读不了（JSON 不完整或种子对不上）',
        'denied': '这一步被拒绝了',
        'empty': '这一格是空的',
        'no-box': '这一格不在格子上',
        'no-partner': '没有能放它的地方',
        'no-drag': '先拿起来再拖',
        'no-button': '先拿起来再拖',
        'mismatch': '这一格已经放了别的东西',
        'no-hand': '手上没有牌',
        'unknown-mode': '认不出的操作',
        'unknown-intent': '认不出的操作',
        'nothing': '手里没拿着东西',
        /* 2026-10-18 起生存模式也能把牌库里的牌换进手持栏（拖过去 / 卡页按钮）：
           被拒只有两种真实成因——手里按着某一组、和这张不同组；或牌库里没有这张。 */
        'group-mismatch': '手持栏现在按“组”筛选：先切回「全部」，或换成同一组的牌',
        'no-card': '牌库里已经没有这一张了'
      },
      msg: {
        'no-item': '先在图鉴里点一张卡（或把鼠标停在卡上），再按这个按钮',
        'why-give': '图鉴取卡要开创造模式（按 G）；牌库里的牌可以直接拖到手持栏上换一张',
        spillToDiscard: '手持栏满了：这张牌进了弃牌堆（洗牌后会再抽到）',
        'why-tray': '取卡货架是创造模式的调试能力（按 G 开启）',
        cam: function (n) { return '视角：' + n; },
        camLog: function (n) { return '视角切到 ' + n + '（按 C 循环：越肩 → 第一人称 → 越肩不画自己）'; },
        audioOn: { text: '声音：开', color: 'var(--txt-2)' },
        audioOff: { text: '声音：静音', color: 'var(--txt-2)' },
        splitOn: '已切换：同屏分屏双人 PVP', splitOff: '已切换：单人训练（对手 AI）',
        worldReady: function (o) { return '世界已生成：seed ' + o.seed + '（' + o.dims + '，' + o.mode + '）'; },
        howto: '移动不消耗卡牌；其余操作全部靠出牌。按 H 看操作。',
        netOffline: '联网 PVP 需先启动 server.js（接口已预留）',
        errStep: function (m) { return '逻辑异常已拦截：' + m + '（本帧跳过，若反复出现请按 R 重开）'; },
        saveNeedMatch: '先进入一局再导出', saveExported: function (n) { return '已导出（地形变更 ' + n + ' 格）'; },
        saveCopied: '存档 JSON 已写入文本框，可复制分享', saveEmpty: '文本框里没有存档 JSON',
        saveLocalOk: '本局已存到本地（菜单里可读取）', saveLocalFail: '本地存储不可用',
        saveToBox: '已导出到菜单文本框',
        stepCap: function (n) { return n + ' 格/卡'; }
      },
      modeNames: { train: '训练 vs AI', split: '分屏 PVP', hotseat: '热座 PVP', net: '联网 PVP' },
      names: { p1: '你', p2: 'AI 对手', p1Split: 'P1 红方', p2Split: 'P2 蓝方' },
      colors: { gold: 'var(--brass)', dim: 'var(--txt-2)', ok: 'var(--ok)', bad: 'var(--bad)' }
    }
  });
  function cnOf(id) { const d = G.BLOCK_DEFS && G.BLOCK_DEFS[id]; return d ? d.cn : '?'; }

  /* ==================== 2. 物品注册：把画法与说明接进 GW.UI.Items ==================== */
  H.registerItems = function () {
    const U = H.TEXT.inv.units;
    UI.Items.register('card', {
      maxStack: 1,
      icon: function (canvas, item) { return UI.Art.card(canvas, (item.meta && item.meta.card) || G.CARDS_BY_ID[item.id]); },
      same: function (a, b) { return a.id === b.id; }
    });
    UI.Items.register('block', {
      maxStack: 64,
      icon: function (canvas, item) { return UI.Art.paint(canvas, { kind: 'block', id: item.id }, { size: 32 }); }
    });
    UI.Items.register('stack', { maxStack: 999, icon: function (canvas) { return UI.Art.back && UI.Art.back(canvas); } });
  };
  /* 视图模型要的每一条物品条目都在这里长出来（中文说明也在这里，因为这里是文案的家） */
  H.makeItem = function (kind, id, count, extra) {
    const U = H.TEXT.inv.units;
    if (kind === 'card') {
      const card = (extra && extra.card) || (G.CARDS_BY_ID ? G.CARDS_BY_ID[id] : null);
      if (!card) return null;
      const cd = (extra && extra.cd) || 0;
      const el = G.ELEMENTS[card.element] || { color: '#c9d3e0' };
      return UI.Items.make('card', card.id, count == null ? 1 : count, {
        id: card.id, card: card, label: card.name, detail: card.text || '',
        kindLine: U.cardKind(card), cost: card.cost, tone: el.color,
        cdText: cd > 0.05 ? U.cd(cd) : (card.cooldown ? U.cd0(card.cooldown) : ''),
        cdRatio: (cd > 0 && card.cooldown) ? Math.min(1, cd / card.cooldown) : 0,
        deny: !!(extra && extra.deny), seq: (extra && extra.seq) || 0
      });
    }
    if (kind === 'block') {
      const d = G.BLOCK_DEFS && G.BLOCK_DEFS[id];
      if (!d) return null;
      return UI.Items.make('block', id, count == null ? 1 : count, {
        id: 'block:' + d.key, label: d.cn, detail: U.block(d), kindLine: U.blockKind(d),
        tone: d.color, cost: null, cdText: '', cdRatio: 0, deny: false, seq: 0
      });
    }
    return null;
  };
  /* 提示内容：拖拽层只问一句"这个东西该怎么说" */
  function describeItem(item) {
    if (!item || !item.meta) return '';
    const U = H.TEXT.inv.units;
    const bits = [item.meta.label];
    if (item.meta.kindLine) bits.push(item.meta.kindLine);
    if (item.meta.cost != null) bits.push('费用 ' + U.cost(item.meta.cost));
    if (item.meta.cdText) bits.push(item.meta.cdText);
    if (item.meta.detail) bits.push(item.meta.detail);
    if (item.count > 1) bits.push(U.stack(item.count));
    return bits.filter(Boolean).join('\n');
  }

  /* ==================== 3. 启动 ==================== */
  H.init = function (handlers) {
    H.handlers = handlers || {};
    if (!UI || !UI.build) { if (console && console.error) console.error('[GW.HUD] UI 框架没加载（js/ui/*.js 顺序错了）'); return; }
    H.registerItems();
    /* 出牌组的中文名只有一份（H.TEXT.inv.categories）：手持栏那条指示条直接指过去，
       不许在 hotbar 段再抄一遍 8 个组名——两处一抄，改名时必然漏一处。 */
    H.TEXT.hotbar.classNames = H.TEXT.inv.categories;
    const copy = {
      topbar: H.TEXT.topbar, vitals: H.TEXT.vitals, aim: H.TEXT.aim, log: H.TEXT.log || {},
      toast: H.TEXT.toast || {}, hotbar: H.TEXT.hotbar, inv: H.TEXT.inv, choice: H.TEXT.choice,
      /* board 段单独交给 Topbar 的积分榜那块（行标签与 chip 的中文都在这张表里，面板只按序渲染） */
      /* loadout 直接交文案表本体：这一页的条目（全部卡）由 viewmodel 现做，不需要 levelCopy 那种合成 */
      menu: menuCopy(), level: levelCopy(), loadout: H.TEXT.loadout, result: H.TEXT.result, board: H.TEXT.board
    };
    ui = H.ui = UI.build({ copy: copy });
    vm = H.vm = new UI.ViewModel({
      bag: ui.bag, channel: ui.channel, sel: H.sel, model: ui.app.model,
      makeItem: H.makeItem,
      getSpec: function () { return G.Creative && G.Creative.spec ? G.Creative.spec() : null; }
    });
    vm.loadTray(ui.bag.get('tray').size);
    ui.channel.provide('describeItem', describeItem);
    /* 类别的顺序与中文是展示口径，归文案表；权威层只认 cards.js 里的 type 字段 */
    ui.channel.provide('classOrder', function () { return (H.TEXT.inv && H.TEXT.inv.classOrder) || []; });
    ui.channel.provide('classTypes', function () { return (H.TEXT.inv && H.TEXT.inv.classTypes) || []; });
    ui.channel.provide('classLabels', function () { return (H.TEXT.inv && H.TEXT.inv.categories) || {}; });
    /* 通道回执必须有人演出来。UI.onChannelNotify 一直定义在文件末尾，却**从来没人订阅** 'ui:notify'：
       于是"没人接的意图"、"创造模式才能拿"、"这一格放满了"这些诚实的拒绝，在玩家那边全是一片沉默
       ——2026-10-17 用户报"点四个按钮完全没反应、拖了也不能执行"，根子就在这条断掉的线上。 */
    ui.channel.bus.on('ui:notify', function (d) { if (UI.onChannelNotify) UI.onChannelNotify(d); });
    ui.channel.provide('tray', function () { return vm.state.tray; });
    /* 筛选变化 / 收藏变化：只重算需要重算的面板 */
    ui.channel.bus.on('ui:filter', function () { vm.applyFilters(); ui.invalidate('inv'); });
    ui.channel.bus.on('ui:tray-add', function (d) {
      const r = vm.trayAdd(d && d.item);
      H.say(r.ok ? 'trayAdd' : 'trayFull', r.ok ? 'ok' : 'bad', d && d.item && d.item.meta && d.item.meta.card);
      ui.invalidate('inv');
    });
    ui.channel.bus.on('ui:toast', function (d) { if (d && d.key) H.say(d.key); });
    /* 菜单与结算：按钮语义留在视图层，动作交回装配层 */
    ui.panels.menu.handlers = H.handlers;
    ui.panels.menu.show();
    ui.channel.bind('hud', {
      /* 菜单那一排与选关面板读的是**同一份** vm.level（单一真源）：这里就地写，两个面板一起刷。 */
      'ui.menuPick': function (p) {
        /* 三个 net 字段必须在这份兜底初始状态里就有：下面的写入用 `field in L` 当闸，
           不在状态里的字段会被静默丢掉却照样回 ok:true（假成功）。真源仍是 panels.js 的 useModel，
           这两处初值不一致时 panels.js 那份赢（它在 UI.build 里先跑），这里只是同口径兜底。 */
        const L = vm.state.level || (vm.state.level = {
          map: G.MAP_DEFAULT || 'duel-64', rule: G.RULE_DEFAULT || 'ranked', mode: 'train', deck: 'starter', seed: '', creative: false,
          netUrl: 'ws://127.0.0.1:8787', netRoom: 'ROOM', netRole: 'host',
          /* 玩法那两条轴同样要在这份兜底初值里就有（与 panels.js 的 useModel 同一口径）：
             缺字段时 `field in L` 直接把点击吞掉却回 ok:true（假成功）。 */
          game: G.GAME_DEFAULT || 'lode', gameTarget: 10
        });
        if (p && p.field in L) L[p.field] = p.value;
        ui.invalidate('menu'); ui.invalidate('level');
        return { ok: true };
      },
      'ui.menuAction': function (p) { return menuAction(p && p.key); },
      'ui.resultAction': function (p) { return resultAction(p && p.key); }
    });
    /* 页面加载即处于菜单：先淡出战斗 HUD，别与菜单叠字 */
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.style.opacity = '0';
    ready = true;
    return ui;
  };
  function menuCopy() {
    const C = H.TEXT.menu;
    C.spec = [
      ['验收', '同种子两次开局地形逐格一致 · 地形改动本局持久 · 除移动外操作必须出牌'],
      ['数值', '1 魔力 = 6 伤害 = 5 护盾 = 1 格地形；单卡地形 ≤ ' + (G.Rules && G.Rules.MAX_TERRAIN_CELLS ? G.Rules.MAX_TERRAIN_CELLS : 9) + ' 格'],
      ['内容', (G.CARDS ? G.CARDS.length : 0) + ' 张卡 · 6 流派 · ' + Object.keys(G.SIGILS || {}).length + ' 种魔法阵 · 3 个生物群系'],
      ['引擎', '逻辑 20Hz 权威 tick，渲染与逻辑分离；越肩相机遮挡自动收缩']
    ];
    return C;
  }
  function menuAction(key) {
    if (key === 'help') { H.showHelp(true); return { ok: true }; }
    /* 「开始游戏」= 进选关：场景与面板的显隐归装配层（它认识 Scene），这里只在没接线时诚实拒绝 */
    if (key === 'level') {
      if (H.handlers.menuAction) return H.handlers.menuAction(key, null);
      return { ok: false, reason: 'no-handler' };
    }
    if (key === 'export' || key === 'import' || key === 'local') {
      if (H.handlers.menuAction) return H.handlers.menuAction(key, H.readSaveBox());
      return { ok: false, reason: 'no-handler' };
    }
    return { ok: false, reason: 'unknown-intent' };
  }
  function resultAction(key) {
    H.hideResult();
    if (key === 'again') { H.handlers.start && H.handlers.start(H.config(true)); return { ok: true }; }
    if (key === 'new') {
      if (vm.state.level) vm.state.level.seed = String(Math.floor(Math.random() * 999999));
      ui.invalidate('menu'); ui.invalidate('level');
      H.handlers.start && H.handlers.start(H.config()); return { ok: true };
    }
    if (key === 'menu') { H.showMenu(); return { ok: true }; }
    /* 回选关（docs/LEVELS.md §0 的场景流：result → level）：同样交给装配层，没人接不假装 */
    if (key === 'level') {
      if (H.handlers.level) return H.handlers.level();
      return { ok: false, reason: 'no-handler' };
    }
    return { ok: false, reason: 'unknown-intent' };
  }
  /* 选关的两栏条目 = 数据层的数字 + 本表的中文，合成在这里（panels.js 因此一个中文都不写）。
     顺序照 mapOrder / ruleOrder；数据层没有的 id 直接不画（不许凭空多一栏），条目不够就照实少几栏。 */
  function levelCopy() {
    const C = H.TEXT.level || (H.TEXT.level = {});
    const M = G.MAP_PRESETS || {}, N = G.RULE_PRESETS || {};
    const defMap = G.MAP_DEFAULT || 'duel-64', defRule = G.RULE_DEFAULT || 'ranked';
    C.maps = (C.mapOrder || []).filter((k) => !!M[k]).map((k) => {
      const p = M[k];
      return {
        key: k, name: (C.mapNames || {})[k] || k, note: (C.mapNotes || {})[k] || '',
        meta: C.fmtSize ? C.fmtSize(p) : p.size.join(' × '),
        tag: p.experimental ? (C.expTag || '') : '', rec: (k === defMap) ? (C.recoTag || '') : ''
      };
    });
    C.rules = (C.ruleOrder || []).filter((k) => !!N[k]).map((k) => {
      const r = N[k];
      return {
        key: k, name: (C.ruleNames || {})[k] || k, note: (C.ruleNotes || {})[k] || '',
        meta: C.fmtRule ? C.fmtRule(r) : String(r.scoreWin),
        tag: '', rec: (k === defRule) ? (C.recoTag || '') : ''
      };
    });
    /* 卡组名与菜单同一份引用：两处要是不一致，玩家看到的同一个 key 就有两个名字 */
    C.decks = (H.TEXT.menu && H.TEXT.menu.decks) || [];
    /* 「玩法」那两张卡（docs/MODES.md §6）：条目 = G.GAME_MODES 的 key 顺序，数字现读数据层，
       中文现读 H.TEXT.game —— 追加玩法只改数据表 + 那张文案表，这个函数自动长出一条。
       表里没有的 id 不画（与 maps / rules 同一条口径：不许凭空多一栏）。 */
    const GM = G.GAME_MODES || {}, GN = (H.TEXT.game && H.TEXT.game.names) || {}, GT = (H.TEXT.game && H.TEXT.game.notes) || {};
    const gdef = G.GAME_DEFAULT || 'lode';
    C.games = Object.keys(GM).map(function (k) {
      return {
        key: k, name: GN[k] || k, note: GT[k] || '',
        meta: C.fmtGame ? C.fmtGame(GM[k]) : String(k),
        tag: '', rec: (k === gdef) ? (C.recoTag || '') : ''
      };
    });
    /* 「胜分」三档：档位来自数据层的 DM_TARGETS（5 / 10 / 0 = 不限），文字来自 H.TEXT.game.dmTargets。
       key 用字符串给 data-key（真鼠标与量具按 [data-field][data-key] 找它），写进状态的 value 保持数字。 */
    const DT = (H.TEXT.game && H.TEXT.game.dmTargets) || {}, DTN = (H.TEXT.game && H.TEXT.game.dmTargetNotes) || {};
    C.gameTargets = (G.DM_TARGETS || []).map(function (v) {
      return { value: v, label: DT[v] != null ? DT[v] : (v + ' 杀'), note: DTN[v] || '', meta: '', rec: '' };
    });
    return C;
  }

  /* ==================== 4. 历史入口（main.js 与回归脚本只认这些名字） ==================== */
  function need() { return !!ui; }
  /* cfg 的三个轴（map / rule / mode / deck / seed / creative）的唯一形状在 panels.js 的 Menu.config（docs/LEVELS.md §2）；
     这里只补联机那一项：读**同一份**视图状态 vm.state.level（菜单 / 选关 / 这里共用，单一真源），
     形状按 main.js 的 startNet 认的那份 cfg.net = { url, room, role }（docs/NET.md §9.5）。
     没往 panels.js 的 Menu.config 里加，是因为那条是三个轴的契约，本刀只加联机入口那一项。 */
  H.config = function (keepSeed) {
    const cfg = need() ? ui.panels.menu.config(keepSeed)
      : { mode: 'train', deck: 'starter', rule: G.RULE_DEFAULT || 'ranked', map: { id: G.MAP_DEFAULT || 'duel-64' }, seed: '', creative: false };
    const L = (vm && vm.state.level) || {};
    cfg.net = { url: L.netUrl, room: L.netRoom, role: L.netRole };
    /* 第二条轴（docs/MODES.md §6）：玩法与它的胜分。缺字段时给默认玩法，未知 id 由
       src/app/game-modes.js 的 gameModeFor 回退 lode（这条回退只在数据层做一次）。
       target 原样带上（0 = 不限），这里不许把它翻译成 10 或任何别的数。 */
    cfg.game = { id: L.game || G.GAME_DEFAULT || 'lode', target: L.gameTarget };
    return cfg;
  };
  /* 开局：音效解锁 + 交回装配层 */
  H.startWith = function (cfg) { if (G.Audio && G.Audio.resume) G.Audio.resume(); if (H.handlers && H.handlers.start) H.handlers.start(cfg); };
  H.showMenu = function () { if (need()) { ui.panels.menu.show(); ui.panels.menu.sync(ui.app.model); } };
  H.hideMenu = function () { if (need()) ui.panels.menu.hide(); };
  H.menuOpen = function () { return need() && ui.panels.menu.open; };
  H.showResult = function () { if (need()) ui.panels.result.show(); };
  /* 选关面板的开合是**视图层状态**（与背包 / 三选一同一条口径）：谁开着由 hud 回答，主循环问 hud */
  H.showLevel = function () { if (need()) { ui.panels.level.show(); ui.invalidate('level'); } };
  H.hideLevel = function () { if (need()) ui.panels.level.hide(); };
  H.levelOpen = function () { return need() && ui.panels.level.open; };
  H.hideResult = function () { if (need()) ui.panels.result.hide(); };

  /* ==================== 4b. 战前选牌（docs/ROUTER.md §2；任务书 L1 第 5 条）====================
     这一页只在联机模式经过：level 里点「开始对局」→ 连上 → loadout → 双方就绪 → match。
     视图状态只有一份：vm.state.loadout = {picks:{卡id:张数}, ready, status, role, room}，**只能就地改**
     （与 sel 那条同一条口径：整个换掉对象 = 面板永远读旧引用）。
     三条上限（整副 12 / 每张 2 份 / 地形 ≥4）的真源在 src/ui/viewmodel.js 的 UI.LOADOUT_RULES，
     这里读同一份常量：界面写出来的数与判就绪的数不会各说一套。中文句子全在 H.TEXT.loadout。 */
  function loadoutState() {
    if (!need()) return null;
    return vm.state.loadout || (vm.state.loadout = { picks: {}, ready: false, status: 'waiting', deny: '' });
  }
  function loTotal(L) {
    let n = 0;
    if (L && L.picks) for (const k in L.picks) n += L.picks[k] | 0;
    return n;
  }
  function loRefresh() {
    if (vm && vm.buildLoadout) vm.buildLoadout();
    if (ui) ui.invalidate('loadout');
  }
  /* 开合是视图层状态：路由说「去 loadout」，谁开着由 hud 回答（主循环的暂停判据也问这里） */
  H.showLoadout = function (params) {
    if (!need()) return false;
    const p = ui.panels.loadout;
    if (!p) return false;
    const L = loadoutState();
    const q = params || {};
    /* 装配层只递 id（role / room），「房主 / 加入者」的说法在 H.TEXT.loadout.roles；
       重新进这一页保留已经挑好的牌（回选关再回来不必重挑），但就绪状态作废 —— 
       就绪是对一份确定的牌库作的承诺，页面重进就要重新按一次（docs/ROUTER.md §2）。 */
    L.role = (q.role != null) ? String(q.role) : '';
    L.room = (q.room != null) ? String(q.room) : '';
    L.local = !!q.local;                       // 配牌模式：没有对手、没有就绪，只有「用这副开局」
    L.ready = false;
    L.status = q.local ? 'localDeck' : 'waiting';
    L.deny = '';
    loRefresh();
    p.show();
    return true;
  };
  H.hideLoadout = function () { if (need() && ui.panels.loadout) ui.panels.loadout.hide(); };
  H.loadoutOpen = function () { return need() && !!ui.panels.loadout && ui.panels.loadout.open; };
  /* 装配层（与 N5 的 loadout 帧）要的牌库：{卡 id: 张数} 的浅拷贝 —— 不许把内部引用递出去改 */
  H.loadoutPicks = function () {
    const out = {};
    const L = (vm && vm.state && vm.state.loadout) || null;
    if (L && L.picks) for (const k in L.picks) out[k] = L.picks[k] | 0;
    return out;
  };
  /* 状态行的 key（中文在文案表）：等待对手 / 我已就绪 / 对手已就绪 / 双方就绪 / 被退回 */
  H.setLoadoutStatus = function (key) {
    const L = loadoutState();
    if (!L) return false;
    L.status = String(key || 'waiting');
    L.deny = '';            // 装配层给了新状态，上一条拒绝就过期了
    loRefresh();
    return true;
  };
  H.markLoadoutReady = function (on) {
    const L = loadoutState();
    if (!L) return false;
    L.ready = !!on;
    if (!L.ready && L.status === 'readySelf') L.status = 'waiting';
    loRefresh();
    return true;
  };
  /* 加 / 减一张：picks 的唯一写入口。超限一律诚实拒绝（reason 的人在 H.TEXT.ui.deny），
     由通道的 ui:notify 演成 toast —— 不许静默，也不许在玩家那边假成功。 */
  H.loadoutPick = function (id, delta) {
    const L = loadoutState();
    if (!L) return { ok: false, reason: 'no-handler' };
    /* 三条上限的唯一真源（src/ui/viewmodel.js）；读不到就说明 ui 模块没按顺序加载，
       这里宁可否决也不自己猜一套数。 */
    const R = UI.LOADOUT_RULES;
    if (!R) return { ok: false, reason: 'no-handler' };
    L.deny = '';
    if (!id || !G.CARDS_BY_ID || !G.CARDS_BY_ID[id]) return { ok: false, reason: 'unknown-card' };
    const d = (delta < 0) ? -1 : 1;
    const cur = L.picks[id] | 0;
    /* 被拒时把 reason 也写进视图状态：这一页是全屏 .menu 底（z 20）压在 #hud（z 5）上面，
       通道那条 toast 玩家看不见（菜单/选关同病，是老问题），所以状态行必须把同一句话说出来。 */
    const deny = (reason) => { L.deny = reason; L.status = 'denied'; loRefresh(); return { ok: false, reason: reason }; };
    if (d > 0) {
      if (cur >= R.eachMax) return deny('limit');
      if (loTotal(L) >= R.deckSize) return deny('deck-full');
      L.picks[id] = cur + 1;
    } else {
      if (cur <= 0) return deny('nothing-picked');
      L.picks[id] = cur - 1;
      if (!L.picks[id]) delete L.picks[id];
    }
    L.deny = '';
    /* 动过牌 → 就绪作废（上面那条注释就是这条的依据） */
    L.ready = false;
    if (L.status === 'readySelf' || L.status === 'bothReady') L.status = 'waiting';
    loRefresh();
    return { ok: true, id: id, n: L.picks[id] | 0, total: loTotal(L) };
  };
  /* 「就绪」：先在本层判构筑合法性（读 UI.LOADOUT_RULES，不读面板的 DOM），合法才把牌库交回装配层。
     装配层没接住就诚实回 no-handler —— 这一页不许假装开局。 */
  H.loadoutReady = function () {
    const L = loadoutState();
    if (!L) return { ok: false, reason: 'no-handler' };
    const R = UI.LOADOUT_RULES;
    if (!R) return { ok: false, reason: 'no-handler' };
    L.deny = '';
    loRefresh();
    const v = vm.state;
    if ((v.loadoutCount | 0) !== R.deckSize || (v.loadoutTerrain | 0) < R.terrainMin) {
      return { ok: false, reason: 'not-enough' };
    }
    /* 配牌模式：不走线上那条（没对手可等），把牌库交给装配层存下并回选关 */
    if (L.local) {
      if (H.handlers && H.handlers.loadoutLocal) {
        const rl = H.handlers.loadoutLocal(H.loadoutPicks());
        return rl || { ok: true };
      }
      return { ok: false, reason: 'no-handler' };
    }
    L.ready = true;
    L.status = 'readySelf';
    loRefresh();
    if (H.handlers && H.handlers.loadoutReady) {
      const r = H.handlers.loadoutReady(H.loadoutPicks());
      if (r && r.ok === false) {
        /* 装配层拒绝（构筑不合法 / 没连上）：就绪跟着收回，界面回到等待态，不把「就绪」画成真 */
        L.ready = false; L.status = 'waiting'; loRefresh();
      } else if (r && r.status) { L.status = String(r.status); loRefresh(); }
      return r || { ok: true };
    }
    return { ok: false, reason: 'no-handler' };
  };
  /* 「返回」：断开连接 + 切页都在装配层（它认识 net 与 Router），这里只转达，不自己隐面板 */
  H.loadoutBack = function () {
    if (!need()) return { ok: false, reason: 'no-handler' };
    if (H.handlers && H.handlers.loadoutCancel) {
      const r = H.handlers.loadoutCancel();
      if (r && r.ok === false) return r;
      H.hideLoadout();
      return r || { ok: true };
    }
    return { ok: false, reason: 'no-handler' };
  },
  H.showHelp = function (on) {
    const el = document.getElementById('help');
    if (el) el.style.display = on ? 'block' : 'none';
    H.helpOn = !!on;
  };
  H.readSaveBox = function () {
    /* 文本框正在被玩家打字时以 DOM 为准，别把输入框里的内容读成空 */
    var el = document.getElementById('saveBox');
    if (el && typeof el.value === 'string') return el.value;
    return vm ? String(vm.state.saveText || '') : '';
  };
  H.setSaveText = function (t) {
    if (!vm) return;
    vm.state.saveText = String(t == null ? '' : t);
    if (ui) ui.invalidate('menu');
  };

  /* 编排类那一本账的一行读数：`击杀 / 死亡`。director 不在就诚实说「—」（面板不许自己猜数）。 */
  function kdText(match, side) {
    const d = match && match.director;
    if (!d || !d.snapshot) return '—';
    const s = d.snapshot();
    if (!s || !s.kills || !s.deaths) return '—';
    return (s.kills[side] | 0) + ' / ' + (s.deaths[side] | 0);
  }
  /* 结算面板：字段与文案都来自 H.TEXT.result，装配层只宣布"对局结束了"。
     info 是可选的第三参数（main.js 递来 winReason / mapId / ruleId 三个 id）：
     装配层只说 id，中文一律在这张文案表里翻（layer_check 拦装配层写死文案）。 */
  H.showMatchResult = function (match, mode, info) {
    if (!need() || !match || !match.over) return;
    const R = H.TEXT.result, o = match.over;
    const extra = info || {};
    const p1 = match.players[0], p2 = match.players[1];
    const val = {
      name: o.name, time: R.seconds(o.time), ticks: o.ticks,
      p1kills: p1 ? p1.kills : 0, p2kills: p2 ? p2.kills : 0,
      seed: match.seed, cap: R.cells(G.Rules ? G.Rules.terrainCap(p1) : 9),
      /* 原因优先用装配层递来的，退回 over.winReason（权威层写的），再退 manual；关卡读 vm 的 id 字段。
         第二个参数是玩法 id：同一个 key（score / time / overtime）在死亡竞赛里说的是"击杀数"，
         在 lode 里说的是"占矿积分 + 击杀"——两份中文都在本表，面板一行没多认识东西（MODES.md §5）。 */
      reason: R.reasonFor(extra.winReason != null && extra.winReason !== '' ? extra.winReason : o.winReason,
        (match.modeCfg && match.modeCfg.id) || extra.modeId || ''),
      /* 编排类的击杀/死亡账（docs/MODES.md §5 末条）：只读 snapshot，不在这里判"谁赢了"。
         没挂编排类（老路径、取景用的假 match）就给「—」：行留着，值不许空真。 */
      p1kd: kdText(match, 0), p2kd: kdText(match, 1),
      level: R.level(extra.mapId != null ? extra.mapId : (vm.state.mapText || ''),
        extra.ruleId != null ? extra.ruleId : (vm.state.ruleText || ''),
        (match.modeCfg && match.modeCfg.id) || extra.modeId || '')
    };
    var ms = (G.MatchStats && G.MatchStats.snapshot) ? G.MatchStats.snapshot(match) : null;
    if (ms && ms.perSide) { val.p1score = ms.perSide[0].score; val.p2score = ms.perSide[1].score; }
    /* 联机 guest 不跑 addScore：MatchStats.perSide 的分数在它那儿恒 0，权威分数只在 players[].score 上
       （applySnapshot 每份快照都镜像过一次）。有 players 就以它为准——单人/房主两边同值，逐字不变；
       guest 侧这才不会在结算面板上看到「P1 得分 0 / P2 得分 0」（NET.md §10.6 的已知差距，这里收掉）。 */
    if (p1 && p2) { val.p1score = p1.score | 0; val.p2score = p2.score | 0; }
    var agg = (G.StatsStore && G.StatsStore.aggregate) ? G.StatsStore.aggregate() : null;
    if (agg) { val.histGames = agg.games; val.histWin = R.histWinText(agg.winRate); val.histAvg = R.histSec(agg.avgDuration); }
    vm.state.result = {
      title: (mode === 'train') ? (o.winner === 0 ? R.win : R.lose) : R.beat(o.name),
      p1score: val.p1score | 0, p2score: val.p2score | 0, winner: o.winner, win: o.winner === 0,
      rows: R.rows.map(function (r) { return [r[0], String(val[r[1]] === undefined ? '' : val[r[1]])]; })
    };
    const fd = document.getElementById('fade');
    if (fd) fd.classList.add('on');
    setTimeout(function () { if (fd) fd.classList.remove('on'); H.showResult(); }, 260);
  };

  /* ==================== 5. 日志 / 提示 / 逐帧 ==================== */
  var toastTimer = 0;
  /* 权威层（battle.js / rules.js）历史上把色号当参数直接递给 fx.log —— 那等于把调色板抄进了逻辑层。
     门面层在这里翻一次：旧色号 → 令牌名；认不出的原样透传（ui_shot --gate 会把它当离群颜色打出来，
     哪天列表空了就把 battle.js / rules.js 里的实参一起删掉）。 */
  var LEGACY_TONE = {
    '#9d95c4': 'var(--txt-2)', '#8a94a6': 'var(--txt-3)', '#ff9f9f': 'var(--bad)',
    '#c9d3e0': 'var(--el-neutral)', '#7fd97f': 'var(--ok)', '#ffffff': 'var(--txt-1)',
    '#ffd86b': 'var(--brass)', '#8fd6ff': 'var(--sh)', '#7fd7ff': 'var(--el-ice)',
    '#ff9a5a': 'var(--el-fire)', '#ff7a45': 'var(--el-fire)', '#a8e6ff': 'var(--el-ice)'
  };
  function toneColor(c) { if (!c) return ''; return LEGACY_TONE[String(c).toLowerCase()] || c; }
  H.log = function (msg, color) {
    if (!need()) return;
    ui.panels.log.add(String(msg), toneColor(color));
    ui.invalidate('log');
  };
  H.toast = function (msg, color, ms) {
    if (!need()) return;
    ui.panels.toast.push(String(msg == null ? '' : msg), toneColor(color), ms);
    ui.invalidate('toast');
  };
  /* 逻辑层只报 key：中文与颜色都在 H.TEXT.ui.msg / H.TEXT.ui.colors 里 */
  H.say = function (key, tone, arg) {
    const M = H.TEXT.ui.msg, col = H.TEXT.ui.colors[tone || 'gold'];
    const v = M[key]; if (v === undefined) return;
    if (typeof v === 'function') { H.toast(v(arg), col); return; }
    if (v && v.text) { H.toast(v.text, v.color); return; }
    H.toast(String(v), col);
  };
  /* 战前选牌那一句的公开说法（装配层与 N5 只报 key，中文在这张表里）：
     H.TEXT.loadout 是纯字符串表，与 creative/post 的 {text,color} 表不同，所以单独一个入口。 */
  H.sayLoadout = function (key, tone) {
    const C = H.TEXT.loadout;
    if (!C) return;
    const t = C[key];
    if (typeof t !== 'string' || !t) return;
    H.toast(t, H.TEXT.ui.colors[tone || 'dim']);
  };
  H.sayKey = function (table, key, arg) {          // creative / post / chem 那种 {text,color} 表
    const t = H.TEXT[table] && H.TEXT[table][key];
    if (!t) return null;
    const text = typeof t === 'function' ? t(arg) : (t.text || String(t));
    return { text: text, color: t.color || '' };
  };
  H.tickTimers = function (dt) {
    if (!need()) return;
    if (ui.drag) ui.drag.frameGhost(dt);
    ui.app.frame(dt);
  };
  H.frame = H.tickTimers;
  H.fps = function (v) { if (need()) { ui.app.model.fps = String(v); ui.invalidate('topbar'); } };

  /* ==================== 6. 每帧数据：一切经 viewmodel（渲染循环不写 DOM） ==================== */
  H.update = function (match, split, env) {
    if (!need()) return;
    env = env || {};
    if (env.fps === undefined && window.GWAPP) env.fps = window.GWAPP.fps;      // 兼容旧签名
    if (!env.camName && window.GWAPP && window.GWAPP.cams && window.GWAPP.cams[0]) {
      const c = window.GWAPP.cams[0]; env.camName = c.modeName ? c.modeName() : c.mode;
    }
    if (env.err === undefined && window.GWAPP) env.err = !!window.GWAPP.stepErrors;
    if (env.modeText === undefined && match) env.modeText = H.modeText(match.mode);
    if (env.biome === undefined && match && match.players[0]) env.biome = biomeCN(match, env.biomeAt);
    vm.build(Object.assign({ match: match, split: split, fmt: (H.TEXT.vitals && H.TEXT.vitals.fmt) || null }, env));
    /* HUD 的顶栏字段改由 selector 派生（§21）；缺省仍由 match 兜底，保证老入口可用 */
    if (env.app && G.Selectors && G.Selectors.hud) {
      var hv = G.Selectors.hud.get(env.app);
      vm.state.tick = hv.tick; vm.state.time = hv.time; vm.state.seed = hv.seed;
      vm.state.hudKey = G.Selectors.hud.key(env.app);
    }
    ui.invalidate('topbar'); ui.invalidate('vitals0'); ui.invalidate('vitals1');
    ui.invalidate('hotbar'); ui.invalidate('hotbar2'); ui.invalidate('aim');
    ui.invalidate('inv');
  };
  H.modeText = function (m) {
    const t = (H.TEXT.ui && H.TEXT.ui.modeNames) || {};
    return t[m] || m || '';
  };
  /* mode==='net' 才换名册（docs/NET.md §9.5 / 任务书 6b）：对局里两台是「你 / 对手」。
     第二个参数是这次加的，**不传就是老行为**——单人 / 分屏两条路径逐字不变，
     调用点在 src/app/session.js 的 buildMatch（唯一一处传 mode 的地方）。 */
  H.playerNames = function (split, mode) {
    const N = (H.TEXT.ui && H.TEXT.ui.names) || {};
    if (mode === 'net') {
      const NN = (H.TEXT.net && H.TEXT.net.names) || [];
      return [NN[0] || 'P1', NN[1] || 'P2'];
    }
    return split ? [N.p1Split || 'P1', N.p2Split || 'P2'] : [N.p1 || 'P1', N.p2 || 'P2'];
  };
  function biomeCN(match) {
    const w = match.world, p = match.players[0];
    if (!w || !p || !w.biomeCN) return '—';
    const id = w.biomeAt(Math.floor(p.pos.x), Math.floor(p.pos.z));
    return w.biomeCN[id] || '—';
  }

  /* ==================== 7. 准星信息 / 分屏 / 手牌（旧入口，语义走文案表） ==================== */
  H.aimInfo = function (arg, hit) {
    if (!need()) return;
    const F = H.TEXT.aim.fmt;
    let text = '';
    if (arg && typeof arg === 'object') {
      const f = F[arg.key];
      text = f ? (typeof f === 'function' ? f(arg) : String(f)) : (arg.text || '');
    } else text = String(arg || '');
    const m = vm.state;
    m.aimText = text; m.aimHit = !!hit;
    ui.invalidate('aim');
  };
  H.setSplit = function (on) {
    if (!need()) return;
    vm.state.split = !!on;
    ui.invalidate('aim'); ui.invalidate('vitals1'); ui.invalidate('hotbar2'); ui.invalidate('topbar');
    if (window.__layoutSplit) window.__layoutSplit(!!on);
  };
  H.renderHands = function (match, split) {            // 旧签名：真正的渲染在 Hotbar 面板里
    if (!need()) return;
    ui.invalidate('hotbar'); ui.invalidate('hotbar2'); ui.invalidate('inv');
  };
  H.invalidate = function (name) { if (need()) ui.invalidate(name); };
  /* 选中格的**数组本身**是视图状态：装配层要重置它必须走这里就地清零。
     别写 G.HUD.sel = [0,0]：视图模型在 init 时就抓住了这个引用（js/ui/viewmodel.js 的
     "模型必须就地写"同一条），整个换掉等于让界面永久读着一份旧数组 —— 滚轮换选卡就是这么失效的。 */
  H.resetSel = function () { H.sel[0] = 0; H.sel[1] = 0; if (need()) { ui.invalidate('hotbar'); ui.invalidate('hotbar2'); ui.invalidate('inv'); } };
  H.selectSlot = function (side, i) {
    if (!need()) return;
    H.sel[side] = i;
    ui.channel.request('ui.selectSlot', { box: side ? 'hotbar2' : 'hotbar', slot: i, side: side });
    ui.invalidate('hotbar'); ui.invalidate('inv');
  };
  H.castSelected = function (side, i) {
    if (!need()) return;
    ui.channel.request('ui.useSlot', { box: side ? 'hotbar2' : 'hotbar', slot: i, side: side });
  };

  /* ==================== 8. 面板开合（视图层状态；暂停判据与指针交还都在这里） ==================== */
  H.showInventory = function (getSpec, handlers) {
    if (!need()) return false;
    const p = ui.panels.inv;
    vm.deps.getSpec = getSpec || vm.deps.getSpec;
    p.handlers = handlers || p.handlers;
    p.show();
    ui.invalidate('inv');
    return true;
  };
  H.hideInventory = function () {
    if (!need()) return false;
    ui.panels.inv.requestClose();
    return true;
  };
  H.toggleInventory = function (getSpec, handlers) {
    if (need() && ui.panels.inv.open) return H.hideInventory();
    return H.showInventory(getSpec, handlers);
  };
  H.refreshInventory = function () { if (need() && ui.panels.inv.open) ui.invalidate('inv'); };
  H.uiPanelOpen = function () { return !!need() && ui.app.isPanelOpen(); };
  H.panelOpen = function (name) { return !!need() && !!ui.panels[name] && ui.panels[name].open; };
  H.closeTopPanel = function () { return need() && ui.app.closeTop(); };
  /* 通用选择面板：三选一 / 群系三选一以后都调它（docs/GAMEPLAY.md §7.3 禁止另写一套列表 DOM） */
  H.openChoice = function (o) {
    if (!need() || !o) return false;
    const items = (o.items || []).map(function (it) {
      const item = it && it.kind ? it : H.makeItem('card', it.id || it.cardId, 1, { card: it.card || G.CARDS_BY_ID[it.id || it.cardId] });
      return item;
    }).filter(Boolean);
    ui.panels.choice.openWith({
      title: o.title || H.TEXT.choice.title, hint: o.hint || H.TEXT.choice.hint,
      items: items,
      onPick: function (it) { if (o.onPick) o.onPick(it); },
      onSkip: function () { if (o.onSkip) o.onSkip(); }
    });
    ui.invalidate('choice');
    return true;
  };
  H.closeChoice = function () { if (need()) ui.panels.choice.close(); };
  /* 三选一被权威层拒绝时的那句人话（T5 的第 4 条要求"不许静默"）：
     main.js 只报 which（take / skip），中文与颜色都在这张文案表里。 */
  H.draftToast = function (which) {
    if (!need()) return;
    const T = H.TEXT.draft || {};
    const text = String(which === 'skip' ? T.skipFail : T.takeFail);
    H.toast(text, H.TEXT.ui.colors.bad, 1800);
    H.log(text, H.TEXT.ui.colors.bad);
  };

  /* ==================== 9. 徽章 / 提示文案（creative 与 shader 层只报 key） ==================== */
  H.paintGmBadge = function (spec) {
    if (!need()) return;
    const T = H.TEXT.inv.badge, out = [];
    if (spec && spec.on) {
      out.push(T.root);
      if (spec.noclip) out.push(T.noclip); else if (spec.fly) out.push(T.fly);
      if (spec.timeScale !== undefined && spec.timeScale !== 1) out.push(T.speed(spec.timeScale));
      if (spec.ai === false) out.push(T.noAi);
      if (spec.dayLock === 'day') out.push(T.day); else if (spec.dayLock === 'night') out.push(T.night);
      if (spec.unlimitedCells) out.push(T.unlimited);
    }
    ui.app.model.badges = out.filter(Boolean);
    ui.invalidate('topbar');
    ui.invalidate('inv');
  };
  H.creativeToast = function (what) {
    const t = H.sayKey('creative', what);
    if (!t) return;
    H.toast(t.text, t.color);
    const src = H.TEXT.creative[what];
    if (src && src.log) H.log(src.log, H.TEXT.ui.colors.gold);
  };
  H.postToast = function (on) {
    const t = (on && G.SHADER && G.SHADER.isBroken && G.SHADER.isBroken())
      ? H.sayKey('post', 'broken') : H.sayKey('post', on ? 'on' : 'off');
    if (t) H.toast(t.text, t.color);
  };
  H.chemLog = function (key) { const t = H.sayKey('chem', key); if (t) H.log(t.text, t.color); };

  /* ==================== 10. 卡面像素（背包与手持栏共用同一套图章） ==================== */
  H.art = function (canvas, card, opts) { return UI.Art.card(canvas, card, opts); };

  /* ==================== 11. 通道回执的拒绝原因：由视图层说人话 ==================== */
  /* 切换类别的反馈：中文在文案表，数字由装配层递进来 */
  H.sayClass = function (type, n) {
    if (!need()) return;
    const C = (H.TEXT.inv && H.TEXT.inv.categories) || {};
    const name = C[type] || String(type);
    H.toast((n > 0 ? C.set(name, n) : C.empty(name)), H.TEXT.ui.colors.dim);
  };
  H.denyText = function (reason) { return (H.TEXT.ui.deny || {})[reason || 'denied'] || (H.TEXT.ui.deny || {}).denied; };
  /* 出牌被拒：优先用文案表，表里没有就把权威层给的人话原样演出来（rules.canPlay 的 reason 现在是人话，
     这是条已知越界的债，等机制层改成 key 再由这里查表）。 */
  H.sayDeny = function (reason) {
    if (!need() || !reason) return;
    const t = (H.TEXT.ui.deny || {})[reason] || reason;
    H.toast(String(t), H.TEXT.ui.colors.bad);
  };
  if (ui === null) { /* 挂到总线上：首次 init 之前有人调 API 也不会炸 */ }
  UI.onChannelNotify = function (d) {
    if (!d) return;
    const k = d.key;
    if (k === 'deny') { const t = H.denyText(d.payload && d.payload.reason); H.toast(t, H.TEXT.ui.colors.bad); return; }
    if (k === 'spilled') { H.toast(H.TEXT.inv.say.toWorld, H.TEXT.ui.colors.dim); return; }
    if (k === 'given') { H.toast(H.TEXT.inv.say.given(d.payload.card, d.payload.slot), H.TEXT.ui.colors.dim); return; }
  };
})(window.GW);

