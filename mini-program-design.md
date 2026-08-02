# HKSI 卷一 · 學習打卡小程序 — 完整設計方案

> 配套交付：`study-plan.html`（互動打卡計劃表）、`prototype/index.html`（可預覽 H5 原型）、`prototype/data/questions.json`（1455 題題庫）。
> 考試：HKSI LE Paper 1《基本證券及期貨規例》｜60 題 / 90 分鐘 / 及格 70%（42/60）｜題型全單選。

---

## 1. 產品定位

- **目標用戶**：備考 HKSI LE Paper 1 的考生（已有自學基礎，處於 7 週衝刺期）。
- **核心價值**：每日打卡養成習慣 ＋ 按章刷題 ＋ 即時解析 ＋ 數據可視化 ＋ 錯題 / 收藏複習。
- **差異化**：題庫與考綱 9 章一一對應，優先級（3/4/5/9 高）可直接映射到複習時間分配；打卡與計劃表聯動，形成「計劃 → 執行 → 復盤」閉環。

---

## 2. 技術選型

| 層面 | 推薦方案 | 說明 |
|---|---|---|
| 小程序框架 | 微信小程序原生（WXML / WXSS / JS） | 生態成熟、審核順暢；若需跨端可改 Taro / uni-app |
| 後端 / 存儲 | 微信雲開發（CloudBase） | 免運維；用戶進度存雲數據庫，多端同步 |
| 題庫 | 靜態 JSON（雲存儲 / CDN） | 首屏按需加載，避免主包過大（單包 ≤ 2MB） |
| 圖表 | ec-canvas（ECharts 小程序版） | 本 H5 原型用原生 SVG / canvas，零依賴，便於直接預覽 |
| 持久化 | 雲數據庫 ＋ `wx.setStorage` 本地緩存 | 減少請求、弱網可用 |

---

## 3. 整體架構（原生小程序目錄）

```
/paper1-miniprogram
├── app.js / app.json / app.wxss        # 全局配置、tabBar、主題
├── /pages
│   ├── home/       首頁：今日打卡 + 數據總覽 + 快速開始 + 模考入口
│   ├── chapters/   章節練習列表（9 章 + 題量 + 掌握度）
│   ├── quiz/       答題頁：單選/多選 + 即時對錯 + 詳細解析 + 收藏
│   ├── result/     小結頁：本輪正確率、用時、薄弱章節建議
│   ├── wrong/      錯題本（按章篩選、重練）
│   ├── fav/        收藏夾
│   ├── stats/      學習統計（可視化）
│   └── me/         我的：設置 / 重置 / 關於 / 導入計劃
├── /components
│   ├── question-card/   題目卡片（題幹 + 選項 + 狀態）
│   ├── progress-ring/   正確率環形圖
│   └── bar-chart/       分章掌握度條形圖
├── /utils
│   ├── store.js    進度 / 打卡 本地 + 雲同步
│   ├── quiz.js     出題 / 評分 / 計時邏輯
│   └── stats.js    統計計算（正確率、連續打卡、趨勢）
├── /data
│   └── questions.json   題庫（本方案產出，1455 題）
└── /mock
    └── plan.js     7 週打卡計劃數據（與 study-plan.html 同源）
```

---

## 4. 頁面流程

```
[home 首頁]
   ├─→ [chapters 章節] → [quiz 答題] →(提交)→ [result 小結] → 返回/繼續
   ├─→ [quiz?mode=mock]          模考模式（取 mockExam 60 題，限時 90 分鐘）
   ├─→ [stats 統計]
   ├─→ [wrong 錯題本] → [quiz?from=wrong]
   ├─→ [fav 收藏夾]   → [quiz?from=fav]
   └─→ [me 我的]
```

---

## 5. 核心數據結構

### 5.1 Question（題庫單題）
```json
{
  "id": "1-001",
  "chapter": 1,
  "type": "single",                 // "single" | "multiple"
  "stem": "根據現行的香港金融監管架構，下列哪些描述是正確的？…",
  "options": [ {"key":"A","text":"只有 I、IV"}, … ],
  "answer": ["C"],                  // 選項 key 陣列（大寫）
  "explanation": "…",
  "source": "chapter1"              // chapterN / 2ce / past / officialMock
}
```

### 5.2 UserProgress（雲數據庫，按 openid 存）
```json
{
  "answered": { "1-001": {"correct": false, "ts": 1690000000}, … },
  "wrong":    ["1-001", "3-012", …],
  "fav":      ["4-020", …],
  "checkins": ["2026-07-26", "2026-07-27", …],
  "mockBest": {"score": 52, "ts": 1691000000}
}
```

### 5.3 派生統計 Stats（由 answered 計算，不 persisted）
```json
{
  "totalAnswered": 320, "totalCorrect": 271, "accuracy": 0.847,
  "byChapter": { "1": {"answered":40,"correct":35}, … },
  "streak": 12,
  "dailyTrend": [ {"date":"2026-08-01","count":30}, … ]
}
```

---

## 6. 關鍵功能實現

- **打卡**：首頁點擊「今日打卡」→ 寫入 `checkins[今日]`（去重）→ 計算最長連續天數；與 `study-plan.html` 的週計劃互補（計劃管「學什麼」，打卡管「做沒做」）。
- **刷題**：章節列表選章 → `quiz` 逐題展示 → 點選選項 → 提交 → 即時標紅正確答案、標綠用戶選擇 → 展開 `explanation` → 下一題。
- **評分**：單選比對 1 個 key；多選需 `answer[]` 與用戶選擇完全一致（順序無關）才計正確。
- **錯題 / 收藏**：答錯自動入 `wrong`；用戶可手動收藏入 `fav`；兩者可一鍵重練。
- **統計**：正確率環形圖（總）＋ 分章掌握度條形圖 ＋ 每日答題趨勢折線 ＋ 連續打卡卡片。
- **模考模式**：取 `mockExam`（官網 60 題），計時 90 分鐘，結束給分與「薄弱章節」建議，記錄 `mockBest`。

---

## 7. 題庫導入管線（本方案已產出）

`IMA 知識庫「證券考試內容」` → 9 章 PDF ＋ 2ce 練習 ＋ 歷屆試題 ＋ 官網 60 題模考
→ Python 解析（正則切題 / 選項 / 答案 / 解析） → 清洗 OCR 噪聲（職夢靠岸頁眉、亂碼 ID、殘缺題）
→ `questions.json`（**1455 題**，分 9 章 ＋ `mockExam`）。

- **章節分佈**：1:257　2:88　3:184　4:353　5:93　6:133　7:72　8:111　9:104；模考：60
- **清洗統計**：共捨棄 224 題（OCR 嚴重亂碼、選項標籤缺失 / 錯位、題號被誤識為選項）。
- **題型說明**：四套源文件均僅含單選、答案表均為單字母，故 `multiple` 類型為 0（忠於源數據）；結構仍保留多選欄位以備擴充。
- **可復現**：原始 txt 與 `qbank_parse.py` 存於 `.workbuddy/`，便於日後補錄或更換來源。

---

## 8. H5 原型 與 正式小程序 的對應

`prototype/index.html` 為**可交互演示**：手機視圖、底部 tab、localStorage 持久化、零後端、零外部依賴（圖表用原生 SVG/canvas）。數據優先 `fetch('data/questions.json')`（完整 1455 題），失敗時降級 `data/sample.js`（每章 2 題 ＋ 完整模考）。

正式小程序**以此為產品藍圖**：將 `localStorage` 替換為雲數據庫、將 `fetch` 題庫改為雲存儲按需加載、圖表換 ec-canvas，即可上線。

---

## 9. 落地步驟

1. 註冊小程序 AppID，初始化原生工程（app.json 配置 tabBar：首頁 / 練習 / 統計 / 我的）。
2. 放入 `questions.json`；若超主包 2MB，改存雲存儲並首屏拉取（或按章分包）。
3. 實作 `utils/store.js`、`utils/quiz.js`、`utils/stats.js` 與各頁面 / 組件。
4. 接雲開發數據庫做多端同步（打卡、錯題、收藏、模考最佳分）。
5. 真機調試 → 提交審核 → 發布。

---

## 10. 風險與對應（來自計劃階段）

- **OCR 噪聲**：已清洗；極少數題仍可能有殘留錯字，正式上線前建議人工抽檢高頻章（3/4/9）。
- **題量**：1455 題已全量導入，足cover考綱；建議練習時按「章節 + 錯題 + 模考」三段式。
- **題型**：卷一實為全單選；結構保留多選以支持未來擴充（如卷二/卷三）。
- **原型定位**：H5 為演示，非生產級後端；正式版數據須加密與雲備份。
