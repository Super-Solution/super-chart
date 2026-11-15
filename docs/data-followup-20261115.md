# 載入、回放與小型入口 — 2026-11-15

本輪處理整合盤點第 46、48、50 項。只修改 standalone repository；沒有新增依賴、測試案例、assertions、fixtures 或 CI pipeline。這是工作目錄實作／驗證紀錄，不代表 npm 已發布。

## 已實作

### 載入邊界

ChartDataPort 新增 optional applyNormalizedData。DataLoader 已經 normalize 的 reset、cache restore、回放重建與退出，可使用這個入口；未提供的 sink 保留 applyNewData fallback。Owned Web 接線仍驗證 OHLC、價格域與 normalized 資料；RealtimeSeries 仍完整驗證 finite/order 並取得自有 bar copies，沒有把 caller array 直接當作內部儲存。

RealtimeSeries 的初始替換把驗證與 ownership copy 放進同一個迴圈；整個新陣列成功後才替換既有狀態。省掉一輪獨立掃描，保留 ownership clone，沒有身份／hash cache。一般 public setData 仍接受需要正規化的 input。

### 回放

- ChartDataPort 新增 optional truncateData(length, expectedLength, expectedLastTimestamp)。Replay source 相同且往回時，先核對當前長度與 head，再真正縮短 series，不保留隱藏的 future suffix。拒絕或 sink 不支援時維持完整 rebuild。
- Series 發出 truncate revision。View 清除失效的導覽歷史並限制 viewport；indicator registry 對非 tail revision 做 full reset，不重用未來 indicator rows。
- 跨多根向前跳、同一 replay source 且 head 相符時，利用既有 updateDataBatch 只送新增區段。單步 forward 的 append 路徑保持；不相符時仍重建。
- Native/reference MA20、EMA21 在 truncate 後重建 state，保留 seed 與精確既有運算順序。Owned Web 關閉這兩個 reference indicators 時，無須重算它們；已存在的 Heikin Ashi prefix 只縮短。不是所有 indicator 在 rewind 都達到常數成本。
- 公開 pure replay reducers 的行為未改；start/exit 的 full snapshot 和歷史更正 fallback 仍存在。

### Engine-only 入口

新增 ESM `@supersolutions/super-chart-web/engine` 與 `super-chart.engine.global.js`，後者暴露 `window.SuperChartEngine.EngineChart`，供自行提供 UI 的 host 使用。包含 owned renderer／drawings，不載入 workspace shell、toolbar styles 與其 loader/replay UI。

既有主 ESM、完整 `super-chart.global.js`、annotations/overlays entries 都保留。Package registry 以 additionalGlobals 描述新增 IIFE；build 仍按同一 registry 產生 JS 與 declarations，沒有另加 pipeline。Package-check 既有 exports loop 會涵蓋新增 ESM entry；本輪沒有增加斷言或測試案例。

## 實際驗證

- 既有 `retained/data/loader.test.ts`：**84 passed、0 failed**，Vitest 0.28.5，18.52 秒案例時間。Retained loader 是 compatibility adapter，request/cache/replay state 來自目前 core/dataLoader；不是跑舊實作冒充目前來源。
- 既有 `retained/data/replay.test.ts`：**6 passed、0 failed**。用既有 esbuild 將未改動案例編譯到 repository 外，僅把 runner import 導向 Bun test，核心仍指向目前 source；沒有新案例／expect。不冒稱 Vitest 跑了這六個。Bun 在 F 工作目錄另報 parent-directory EPERM，但案例完成且 exit 0。
- 一次性純資料觀察：50,000 bars，進入 index 40,000 後向後 100，再向前 25；sink 觀察到 2 次 reset（初載＋進入）、1 次 truncate、1 次 batch；向後 length 39,901、向前 39,926、exit 回復 50,000。未顯示的 suffix 不在 series。
- Reference 指標讀值：30 bars truncate 到 23，再 append 1，最後 MA20=10.135、EMA21=10.141167815779422，與從相同 24-bar prefix 新建的輸出一致。這是一組直接讀值，不是完整指標矩陣或新增測試。
- Ownership／拒絕觀察：呼叫者把原 bar close 改成 -999，series close 仍為 10；倒序 batch 被 RangeError 拒絕，原先 3-bar series 保留。
- TypeScript 與 root-owned Web data-port 整合的最後檢查由收尾紀錄列明；不把缺少外部 super-protocol 的完整 repository check 說成通過。

## 有界量測

資料層使用 Node、本機合成 50,000 bars、referenceIndicators: false。每輪向後 50 次、每次縮短一根；比較 prefix rebuild 與真正 truncate，三輪都先建立同一資料集。不含 Canvas、DOM、indicator registry 或瀏覽器 rAF。

| 路徑 | 三輪耗時 ms | 中位數 ms |
| --- | --- | ---: |
| slice prefix ＋ applyNewData | 154.105、115.217、119.095 | 119.095 |
| guarded truncateData | 0.105、0.029、0.012 | 0.029 |

極小時間受量測噪音影響；只據此確認省去 prefix 拷貝與重驗成本，不換算成 FPS、使用者體感或完整 replay 倍數。

同一工作目錄時點、同一 cached esbuild 0.17.18、ES2022/browser/IIFE/minify、未壓縮 JS 的記憶體 build：

| 入口 | bytes |
| --- | ---: |
| 完整 workspace global | 231,582 |
| Engine-only global | 142,913 |
| 差額 | 88,669（約 38.3%） |

這是量測時點的兩入口對照，其他並行功能完成後大小可能改變。以 root tsconfig source aliases 解析目前 core；未安裝依賴、上傳 package、執行網路冷載入，也不是 npm tarball/gzip 數字。標準完整 build/package check 仍須正常 workspace dependencies 與 declaration 工具。

## 保留的取捨

Public ownership copies、原始 normalize fallback、native reference-state 重建、custom／歷史更正的 indicator full reset 都保留。快速路徑不改 OHLC 或外部 feed protocol。沒有引入 worker、WASM 或跨 revision 的通用快取框架。
