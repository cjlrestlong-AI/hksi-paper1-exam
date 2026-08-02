# HKSI 卷一 學習打卡 — 雲端同步部署說明

本目錄是一個「前端 + 輕量同步伺服器」完整套件，可讓你的答題 / 打卡 / 錯題 / 收藏進度
**統一儲存在一台伺服器上，跨手機、微信、瀏覽器都不流失**。

## 運作方式
- 前端（`index.html` / `app.js` / `data/`）負責顯示與作答。
- `server.js` 是一個極小的 Node 伺服器，同時：
  1. 提供靜態前端頁面；
  2. 提供同步 API：`GET/POST /api/progress?uid=同步碼`。
  3. **已開啟 CORS**（`Access-Control-Allow-Origin: *` + 支援 OPTIONS 預檢），因此即使 App 與伺服器「不同網域」（例如 App 跑在 CloudStudio 靜態空間、伺服器在你自己主機），瀏覽器也不會擋跨域請求。
- 進度以「同步碼」區分，存於伺服器 `./.data/<同步碼>.json`。
- 前端每次存檔會自動（防抖 1.2 秒）上傳；進入首頁會自動下拉合併。
- 前端會先偵測 `/api/health`：若同網域有同步伺服器才啟用雲端同步；
  若只是純靜態部署（如 CloudStudio 靜態空間），會自動隱藏同步 UI，不會彈出無效設定框。

## 最快速：Mac 一鍵啟動（推薦）
本機是 macOS 的話，直接用隨附腳本，不用手動敲指令：
1. 在 Finder 進入 `deploy/` 目錄，**雙擊 `start-mac.command`**（或終端執行 `bash start-mac.command`）。
2. 腳本自動：啟動 `server.js` → 安裝/呼叫 `cloudflared` → 建立公開 HTTPS 網址（形如 `https://xxxx.trycloudflare.com`）。
3. 終端出現該網址後**複製它**。
4. 在你常用的 App（建議繼續用現有 CloudStudio 網址 `https://a42fbd0426774f2bb288a71eb83e72b3.gz4.agentos-app.net`，進度與介面都不用換）裡：
   `我的 › 雲端同步 › 進階：指定同步伺服器網址` → 貼上網址 → `連線此伺服器` → 設定/輸入同一組「同步碼」。
5. 手機 / 微信開同一個 CloudStudio 網址，重複第 4 步貼「同一網址 + 同一同步碼」→ 進度即統一。
- 用完按 `Ctrl+C` 關閉終端，或雙擊 `stop-mac.command` 停止。
- 進度存於 Mac 本機 `./.data/`，可備份此目錄。
- 注意：quick tunnel 網址每次重啟會變，重開 `start-mac.command` 後，記得再到各裝置 App 的「進階」欄更新一次網址。

> 也可直接用手機/微信開那個 `https://xxxx.trycloudflare.com` 當 App 用——`server.js` 同時託管前端，同網域下同步自動啟用、連「進階」欄都不用填。但這是全新進度，舊的 CloudStudio 本機進度需先手動遷移，故一般建議用上面第 4 步的方式。

## 在本機試跑（驗證用）
```bash
cd deploy
node server.js          # 預設監聽 http://localhost:3000
```
瀏覽器開 http://localhost:3000 → 首次進入會請你設定一組「同步碼」→ 之後同碼裝置自動接續。

## 讓「手機 / 微信」也能用（公開 HTTPS 是關鍵）
微信網頁環境只允許 **HTTPS** 資源，且不與其他 App 共用 localStorage，
所以必須把 `server.js` 跑在一台**對外可達的 HTTPS 主機**上：

### 方案 A：自有主機 / 公司內部伺服器（最隱私、推薦）
1. 把整個 `deploy/` 目錄上傳到主機（VPS / NAS / 內網伺服器）。
2. 用反向代理（Nginx / Caddy）指向 `server.js`，並掛上 SSL 憑證（HTTPS）。
3. 手機 / 微信開啟該 HTTPS 網址即可；所有裝置輸入「相同同步碼」即統一進度。

### 方案 B：家用電腦零成本對外（Cloudflare Tunnel，免憑證給 HTTPS）
```bash
# 在主機上先跑 server.js，再開隧道（需安裝 cloudflared，免帳號可用 quick tunnel）
cloudflared tunnel --url http://localhost:3000
# 終端會給你一個 https://xxxx.trycloudflare.com 公開網址，手機/微信直接開即可
```
> 注意：quick tunnel 網址每次重啟會變；要固定網址需登入 Cloudflare 並建命名隧道。

## 同步碼使用要點
- 在任一部裝置「建立同步碼」後，把這組碼記下。
- 其他裝置進入「我的 › 雲端同步 › 我已有同步碼」輸入同一碼，即自動還原並接續。
- 更換手機 / 清快取也不怕：只要記得同步碼，進度都在伺服器上。

## 資料與隱私
- 伺服器僅儲存你的作答狀態（哪題答對/錯、打卡、錯題、收藏），不含任何個人身份資料。
- 檔案位於伺服器 `./.data/`，可定期備份該目錄。
- 若停用同步，進度仍存於各裝置本機 localStorage。

## API 速查（除錯用）
- `GET  /api/health`                  → `{"ok":true,...}` 代表伺服器存活
- `GET  /api/progress?uid=CODE`       → 取回該碼進度
- `POST /api/progress`  body `{"uid":"CODE","data":{...}}` → 寫入進度
