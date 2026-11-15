# Navigation follow-up — 2026-11-15

本輪在獨立 Super Chart repository 完成互動盤點項目 7、8、9、10、11、12、13、15。這份文件只記本輪實作、觀察與限制；不新增測試、assertion、fixture、snapshot 或 pipeline，不把原有保護另算改善。

## 已實作項目

| 項目 | 實作 | 邊界 |
| --- | --- | --- |
| 7 水平觸控板 | 一般 wheel 以主軸區分：水平為 pan、垂直為 zoom；同 burst 約160ms鎖定主軸，Shift 明確 pan、Ctrl 明確 zoom。每個 frame 合併到一個 bounded target，反轉從當下可見位置開始。 | line/page delta 分別轉 CSS pixels；不把斜向輸入同時當作兩種動作。既有 editable-control 排除保留。 |
| 8 時間軸操作 | 最下方 time axis 支援水平拖動縮放，雙擊回到 host 的 opening count 並 follow latest。價格軸及 pane separator 的原功能保留。 | pane/time-axis input 與 chart 共用 frame scheduler；最後 pointer-up 座標會套用，繪圖仍先取得自己的事件 ownership。 |
| 9 有限未來空白 | `ViewportLimits.rightPaddingBars` 的 core 預設為0；Web整合採12。只延伸 viewport，最左界仍至少留一根真實 candle，sample 上界 clamp 到真資料尾端。 | 不補 OHLC、timestamp 或指標資料。空白區 inspection 回 null；既有 drawing projection 可以外推時間位置，但不是未來價格。 |
| 10 導覽歷史 | `beginNavigation/endNavigation` 將完整 drag、wheel ease 或 time-axis gesture 記為一筆；一般 API pan/zoom/seek/follow 各一筆。提供 undo/redo，快捷鍵 Alt+Left/Right。 | 預設最多32筆，可設0..100；reset/truncate清空，prepend平移已存索引；不與 drawing undo/redo 混用。 |
| 11 高頻 pointer 成本 | 每個 input layer 每frame重用一次 DOMRect；scroll/resize會使其失效。支援 `getCoalescedEvents`，僅最後 physical sample做viewport工作。pane drag 也延到共用frame套用。 | 不是把全chart所有事件處理器都宣稱零layout讀取；drawing handler有獨立ownership。保留 pointer-up endpoint。 |
| 12 絕對時間慣性 | coast以開始時間計算 displacement/decay；不再把長frame截成50ms而拖長實際慣性時間。 | 最長1400ms、到bounds停止；reduced motion、blur、visibility和新互動仍會終止慣性。 |
| 13 響應式 candle 密度 | 新 `viewportLimitsForWidth` 依CSS plot width與最小／最大 candle spacing產生limits；root已接resize，保留host min/max硬界與padding。 | 只改viewport限制、不改資料；不為resize寫navigation history。host可覆寫spacing；不以降低DPR換取密度。 |
| 15 Touch inspection | 一指長按450ms進入inspection，移動超過8px取消hold；長按後可移動crosshair，放手仍留顯示。二指接手立即轉pinch。 | 新pointer、wheel、Escape、blur或外部取消會解除；長按本身不產生一筆無用navigation history。 |

## 整合 API

- `ViewportLimits`: `minBars?`, `maxBars?`, `rightPaddingBars?`；padding為非負safe integer，預設0。
- `viewportLimitsForWidth(plotWidth, options)`: options另有 `minCandleSpacing?`（預設1.5 CSS px）、`maxCandleSpacing?`（預設40 CSS px）。
- `RealtimeView`: `beginNavigation()`, `endNavigation()`, `undoNavigation()`, `redoNavigation()`, `getNavigationHistory()`, `clearNavigationHistory()`, `resetViewport()`。constructor另可設 `navigationHistory`。
- `attachPaneInteraction`: 第6參數可傳view，第7參數可傳與chart共用的 `request/cancel` frame scheduler。
- `followLatest()` 保留目前count；`resetViewport()` 使用constructor opening count並套用目前density limits。

## 實際執行的觀察

以下為inline、有限的本機假資料觀察，沒有新增測試檔或assertion：

1. 10根真實bar、count6、padding3，初始viewport為7..12；snapshot只取3根真bar，length仍10，最後timestamp仍是真實資料尾端。
2. 同一navigation transaction內做40次小幅pan後，undo一次完整恢復7..12，接著canUndo為false；redo恢復pan後位置。
3. history limit設3，連續導覽後undo回傳 `true,true,true,false`。
4. prepend一根資料時，pinned viewport由2.5..7.5平移到3.5..8.5；truncate到5根後history清空，sample只到新的真實尾端。
5. density helper在180／800／1600 CSS px下得到min/max bars為20/121、21/534、41/1067；host硬界是20..1200。
6. Engine frame與shared realtime frame的未來空白inspection都回null。以最後真bar之後兩個既有間隔的timestamp和price110建立drawing座標，project→unproject回到同一timestamp與110。
7. 只有一根真bar時，viewport0..3仍只保留一根bar；真bar投影在左側，而不是錯誤置中，右側空白inspection為null。

Root在比較頁的實際瀏覽器操作另觀察到：time-axis drag將range 49852..50011縮為49885.508..49977.491；navigation back完整恢復初始range；forward後雙擊time axis恢復initial count。其他touch/trackpad情境的裝置實測應在總結中與這些已觀察項目分開報告。

## 驗證與 review

- 既有TypeScript 4.9.5 compiler以 `chart.ts` 單入口、現有tsconfig檢查56個reachable runtime files：0 diagnostics、exit0。
- 這些修改的 `git diff --check` 通過。
- 既有 `e2e/tests/motion-layers.spec.ts` 使用舊KLineCharts Pro的 `getChart/createOverlay` harness，不能當成owned engine新API已驗證的證據；沒有為了通過而新增或改測試。
- Runtime已交另一agent獨立review；最終整合及review結果由root記錄。沒有宣稱新的跨裝置手勢全部實測通過。

## 已知限制

- 只有一根raw bar時，沒有相鄰時間間距可推導任意未來timestamp。既有Engine drawing `project/unproject` 會退到該timestamp，因此**不宣稱單根資料可可靠放置任意未來時間的drawing anchor**。多根資料的時間外推不會生成未來市場價格。
- 導覽歷史只保留view狀態，沒有持久化到磁碟；資料reset/truncate後刻意不恢復舊市場／未揭露回放資料的索引。
- pointer的DOMRect快取是每個input layer每frame一次，並非整頁全域快取。長按與觸控板的手感仍需不同實際裝置的人工觀察。
- 本輪沒有新增整套效能測試。前輪fractional-snapshot量測的改善不能當成這些新互動的FPS提升。

## 修改範圍

`packages/core/src/viewport.ts`、`continuousViewport.ts`、`realtimeView.ts`、`realtimeModel.ts`；`packages/bindings/web/src/gestures.ts`、`paneInteraction.ts`。Chart、workspace與renderer的接線由其他agent整合；本子任務未push或操作Git歷史。
