#!/bin/bash
# 停止 Mac 上的 HKSI 同步伺服器與隧道
# 雙擊本檔即可（或終端執行 bash stop-mac.command）

echo "▶ 停止同步伺服器與隧道…"
pkill -f "node server.js" 2>/dev/null && echo "✅ 已停止同步伺服器" || echo "• 沒有執行中的同步伺服器"
pkill -f "cloudflared tunnel" 2>/dev/null && echo "✅ 已停止隧道" || echo "• 沒有執行中的隧道"
echo "完成。"
