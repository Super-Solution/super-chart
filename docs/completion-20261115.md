# 第二輪整合收尾 — 2026-11-15

後續已針對首載與缺少依賴繼續修正；最新分段量測與建置結果見 [startup follow-up](startup-followup-20261115.md)。以下保留前一輪的實際紀錄。

範圍是剩餘 21 個待辦與 2 個部分完成項，連同上一輪尚未提交的修改一起進同一 PR。
22 項完成實作；第 30 項 Worker／OffscreenCanvas 已評估，這輪不導入。
總盤點為 49 項有實作、1 項保留具體不採理由，並非每個項目都量到加速。
沒有新增或修改 test、assertion、fixture、snapshot、pipeline，也沒有發布 npm 或變更 SupWallet。

## 最終整合與驗證

- PR 基底：main f244566b36999bab53b788bfc640baf2b7fc12d0。
- 原本工作快照 5b9b7d0 與遠端初始 c8a8e9e 是不同 root；只將本次差異重新套到最新 main，
  沒有合併不相關歷史或回退遠端 backend/example 更動。
- 唯一衝突是 drawingGeometry。保留遠端完整 builders/de Casteljau，
  只加入曲率採樣 helper 與三個呼叫點；獨立覆核無確認問題。
- 直接執行目前 core 的既有 loader **85 passed**、replay **6 passed**；
  包含上游 f156ac5 的顯示歷史資料拋錯案例，其 catch/report 保護完整保留。
- 整合後既有 TA **51**、geometry **20**、precision **12**、date **13** 全通過。
  合計 **187 個既有案例通過、0 失敗**，沒有新增案例。
- 核心／Web／SuperScript TypeScript：**80 runtime files、0 diagnostics**。
  最後移除驗證暫存陣列後已再執行相關 compiler check。
- 完整 repository typecheck/lint/package declarations 仍受既有缺少
  `@supersolutions/super-protocol` 與完整 workspace dependencies 阻擋；
  沒有假稱完整四包 build 通過，也沒有安裝或 stub 外部 package。
- 三方交叉 review 已完成；發現並修正：async storage 被誤認為同步保存、
  極小 pixel budget 產生 0 高度、先建立 load queue 才保存造成懸空等待、
  normalized optional volume/turnover 必須保留 null 語義。
  最終 source review 沒有剩餘確認問題。這是獨立代理 review，不是人類批准。

## 實際互動與資料觀察

瀏覽器假資料 50,000 bars、五個 indicators：
時間軸拖動從 49852..50011 變成 49885.5088..49977.4912；
Previous chart view 恢復原視窗，Next 可前進，時間軸雙擊回到初始視窗。
右側留白沒有合成 bars；精確讀值仍只取真實資料。
具體 navigation、render、data 觀察分別記於對應 followup 文件。

繪圖保存使用純記憶體 host storage 觀察：
20 個市場成功保存後，cache 僅 1 項／約 94 UTF-16 bytes，首個市場可從 storage 載回。
storage-full 與錯誤的 async adapter 都保留未保存文件（1 項、18 bytes、unsaved 1），
沒有把它誤標成已存或為預算直接丟棄。這不代表實際持久儲存配額已獲保證。

## 本輪瀏覽器樣本

同一機器、IAB 頂層頁、1280×720、DPR 1、50,000 根假資料、MA/EMA/BOLL/VOL/RSI。
兩次 before 接兩次 after，未隨機化，也未隔離其他程序或強制 GC。
before 是 retained 5b9b7d0；after 是整合 21c301b，在最後等價 scalar-validation
配置調整之前。後者不改圖形或資料結果，但以下仍保留實際量測來源，不冒稱新量測。

| 指標 | before 兩次 | after 兩次 |
| --- | --- | --- |
| load proxy ms | 201.5 / 211.8 | 331.0 / 238.2 |
| construct-to-ready ms | 138.5 / 145.5 | 252.4 / 171.2 |
| pan P95 rAF gap ms | 8.3 / 8.7 | 6.7 / 6.4 |
| zoom P95 rAF gap ms | 7.7 / 7.0 | 6.6 / 6.3 |
| live P95 rAF gap ms | 10.9 / 11.4 | 6.3 / 6.2 |
| pan P95 flush CPU ms | 3.5 / 4.1 | 1.5 / 1.4 |
| zoom P95 flush CPU ms | 4.0 / 4.3 | 1.2 / 1.1 |
| live P95 flush CPU ms | 7.6 / 9.7 | 0.8 / 1.0 |
| 約 4 秒 actual updates | 200 / 198 | 200 / 199 |
| Canvas pixel-byte estimate | 5,744,640 | 4,485,124 |
| heapAfterLoad bytes | 56,503,257 / 53,003,166 | 52,236,478 / 51,421,273 |
| heapEnd bytes | 90,907,505 / 70,694,434 | 73,957,608 / 69,620,606 |

Pan/zoom 各 180 frames；四個樣本 visibleThroughout 都 true，沒有 >25ms rAF gap。
CPU flush 不包含完整事件回呼／下載／parse。新版 toolbar 讓 Canvas 由 374px 高變成
438px，空白 drawing backing store 由完整一層變成 1×1；不是相同繪圖面積比較。
live 新版含 12 空槽，而 before 沒有；pan/zoom 的明示 viewport 相同。
Heap 是未隔離 GC 的讀值，不能由此宣稱沒有 leak 或持久記憶體改善。

**這些樣本支持互動／即時繪製變快，未證明完整 workspace 初載變快；
實測 load proxy 反而較高，保留這個結果。** 本輪沒有為美化數字刪除樣本。
小入口適合不需要完整 UI 的 host；完整 workspace 保留新增功能有體積與初始化成本。

## 最後一項載入配置調整

normalize sink 仍驗證 volume/turnover、OHLC、Date、log/percentage 域。
將每根驗證用的兩個暫存陣列改成同等 scalar checks，不移除拒絕條件。
從實際前後 method source 做記憶體內函式量測：
50,000 bars、40 calls/round、五輪交替順序，
中位數 **0.933715 → 0.236865 ms/call**。
這只是驗證迴圈 CPU，不能拿它抵銷上表載入差距或宣稱冷啟動變快。
獨立 review 確認 Number.isFinite 仍拒絕非數字、NaN/Infinity；optional null/undefined 保留。

## 最終入口體積

最後工作樹（21c301b＋scalar delta），同 esbuild 0.17.18／browser／ES2022／IIFE／minify、
write:false：

| 入口 | bytes |
| --- | ---: |
| 完整 Web | 233,190 |
| Engine-only | 144,078 |
| 差額 | 89,112（38.2%） |

非 gzip／npm tarball／網路下載秒數。完整入口未移除，新增入口沒有額外 pipeline。

## 不導入 Worker 的理由與保留限制

目前已量到的高成本可以用增量計算、同幀合併、有限窗口、少配置與 paint reuse 改善。
沒有對 worker 的資料搬移、字型、圖片、游標與跨執行緒同步成本取得整體淨收益證據，
因此不為完成清單加入新架構。若未來 profiler 證實剩餘長任務，再決定搬哪些純運算。

未完成實體觸控裝置、React Native renderer、長時間 heap soak 或所有高 DPR 組合驗收；
單根歷史仍不能可靠推導 future drawing timestamps。其他複雜 optional kernels 保留
完整公式，未宣稱全部增量化。所有選用畫質／繪圖保存設定的取捨見 WORKSPACE-UI.md。
