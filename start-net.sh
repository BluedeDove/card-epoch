#!/usr/bin/env bash
# 卡牌纪元 · 联机配对服务（房主机器跑这一个窗口）：bash start-net.sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "[x] 没找到 node，请先装 Node.js 18+"; exit 1; }
echo "本机房主：选关里「联网 PVP」→ 服务器 ws://127.0.0.1:8787 → 房间码自带 → 创建房主"
echo "另一台机器：服务器 ws://本机局域网IP:8787 → 同一房间码 → 加入对局"
echo "同一台机器双开：两个浏览器窗口，都填 127.0.0.1 与同一房间码。"
exec node ./tools/net_host.cjs "${1:-8787}"