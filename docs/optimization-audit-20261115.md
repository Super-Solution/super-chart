# 自研圖表優化盤點 — 2026-11-15

本文件整合 [互動](interaction-audit-20261115.md)、[繪製與計算](render-audit-20261115.md)、[工作區 UI](workspace-audit-20261115.md) 三份紀錄，另補五項直接核對原始碼的候選。範圍僅為此 standalone repository 的自研核心與 Web binding；不代表已發布、已部署或已修改 SupWallet monorepo。

**共 50 個不重複大項，每項恰有 A、B 兩個細節，共 100 個細節。** 本輪接續處理剩餘 23 項後，為 **49 項已有程式實作，1 項（Worker／OffscreenCanvas）已評估而不導入**。這不是「50 項都有量測加速」或「100 個已修復缺陷」；實作與未採方案的理由分列如下。

本輪詳細證據見 [navigation](navigation-followup-20261115.md)、[render](render-followup-20261115.md)、[data](data-followup-20261115.md) 與 [整合紀錄](completion-20261115.md)。

| 範圍 | 大項 | 已實作 | 部分完成 | 評估不導入 | 細節 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 互動與 viewport，1–15 | 15 | 15 | 0 | 0 | 30 |
| 繪製與計算，16–30 | 15 | 14 | 0 | 1 | 30 |
| 工作區 UI，31–45 | 15 | 15 | 0 | 0 | 30 |
| 跨層資源／載入，46–50 | 5 | 5 | 0 | 0 | 10 |
| 合計 | 50 | 49 | 0 | 1 | 100 |

「已實作」表示本輪工作目錄已有對應程式變更，不等同已完成所有裝置驗收。「部分完成」表示已有改善但剩餘政策尚未實作。「待辦」表示目前來源可確認的成本或功能缺口；需按實際使用情境判斷優先順序，並非已證明每項都值得投入或都是 bug。

## 互動與 viewport

| # | 大項與狀態 | A：具體細節 | B：具體細節 | 來源 |
| --- | --- | --- | --- | --- |
| 1 | 分數位移重用取樣 — 已實作 | floor/ceil 取樣邊界不變時，保留已凍結的 bars 與 indicator arrays，減少同一可見區段的重複拷貝。 | series version、candle mode 或整數取樣範圍變更仍重新取樣，避免重用過期行情。 | [realtimeView.ts](../packages/core/src/realtimeView.ts)，`_read` |
| 2 | 一致的縮放範圍 — 已實作 | `ViewportLimits` 接到離散／連續 viewport、程式導覽、follow 與限制更新；Web 預設 20–1200 根，可由 host 覆寫。 | core/native 預設仍是 12 根至已載入歷史；短歷史可少於下限，限制最新視窗時保留最新右緣。 | [viewport.ts](../packages/core/src/viewport.ts)、[continuousViewport.ts](../packages/core/src/continuousViewport.ts)、[realtimeView.ts](../packages/core/src/realtimeView.ts)、[chart.ts](../packages/bindings/web/src/chart.ts) |
| 3 | 滾輪縮放與反向手感 — 已實作 | 輸入更新有界 target，再以時間相關 easing 對 candle spacing 做乘法插值，減少每個 wheel event 的跳動。 | target 在累加前限制；方向反轉從可見 viewport 開始，避免邊界積欠輸入；reduced motion 下一幀直接到位。 | [gestures.ts](../packages/bindings/web/src/gestures.ts)，wheel easing |
| 4 | 放手速度與慣性 — 已實作 | 速度估計採 elapsed-time 平滑，方向切換與停頓會去除陳舊速度。 | Web 預設啟用可設定的慣性，保留指數減速、時間上限與邊界停止；reduced motion 不滑行。 | [gestures.ts](../packages/bindings/web/src/gestures.ts)、[chart.ts](../packages/bindings/web/src/chart.ts)，inertia options |
| 5 | 拖動末段與中斷 — 已實作 | pointer-up 座標不同於最後 move 時，納入最後一段拖動，避免漏掉僅在 release 送達的位置。 | 新 pointer／keyboard 操作會在目前可見 viewport 中止尚未完成的 wheel easing，不跳到尚未顯示的 target。 | [gestures.ts](../packages/bindings/web/src/gestures.ts)，release/cancel paths |
| 6 | 最小必要圖表失效更新 — 已實作 | 即使取樣 arrays 重用，viewport identity 改變仍會重建 geometry，保留分數位移。 | 重複 cursor X 不再單獨排程游標更新；data/view 通知仍會更新游標，行情不會因滑鼠未移動而凍結。 | [chart.ts](../packages/bindings/web/src/chart.ts)，view notification/cursor invalidation |
| 7 | 水平觸控板導覽 — 已實作 | 主軸判斷與短序列軸鎖定，deltaX 平移、垂直輸入縮放。 | 共用排程、中斷、邊界及 reduced-motion 規則。 | [gestures.ts](../packages/bindings/web/src/gestures.ts)，wheel handler |
| 8 | 獨立時間軸縮放 — 已實作 | 獨立 time-axis hit area；拖動以固定錨點改變尺度。 | 雙擊恢復初始根數並跟隨最新；與 plot/drawing/price axis 分開處理。 | [paneInteraction.ts](../packages/bindings/web/src/paneInteraction.ts) |
| 9 | 有界未來留白 — 已實作 | core 預設 0，Web 預設 12 個空槽，可由 rightPaddingBars 設定。 | 取樣只保留真實 bars；空白 inspection 回 null，不合成未來價格。 | [continuousViewport.ts](../packages/core/src/continuousViewport.ts)，`clampContinuousViewport` |
| 10 | 導覽前進／返回 — 已實作 | 有界 viewport history，預設 32、最多 100 筆；拖動／wheel transaction 只存一筆。 | 工具列與 Alt+Left/Right 導覽；prepend 平移紀錄，reset/truncate 清除。 | [realtimeView.ts](../packages/core/src/realtimeView.ts)，navigation methods |
| 11 | 高頻 pointer 的事件成本 — 已實作 | 同幀合併 pointer move、取 coalesced event 最後樣本，bounds 同幀重用。 | release 最終座標、pinch 接手與 pointer capture 清理保留；軸操作共用 chart scheduler。 | [gestures.ts](../packages/bindings/web/src/gestures.ts)，`movePointer` |
| 12 | 長幀後的慣性時間 — 已實作 | 指數衰減使用實際 elapsed-time 的積分位移，不再用 50ms 封頂延長滑行。 | 背景隱藏會取消；新輸入在可見位置接手。 | [gestures.ts](../packages/bindings/web/src/gestures.ts)，coast advancement |
| 13 | 依可用寬度調整密度 — 已實作 | 實際 plotWidth 配合 min/max candle spacing 推導可見根數上下限，Web 20–1200 仍為外界限。 | resize 只把現有視窗限制在新範圍，保留 pinned/follow 意圖；不新增導覽紀錄。 | [chart.ts](../packages/bindings/web/src/chart.ts)，Web view limits；[realtimeView.ts](../packages/core/src/realtimeView.ts) |
| 14 | Pane 拖動避免重驗全歷史 — 已實作 | `setLayout` 只在有效 price-scale mode 改變時重驗 stored bars；pane weights、axis range、reversal 保留 layout/range 驗證，避免每次拖動掃全量 OHLC。 | 私有 series 仍從 validated ingestion 寫入；進入 log/percentage 仍先做價格域檢查，public reads 回傳拷貝，configuration restore 先驗證再變更。 | [chart.ts](../packages/bindings/web/src/chart.ts)，`setLayout`、ingestion、`restoreConfiguration` |
| 15 | 明確的 touch inspection — 已實作 | 450ms 長按進入 inspection，8px 移動取消候選；放手後可保留游標。 | 二指 pinch、新 wheel、Escape、blur 接手清除；實體觸控裝置仍未驗收。 | [gestures.ts](../packages/bindings/web/src/gestures.ts)，touch pointer handling |

## 繪製與計算

| # | 大項與狀態 | A：具體細節 | B：具體細節 | 來源 |
| --- | --- | --- | --- | --- |
| 16 | 可見 pane geometry — 已實作 | 對 normalized、嚴格排序的 snapshot，一幀只建立一次 timestamp index，避免每個 pane 重做通用 category discovery。 | 直接產生最終 fractional X／price-scale Y，副圖不再產生隨即丟棄的 OHLC rectangles；不符條件的外部 snapshot 保留 generic path。 | [frame.ts](../packages/core/src/model/frame.ts)，aligned path |
| 17 | 放大後 candle 寬度 — 已實作 | 移除 half-width 6 px 上限，body 寬度使用 slot 的 68%，保留既有最小值。 | 主 painter 與 extended series 共用 geometry；line/area 且無 histogram 時不再掃 body width。這不改價格或根數。 | [geometry.ts](../packages/bindings/web/src/geometry.ts)、[canvasRenderer.ts](../packages/bindings/web/src/canvasRenderer.ts)、[seriesRenderer.ts](../packages/bindings/web/src/seriesRenderer.ts) |
| 18 | 游標 indicator lookup — 已實作 | 有序 point indexes 改 binary search，避免每次 cursor paint 線性 `find` 全部可見點。 | 保留最終 equality check；warmup/null gap 不取鄰近數值冒充目前讀值。 | [canvasRenderer.ts](../packages/bindings/web/src/canvasRenderer.ts)，cursor point lookup |
| 19 | 自動顯示精度 — 已實作 | 每個 frame 從 snapshot 推導一次 precision，供 panes／cursor 共用，避免 mousemove 重掃 OHLC。 | 明確指定的 precision 優先；手動 render frame 未提供新 optional field 時保留 fallback，model 值不因此四捨五入。 | [frame.ts](../packages/core/src/model/frame.ts)、[canvasRenderer.ts](../packages/bindings/web/src/canvasRenderer.ts) |
| 20 | Extended series 投影配置 — 已實作 | hollow/outline 重用 bodyTop/bodyBottom，避免 wick/body pass 重算 open/close；保留 doji 與 reversed scale 的位置。 | columns 先核對 timestamp 才按 slot 直取，否則 binary fallback；high-low 直接讀 candle，少建兩個中間 arrays。 | [seriesRenderer.ts](../packages/bindings/web/src/seriesRenderer.ts) |
| 21 | 密集歷史繪製 — 已實作 | 明示 candleDensity: pixel-envelope 才按 logical pixel 聚合 OHLC/high-low extrema；預設 raw。 | 只改 paint 幾何；public raw、frame、精確 inspection 與計算不變。 | [canvasRenderer.ts](../packages/bindings/web/src/canvasRenderer.ts)，candle paint loop |
| 22 | Line／area path 重用 — 已實作 | frame-local 路徑用於 fill/stroke，避免重複 close Y 投影。 | 新 frame／scale 與樣式選項使快取失效；不保留整個歷史的永久 path cache。 | [canvasRenderer.ts](../packages/bindings/web/src/canvasRenderer.ts)，`closePath` |
| 23 | Volume-weighted paint — 已實作 | 直接讀 bar volume 與 extrema，移除中間 Bar[]/intensity array。 | 保持每根精確 alpha，不量化強度。 | [seriesRenderer.ts](../packages/bindings/web/src/seriesRenderer.ts)，volume-bars |
| 24 | Optional indicator 增量運算 — 已實作 | 已證明語義一致的 SC SMA/RSI/MACD 與有界窗口 ICHIMOKU/Donchian 接尾端計算。 | 其他 kernels 保留原公式；correction/prepend/truncate 重建，保留 seeds/warmup，不宣稱所有可選指標都增量化。 | [indicatorPack.ts](../packages/core/src/model/indicatorPack.ts)、[classicIndicators.ts](../packages/core/src/model/classicIndicators.ts) |
| 25 | 相同指標實例的計算共用 — 已實作 | 相同 owned kernel／參數共享本批結果，pane/instance metadata 分別保留。 | 自訂公式不依名稱猜測可共用；移除 leader、參數分叉與資料變更已核對。 | [indicators.ts](../packages/core/src/model/indicators.ts)，`EngineIndicators.compute` |
| 26 | 多指標輸入欄位配置 — 已實作 | 一次計算作用域中共用 OHLC 欄位陣列，供 optional/classic 計算使用。 | 不以 mutable bars identity 做跨次永久快取，tick 後重算作用域。 | [indicatorPack.ts](../packages/core/src/model/indicatorPack.ts)、[classicIndicators.ts](../packages/core/src/model/classicIndicators.ts)，field/price helpers |
| 27 | Cursor inspection fan-out — 已實作 | 新增輕量 inspectBar 給 painter，避免每 pane 複製完整 indicator rows。 | 公開 inspect 仍產生完整獨立資料；warmup/gaps 與空白槽不借鄰值。 | [frame.ts](../packages/core/src/model/frame.ts)，inspect；[chart.ts](../packages/bindings/web/src/chart.ts)，cursor paint |
| 28 | Axis label 格式化 — 已實作 | 512-entry 有界快取按時間、時區、週期及格式重用確定性的時間標籤。 | 游標使用最新值；自訂價格 formatter 仍呼叫，不快取可能有狀態的 callback。 | [canvasRenderer.ts](../packages/bindings/web/src/canvasRenderer.ts)，axis/crosshair formatting |
| 29 | 曲線與離屏繪製 — 已實作 | 二次／三次 Bezier 採樣依投影曲率有界調整；圓弧原本已隨螢幕大小調整，不另算新增。 | 保留穿越畫面的 ray/channel，不以 anchors 在畫面外直接刪幾何。 | [drawingGeometry.ts](../packages/core/src/model/drawingGeometry.ts)、[chart.ts](../packages/bindings/web/src/chart.ts)，drawing phase |
| 30 | Worker／OffscreenCanvas — 已評估，不導入 | 現有量測指出主要收益來自減少重複計算與配置；本輪優先改善同一幀排程與增量運算。 | 目前沒有完整證據支持跨執行緒搬移的淨收益，故不加 transfer/font/image/hit-testing 框架，也不宣稱已離線渲染。 | [chart.ts](../packages/bindings/web/src/chart.ts)，`renderTick`/`flush` |

## 工作區 UI

| # | 大項與狀態 | A：具體細節 | B：具體細節 | 來源 |
| --- | --- | --- | --- | --- |
| 31 | 市場優先的配置 — 已實作 | Symbol／interval 留在第一列，保持立即可用。 | 進階 chart controls 移出永遠展開的 toolbar，增加圖表可用高度。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，toolbar/presentation；[workspaceStyle.ts](../packages/bindings/web/src/workspaceStyle.ts)，marketbar |
| 32 | 圖表設定面板 — 已實作 | Chart type、price mode、scale 集中在 overlay panel，不持續占據 chart height。 | Escape／outside click 關閉，設定選單互斥；Escape 還原 summary focus。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，`menu`/document pointer handler |
| 33 | 指標管理 — 已實作 | 指標放在獨立面板，summary 顯示 active count。 | 明確顯示空清單；Remove 不重複整段指標描述。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，`refreshIndicators` |
| 34 | 指標編輯 — 已實作 | Enter 套用參數仍通過原有 chart validation。 | Pane group 只在 separate pane 可編輯；套用 price pane 清除無作用的 group。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，params/pane/apply handlers |
| 35 | 編輯連續性 — 已實作 | 指標自己的更新後，保留原先展開的 editor。 | Apply/show/hide 保留 editor focus；刪除後回 Indicators summary。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，`refreshIndicators` focus restoration |
| 36 | Drawing tools 導覽 — 已實作 | 所有工具依九個 native optgroups 組織，沒有縮減可用工具。 | 工具列水平捲動，避免多列堆疊遮掉 chart。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，toolGroups；[workspaceStyle.ts](../packages/bindings/web/src/workspaceStyle.ts)，drawingbar |
| 37 | Drawing 狀態回饋 — 已實作 | Lock/Unlock 提供 pressed state，未選取時不可操作。 | Locked drawing 的 disabled Delete 提示先解鎖。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，`updateDrawingControls` |
| 38 | Replay transport — 已實作 | 只在 replay active 時顯示進階播放控制。 | Previous/next 在邊界 disabled；少於三根 bars 不能開始 replay。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，replayControls/`updateReplay` |
| 39 | Replay 定位與焦點 — 已實作 | 顯示目前 index、總根數與 UTC timestamp。 | 當焦點所在的 replay 控制被隱藏時移到可用控制；一般 tick 不搶焦點。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，`updateReplay` entering/leaving |
| 40 | Symbol search 易讀性 — 已實作 | 搜尋有全寬 input、heading 與 close control。 | Ticker 與 name/exchange 分開，提供 busy／empty／retry feedback；既有取消與 generation 保護保留。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，search/`queueSearch`；[workspaceStyle.ts](../packages/bindings/web/src/workspaceStyle.ts) |
| 41 | 載入狀態可見性 — 已實作 | Loading、empty、failed 在 chart stage 顯示，不留無說明空白。 | Chart 暫時 inert 時，status announcement 與既有 Retry 仍可操作。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，stageStatus/`updateStatus` |
| 42 | Live 更新的 DOM 成本 — 已實作 | 以 presentation-state signature 跳過沒有變動的 load-state UI。 | `setText` 避免對相同 status/countdown/replay text 重寫 DOM。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，reportedStatusUI/`setText` |
| 43 | 匯出／全螢幕回饋 — 已實作 | PNG export 進行時禁止重複點擊，顯示進度，成功或失敗後還原控制。 | Fullscreen 同步 action label 與 pressed state。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，`download`/fullscreen handler |
| 44 | Host 自訂介面 — 已實作 | 可加 root class、繼承／指定 scoped CSS variables，不引入 UI framework。 | Compact/comfortable 與 coarse-pointer 尺寸獨立於 Canvas render options。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，`WorkspaceAppearanceOptions`；[workspaceStyle.ts](../packages/bindings/web/src/workspaceStyle.ts) |
| 45 | 一致的控制回饋 — 已實作 | Button/select/settings summary 有 focus-visible 與 pressed treatments。 | Disabled 不再呈現可點擊 hover，forced-colours 保留 disabled/pressed 區分。 | [workspaceStyle.ts](../packages/bindings/web/src/workspaceStyle.ts)，control/focus/forced-colours rules |

## 新核對的跨層資源與載入

這五項由原始碼核對補入，本輪已處理。選用的記憶體／畫質政策仍由 host 決定；不能把來源層減少掃描直接當作所有情境的可感知改善。

| # | 大項與狀態 | A：具體細節 | B：具體細節 | 來源 |
| --- | --- | --- | --- | --- |
| 46 | 初始資料的跨層掃描與 ownership 拷貝 — 已實作 | loader 的 normalized sink 避免 chart 再 normalize；series 合併 validation 與 ownership copy 為一次 pass。 | 公開入口與 normalized sink 都保留資料／價格域驗證，整批有效才替換 owned data。 | [dataLoader.ts](../packages/core/src/dataLoader.ts)，`_show`/`_start`；[normalizeBars.ts](../packages/core/src/normalizeBars.ts)；[chart.ts](../packages/bindings/web/src/chart.ts)，`setData`；[realtimeSeries.ts](../packages/core/src/realtimeSeries.ts)，`applyNewData` |
| 47 | 跨市場 drawing document 保存量 — 已實作 | 選用 drawingCache 宿主同步 storage，確認保存後才依 symbol/UTF-16 bytes 預算釋放副本。 | 預設不寫儲存；失敗與誤用 async adapter 保留未存資料並明確報錯，不默默淘汰繪圖。 | [workspace.ts](../packages/bindings/web/src/workspace.ts)，drawingDocuments/`prepareRequest`/`restoreDrawings`/`dispose`；[drawingMedia.ts](../packages/bindings/web/src/drawingMedia.ts)，bitmap cache |
| 48 | 無 bundler 的載入粒度 — 已實作 | 新增 ./engine 與 SuperChartEngine IIFE；只需 Canvas 的 host 可省去 workspace UI。 | 原完整入口保留；本輪 minified engine-only 約省 38%，精確測點見 data followup。 | [scripts/packages.mjs](../scripts/packages.mjs)，web.global/entries；[scripts/build.mjs](../scripts/build.mjs)，ESM splitting/IIFE；[Web index.ts](../packages/bindings/web/src/index.ts) |
| 49 | 高 DPR Canvas 記憶體策略 — 已實作 | 空白 drawing layer 仍為 1×1；選用 maxPixelRatio/maxCanvasPixels 限制每層 backing store。 | 預設不降畫質；至少 1×1，實際像素乘積不超預算，畫面與 PNG 使用實際 XY 比例。 | [chart.ts](../packages/bindings/web/src/chart.ts)，`sizeDrawingCanvas`/`flush`/`snapshot` |
| 50 | 回放後退／跳轉的 prefix 重建 — 已實作 | 相同 replay source 且當前 head 相符時真正 truncate；向前多步只追加新增區段。 | 不符合條件仍走原重建；indicator reset 清除未來 rows，回放期間資料隔離保留。 | [replay.ts](../packages/core/src/replay.ts)，`replayBars`/`replayApply`；[dataLoader.ts](../packages/core/src/dataLoader.ts)，`replayStep` |

## 未納入「新增優化」的既有設計

Pointer cancel/capture loss、blur/hidden/Escape 清理、資料與 viewport 失效檢查、feed generation/cancellation、增量 built-in indicators、history LRU、分層 Canvas、dirty flags、optional package entries 與 public ownership boundaries 都已有實作。上表只在解釋改動或待辦的邊界時引用，不把保留它們另算成果。第 14 項的 `setLayout` 修正只計一次。

`getMetrics()` 與 `frames/geometryBuilds/plotPaints/drawingPaints/cursorPaints` 是既有觀察能力，不是新產品優化。現在的 `lastFrameMs`／`firstDataFrameMs` 計的是 `flush` 時段；不能拿它當包含下載、bundle parse、資料等待與所有輸入 callback 的完整首次載入時間或 input latency。Demo 的比較／量測程式也沒有算進 50 項。

## 上一輪實際驗證與量測邊界（本輪結果見整合紀錄）

- 已有 scoped TypeScript compiler check：core/Web/SuperScript **76 個檔案、0 diagnostics**。Replay focus 與 UTF-8 修正後已重跑該必要檢查。最新 `setLayout` delta 另以 chart 單入口檢查 **55 個可達 runtime 檔案、0 diagnostics**。
- 這些檢查使用本機既有 cached TypeScript 4.9.5。一般 node_modules 的 TypeScript/ESLint entrypoints 不存在；完整 repository check 受缺少 `@supersolutions/super-protocol` 及衍生 plugin 型別錯誤阻擋，不能稱全 repo typecheck/lint 通過，也沒有為此安裝依賴。
- 互動取樣的局部觀察：100,000 根假資料、1,000 根可見區、固定取樣邊界內的 2,000 次 fractional updates，中位數從 459.4220 ms 到 1.2303 ms，量到的是重複 snapshot/copy 被移除。**不是整個圖表快 373 倍，也不是 FPS 結果。**
- Renderer 的 geometry／Canvas-command 對照與時間資料見 [render measurements](render-measurements-20261115.md)。這些局部結果不能推廣成完整瀏覽器、所有裝置或全部指標負載的改善。
- Source review 已修 replay entry/exit 隱藏控制造成焦點掉到 body 的問題，亦修正一次 Windows 編碼寫入錯誤；所涉審查沒有剩餘 confirmed finding。獨立 review 的範圍見各原始 audit，不能替代未執行的裝置驗收。
- 本輪沒有新增測試案例、assertions、fixtures、文案／外觀 snapshot、CI pipeline 或 UI framework；一次性量測也未包裝成新產品 gate。已完成的整合瀏覽器觀察連結於文末；未執行的裝置／情境仍不視為完成。

## 優先順序與仍有限制

本輪已完成上列互動、計算、載入與回放調整；較複雜 optional kernels 仍保留原公式。Worker 不導入是目前測點下的維護取捨，不是永遠排除，也不以框架數量當優化成果。

Workspace 的 theme tokens 只控制 DOM chrome；Canvas light theme 仍由 render options 設定，說明見 [Workspace interface](WORKSPACE-UI.md)。原生 screen reader、真實 touch device、非常矮的 embed、開啟設定面板時 host resize，仍有手動 UX 評估空間。沒有宣稱 WCAG 認證、全部裝置一致或新增交易／真實帳戶操作。

## 整合瀏覽器實測

[瀏覽器實測與人工驗收](browser-measurements-20261115.md) 保留九組原始數據、各版本三組中位數、Canvas 配置計算與方法限制。公開 API 的 pan／zoom、50k 假行情 live 更新，與人工手勢觀察分開記錄；沒有把不同 API 或工具列高度造成的差異當成等量 renderer 工作。

本輪在同一 Windows in-app Chromium 已人工觀察設定面板展開、滾輪與鍵盤縮放界線、拖放後慣性、首次趨勢線與選取點、Undo 清空並釋放 drawing backing store，以及含 committed drawing 的實際 PNG 匯出。這些結果支持對應 UI／gesture／idle-canvas 路徑可運作；不是所有 UI 控制、所有 resize/DPR 組合、真實 touch device、React Native、長時間 heap 或跨瀏覽器驗收。

實測也保留不利結果：新版相對改前 JS 增加 19,059 bytes（9.11%），live 幀間隔中位數未改善，constructReady 中位數略增。flush 耗時下降與同面積空 drawing layer 的配置縮減，只按文件中的負載及計算邊界解讀，不當成全面 FPS、冷啟動或整體記憶體改善保證。
