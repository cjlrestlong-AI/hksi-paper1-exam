#!/bin/bash
# HKSI 卷一 雲端同步 — Mac 一鍵啟動
# 雙擊本檔（或終端執行 bash start-mac.command）即可：
#   1) 啟動同步伺服器 server.js
#   2) 透過 Cloudflare Tunnel 產生一個公開 HTTPS 網址
#   3) 把該網址貼到 App 的「我的 › 雲端同步 › 進階」欄位即可跨裝置同步
# 關閉：在終端按 Ctrl+C，或雙擊 stop-mac.command

# 關閉 Homebrew 自動更新（首次特別慢、且雙擊時看不到進度，容易誤判卡死）
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

cd "$(dirname "$0")" || exit 1

PORT=3000

# ---- 若 port 已被舊伺服器佔用，先釋放（重開不衝突）----
if command -v lsof >/dev/null 2>&1; then
  OLD=$(lsof -ti tcp:$PORT 2>/dev/null)
  if [ -n "$OLD" ]; then
    echo "▶ 釋放已被佔用的 port $PORT (舊 PID=$OLD)…"
    kill $OLD 2>/dev/null
    sleep 0.6
  fi
fi

# ---- 找 node ----
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$HOME/.workbuddy/binaries/node/versions/22.22.2/bin/node"
fi
if [ ! -x "$NODE_BIN" ]; then
  echo "❌ 找不到 node，請先安裝 Node.js (https://nodejs.org)"
  exit 1
fi
echo "▶ 使用 node: $NODE_BIN"

# ---- 啟動同步伺服器 ----
echo "▶ 啟動同步伺服器 (port $PORT)…"
"$NODE_BIN" server.js > server.log 2>&1 &
SERVER_PID=$!

# 等待就緒
READY=0
for i in $(seq 1 20); do
  if curl -s "http://localhost:$PORT/api/health" >/dev/null 2>&1; then READY=1; break; fi
  sleep 0.5
done
if [ "$READY" -ne 1 ]; then
  echo "❌ 同步伺服器啟動失敗，請查看 server.log"
  kill "$SERVER_PID" 2>/dev/null
  exit 1
fi
echo "✅ 同步伺服器就緒：http://localhost:$PORT"
echo "   （本機進度記錄在 ./.data/ 目錄）"

# ---- 離開時清理 ----
cleanup() {
  echo ""
  echo "▶ 正在停止同步伺服器…"
  kill "$SERVER_PID" 2>/dev/null
  pkill -f "cloudflared tunnel" 2>/dev/null
  echo "✅ 已停止。"
}
trap cleanup EXIT INT TERM

# ---- 取得 cloudflared（直接下載二進制；含 GitHub 鏡像代理，繞開網路封鎖）----
download_cf() {
  local url="$1"
  echo "   ↳ 嘗試 $url"
  curl -L --http1.1 --retry 2 --retry-delay 2 -o cloudflared "$url" 2>/dev/null
  if [ -s cloudflared ] && file cloudflared 2>/dev/null | grep -q "Mach-O"; then
    chmod +x cloudflared
    return 0
  fi
  rm -f cloudflared
  return 1
}

if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH=$(uname -m)
  if [ "$ARCH" = "arm64" ]; then BASE="cloudflared-darwin-arm64"; else BASE="cloudflared-darwin-amd64"; fi
  # 候選來源：原始 GitHub → 數個常見 GitHub 鏡像代理（繞牆常用）
  URLS=(
    "https://github.com/cloudflare/cloudflared/releases/latest/download/$BASE"
    "https://ghproxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/$BASE"
    "https://mirror.ghproxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/$BASE"
    "https://ghproxy.net/https://github.com/cloudflare/cloudflared/releases/latest/download/$BASE"
  )
  echo "⚠️  未偵測到 cloudflared，直接下載二進制（已加入 GitHub 鏡像代理，繞開網路封鎖）…"
  OK=0
  for u in "${URLS[@]}"; do
    if download_cf "$u"; then OK=1; break; fi
  done
  if [ "$OK" -eq 1 ]; then
    echo "✅ cloudflared 下載完成（./cloudflared）"
  else
    echo "❌ 所有來源都下載失敗。備選方案："
    echo "   1) 手機開熱點給 Mac 上網，再雙擊本腳本；"
    echo "   2) 用手機(行動網路)下載 cloudflared-darwin-arm64 後 AirDrop 到 Mac，"
    echo "      改名 cloudflared 放進 deploy/ 資料夾，再雙擊本腳本；"
    echo "   3) 或改用「Supabase 零下載」方案：由你的手機/瀏覽器直接連 Supabase，"
    echo "      完全不需在本機裝任何東西，在這種封鎖網路下反而最穩。"
    exit 1
  fi
fi

# ---- 建立公開 HTTPS 隧道 ----
echo ""
echo "▶ 建立公開 HTTPS 隧道 (cloudflared quick tunnel)…"
echo "   終端下方會出現一行：https://xxxx.trycloudflare.com"
echo "   👉 複製這個網址，貼到 App「我的 › 雲端同步 › 進階：指定同步伺服器網址」"
echo "   👉 多部裝置都貼同一個網址、輸入同一組「同步碼」，進度即統一。"
echo "   （保持本視窗開著；按 Ctrl+C 停止）"
echo ""
if [ -x "./cloudflared" ]; then
  ./cloudflared tunnel --url "http://localhost:$PORT"
else
  cloudflared tunnel --url "http://localhost:$PORT"
fi
