# audio/ · 纯代码音频（无素材）

这里的一切都是**代码生成的产物**，仓库不保存任何录音、采样或第三方音频库。
真源只有两个脚本；删掉 audio/ 下的 wav 随时能逐位重建。

## 重新生成

```bash
node tools/music_compose.cjs all              # 三段 BGM + 22 条音效 + 试听页
node tools/music_compose.cjs battle           # 只重渲战斗曲
node tools/music_compose.cjs all --seed 7     # 换随机种子（加料层/铃声音高会变，小节结构不变）
```

- [tools/music_synth.cjs](../tools/music_synth.cjs)：合成引擎。振荡器（方波/脉冲/三角/锯齿/正弦/FM 铃）、
  smooth-BLEP 抗混叠、ADSR 与指数包络、RBJ biquad（LP/HP/BP 带扫描）、圆周 comb 混响 + 乒乓延迟、
  软削波母带、16bit WAV 导出、质检（峰值/削波/NaN/循环点跳变）。零第三方依赖。
- [tools/music_compose.cjs](../tools/music_compose.cjs)：编曲与音效配方。和弦表、鼓组、三段 BGM 的音符数据、
  22 条音效的分层设计。**改音乐只动这个文件**，音色参数也在各自的 make 里。

## 无缝循环怎么做到的

轨道长度取整小节，所有写入位置按 N 取模：尾音、混响、延迟越过结尾会自动绕回开头，
所以循环点不需要交叉淡入，也不会有爆音。质检里 `seamRatio` 就是循环点样本跳变 ÷ 曲内 99.9 分位跳变，
≤1 表示循环点听起来和曲中任何一处没有区别。

## 试听

```
audio/demos/listen.html   ← 双击即可（浏览器直接放，不用起服务）
```

| 文件 | 用途 | 口径 |
|---|---|---|
| demos/menu-theme.wav | 主菜单 | 116 BPM · Am–F–C–G · 16 小节 33.1s |
| demos/battle-theme.wav | 战斗中 | 140 BPM · D 多利亚 · 16 小节 27.4s |
| demos/calm-theme.wav | 村庄 / 安全区 | 62 BPM · F 大调七和弦 · 8 小节 31.0s |
| demos/sfx-pack.wav | 音效连播 | 22 条按 BANK 顺序，每条间隔 0.45s |
| sfx/*.wav | 单条音效 | id 与 src/audio.js 的事件名对齐，便于逐条替换 |

## 运行时三层（2026-10-17 拆分）

原来 61 行的 `src/audio.js` 把「怎么发声」「每个音效长什么样」「谁来调用」揉在一起，
现在按 [docs/archive/PLAN_REFACTOR.md](../docs/archive/PLAN_REFACTOR.md) §5.2 预留的 audio 三件套拆开，命名与将来 `src/audio/` 一一对应：

| 文件 | 回答的问题 | 换掉它意味着 |
|---|---|---|
| [js/audio-engine.js](../src/audio-engine.js) | 一层声音**怎么发出来**（声源、包络、滤波、总线、复音上限、离线渲染） | 换发声技术（例如以后改 AudioWorklet），配方与调用点都不用动 |
| [js/sfx-table.js](../src/sfx-table.js) | 每个事件**长什么样**（25 个 id 的分层参数） | 想改爆炸有多闷、水晶有多亮，只在这一页改数字 |
| [src/audio.js](../src/audio.js) | 谁**怎么说**要响（查表、同名 28ms 节流、静音与音量存总线） | 加路由策略（分组音量、优先级），不惊动音色与声源 |

`GW.Audio.play(name)` 这个入口一个字符没改，所以 `battle.js` / `rules.js` / `hud.js` / `main.js` 的调用点零改动；
静音与音量写在总线上（`localStorage.gw.muted` / `gw.vol`），将来 BGM 走 music 总线，M 键一次管全部。

验收由 `node tools/audio_check.cjs`（27 条，含 `--file` 双击路径）拦着：它反查源码里每个 `sfx('x')` 是否能在配方表里查到，
并用 OfflineAudioContext 把 25 个事件真渲染成样本断言非静音、无 NaN、不削波、收尾不硬切、两次渲染逐样本一致。
这一轮它当场抓出两个真实缺陷：`envShape` 的参数顺序写倒（一 play 就抛异常），以及节流窗口把毫秒写成 `0.028`（等于没节流）。

## 还没做

游戏内实时播放（WebAudio 现场排程，替代"先渲染成 wav 再放"）尚未接入 [src/audio.js](../src/audio.js)：
等选定风格后，把 BANK 与三段编曲搬进 `src/music.js`，让 BGM 跟随对局状态切换、
音效仍走 `GW.Audio.play(name)` 一条通道。
