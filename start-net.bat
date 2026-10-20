@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 卡牌纪元 · 联机配对服务
echo ============================================
echo  卡牌纪元 · 联机配对服务（房主机器跑这一个窗口）
echo ============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [x] 没找到 node。请先装 Node.js 18+（https://nodejs.org），装完重开这个窗口。
  pause
  exit /b 1
)
echo 本机房主：选关里「联网 PVP」→ 服务器填 ws://127.0.0.1:8787 → 房间码随便定 → 创建房主
echo 另一台机器：服务器填 ws://本机局域网IP:8787 → 同一房间码 → 加入对局
echo 同一台机器双开测试：开两个浏览器窗口，都填 127.0.0.1 与同一房间码即可。
echo.
node "%~dp0tools\net_host.cjs" 8787
echo.
echo 服务已退出（关掉这个窗口即可）。
pause