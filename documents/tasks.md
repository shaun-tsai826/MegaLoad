# Implementation Plan: Cross-Platform Video Downloader

## Overview

以 Tauri v2 + Vue 3 + Vite 架構建構跨平台桌面影音下載應用程式。實作分為八個群組，依序完成：專案骨架初始化、yt-dlp sidecar 整合（Rust 端）、Tauri Commands 實作、下載歷史持久化、Pinia Stores、Vue 3 UI 元件、Tauri v2 Capability 設定，最後完成 GitHub Actions CI/CD 自動化建構。每個群組均以前一群組的可運行程式碼為基礎累積建構。

---

## Tasks

### Group 1：專案初始化

- [x] 1. 建立 Tauri v2 + Vue 3 + Vite 專案骨架
  - [x] 1.1 初始化 Tauri v2 + Vue 3 + Vite 專案結構
    - 使用 `npm create tauri-app` 建立專案，選擇 Vue + TypeScript 模板
    - 確認 `src-tauri/Cargo.toml` 包含 tauri v2 依賴
    - 建立 `src/types/index.ts`，定義 `UrlValidationState`、`VideoMetadata`、`QualityOption`、`DownloadTask`、`DownloadStatus`、`HistoryRecord` 所有共用型別
    - 建立 `src/utils/urlValidator.ts`，實作 `validateUrl(input: string): boolean`（使用原生 URL constructor）
    - _Requirements: 1.1, 1.2_

  - [ ]* 1.2 為 `validateUrl` 撰寫 property test
    - **Property 1: URL 驗證正確性**
    - 使用 fast-check，對任意字串輸入驗證：回傳 `true` 時必為合法 http/https URL，回傳 `false` 時按鈕必停用
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [x] 1.3 安裝並設定 Pinia、Vue Router、Tailwind CSS
    - 安裝 `pinia`、`vue-router`、`tailwindcss`、`@tailwindcss/vite`
    - 設定 `vite.config.ts` 加入 Tailwind CSS plugin
    - 在 `src/main.ts` 掛載 Pinia 與 Vue Router
    - 建立 `src/views/HomeView.vue` 與 `src/views/HistoryView.vue` 空白頁面骨架
    - 設定 Vue Router，`/` → `HomeView`，`/history` → `HistoryView`
    - _Requirements: 1.1_

  - [x] 1.4 設定 Rust 端依賴與目錄結構
    - 在 `src-tauri/Cargo.toml` 加入 `serde`、`serde_json`、`uuid`、`tokio`、`regex`、`thiserror` 依賴
    - 建立 `src-tauri/src/commands/mod.rs`、`src-tauri/src/models/mod.rs`
    - 建立 `src-tauri/src/error.rs`，定義 `AppError` enum（`AuthRequired`、`YtDlpError`、`NetworkError`、`IoError`、`Unknown`）與 `from_ytdlp_stderr` 分類函式
    - 在 `src-tauri/src/main.rs` 初始化 Tauri builder（暫不掛載 commands）
    - _Requirements: 2.4, 2.5, 7.1_

  - [ ]* 1.5 為 `AppError::from_ytdlp_stderr` 撰寫 property test
    - **Property 4: yt-dlp stderr 錯誤分類一致性**
    - 使用 Rust `proptest`，對任意 stderr 字串驗證：含 `login`/`sign in`/`private`/`members only`（不區分大小寫）→ `AuthRequired`，其餘 → `NetworkError` 或 `YtDlpError`
    - **Validates: Requirements 2.4, 2.5**

- [x] 2. Checkpoint — 確認專案可正常啟動
  - 執行 `npm run tauri dev` 確認 Tauri 視窗開啟，Vue Router 正確路由，Tailwind CSS 生效
  - 確認所有 TypeScript 型別無編譯錯誤
  - 確認所有測試通過，如有問題請向使用者反映。

---

### Group 2：yt-dlp Sidecar 整合

- [x] 3. 實作 Rust 端 yt-dlp Sidecar 管理與進度解析
  - [x] 3.1 實作 `src-tauri/src/sidecar.rs` — sidecar 啟動管理
    - 實作 `build_sidecar_command(args: &[&str]) -> tauri::Result<CommandChild>` 輔助函式
    - 使用 `tauri::api::process::Command::new_sidecar("yt-dlp")` 建立 sidecar 實例
    - 在 `src-tauri/binaries/` 建立佔位空檔（後續 CI 下載），在 `tauri.conf.json` 宣告 `bundle.externalBin: ["binaries/yt-dlp"]`
    - _Requirements: 2.1, 4.1_

  - [x] 3.2 實作 `src-tauri/src/progress.rs` — stdout 進度解析
    - 定義 `ProgressInfo` struct（`percent: f64`、`speed_str: String`、`speed_bytes: u64`、`eta_str: String`、`eta_seconds: u64`）
    - 實作 `parse_progress_line(line: &str) -> Option<ProgressInfo>`，使用 regex 匹配 `downloading  45.3%  1.23MiB/s  00:23` 格式
    - 實作 `parse_speed_to_bytes(speed: &str) -> u64` 與 `parse_eta_to_seconds(eta: &str) -> u64` 輔助函式
    - _Requirements: 4.4_

  - [ ]* 3.3 為 `parse_progress_line` 撰寫 property test
    - **Property 7: 進度事件解析正確性**
    - 使用 `proptest`，對任意符合格式的字串驗證：`percent` 必在 `[0.0, 100.0]`，`speed_bytes` 非負；不符合格式的字串必回傳 `None`
    - **Validates: Requirements 4.4**

  - [x] 3.4 實作 `src-tauri/src/models/download_task.rs` 與 `src-tauri/src/models/history.rs`
    - 定義 Rust 端 `DownloadTask` struct（`id`、`url`、`quality`、`output_path`、`status`、`cancel_tx`）
    - 定義 `HistoryRecord` struct（對應 JSON schema 全欄位），衍生 `Serialize`、`Deserialize`
    - 定義 `QualityOption` enum（`Q1080p`、`Q720p`、`Q480p`、`AudioMp3`）與對應 yt-dlp `-f` 格式選擇字串方法
    - 在 `models/mod.rs` 重新匯出
    - _Requirements: 4.1, 6.1_

---

### Group 3：Tauri Commands 實作

- [ ] 4. 實作 `parse_video` 與 `select_folder` / `open_folder` Commands
  - [x] 4.1 實作 `src-tauri/src/commands/parse.rs` — `parse_video`
    - 實作 `#[tauri::command] async fn parse_video(app: AppHandle, url: String) -> Result<VideoMetadata, AppError>`
    - 呼叫 sidecar 傳入 `["--no-warnings", "-J", &url]`，讀取完整 stdout JSON
    - 解析 `title`、`thumbnail`、`formats` 欄位建構 `VideoMetadata`
    - stderr 非空時呼叫 `AppError::from_ytdlp_stderr` 分類錯誤
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 4.2 為 `parse_video` metadata 解析撰寫 property test
    - **Property 2: yt-dlp 指令參數完整性**
    - 驗證：對任意合法 URL，建構的參數陣列必包含該 URL 及 `-J` flag
    - **Property 3: Metadata 解析結果完整性**
    - 驗證：成功解析的 `VideoMetadata` 必含非空 `title`、非空 `thumbnail` URL，及至少一個 `QualityOption`
    - **Validates: Requirements 2.1, 2.3**

  - [ ] 4.3 實作 `src-tauri/src/commands/folder.rs` — `select_folder` 與 `open_folder`
    - 實作 `#[tauri::command] async fn select_folder(app: AppHandle) -> Result<Option<String>, AppError>`，使用 `tauri_plugin_dialog` 開啟原生資料夾選取對話框
    - 實作 `#[tauri::command] async fn open_folder(app: AppHandle, path: String) -> Result<(), AppError>`，使用 `tauri_plugin_shell` 開啟系統檔案總管
    - _Requirements: 3.3, 3.4, 3.5, 5.3_

  - [x] 4.4 實作 `get_default_download_dir`（設計調整 #4）
    - 在 `folder.rs` 實作 `#[tauri::command] async fn get_default_download_dir(app: AppHandle) -> Result<String, AppError>`，使用 `app.path().download_dir()`
    - 在 `main.rs` 掛載
    - _Requirements: 3.2_

- [x] 5. 實作 `start_download` 與 `cancel_download` Commands
  - [x] 5.1 實作 `src-tauri/src/commands/download.rs` — `start_download`
    - 定義 `DownloadState`（`Arc<Mutex<HashMap<String, DownloadTask>>>`），在 `main.rs` 以 `manage()` 掛載
    - 實作 `#[tauri::command] async fn start_download(app: AppHandle, state: State<DownloadState>, url: String, quality: QualityOption, output_path: String) -> Result<String, AppError>`
    - 生成 UUID 作為 `task_id`，插入 `DownloadState`
    - Spawn Tokio task：以 `--newline --progress-template "..." -f <format> -o <path>` 呼叫 yt-dlp sidecar
    - 逐行讀取 stdout，呼叫 `parse_progress_line`，emit `download://progress` 事件
    - 成功時 emit `download://completed`，失敗時 emit `download://failed`
    - _Requirements: 4.1, 4.2, 4.4, 5.1_

  - [ ]* 5.2 為 `start_download` 任務建立撰寫 property test
    - **Property 6: Download Task 建立不可變性**
    - 驗證：對任意合法（url, quality, outputPath）組合，建立的 `DownloadTask` 必有唯一 UUID、`pending` 初始狀態，且三個欄位與傳入參數完全一致
    - **Validates: Requirements 4.1, 4.2**

  - [x] 5.3 實作 `cancel_download` command
    - 實作 `#[tauri::command] async fn cancel_download(state: State<DownloadState>, task_id: String) -> Result<(), AppError>`
    - 從 `DownloadState` 取得 task，透過 `cancel_tx` channel 通知 Tokio task 終止 sidecar 子程序
    - ~~子程序終止後 emit `download://failed`（errorType: `"Cancelled"`）~~ → 依設計調整 #7 改為 emit 獨立的 `download://cancelled`（payload `{ taskId }`），狀態為 `cancelled`
    - Unix 上以 SIGTERM 終止 yt-dlp（PyInstaller 單檔版收到 SIGKILL 會留下孤兒子程序繼續下載），5 秒後仍未結束才強制 kill
    - _Requirements: 4.1_

  - [x] 5.4 在 `main.rs` 掛載所有 Tauri Commands
    - 在 `src-tauri/src/commands/mod.rs` 重新匯出全部 commands
    - 在 `main.rs` 的 `invoke_handler!` 宏中掛載 `parse_video`、`start_download`、`cancel_download`、`select_folder`、`open_folder`
    - _Requirements: 2.1, 3.3, 4.1, 5.3_

- [ ] 6. Checkpoint — 確認後端 Commands 可正常呼叫
  - 以 Tauri dev console 手動測試 `parse_video`（有效 URL 與無效 URL）
  - 確認 `select_folder` 開啟對話框，`open_folder` 開啟檔案總管
  - 確認所有 Rust 測試通過，如有問題請向使用者反映。

---

### Group 4：下載歷史持久化

- [ ] 7. 實作 `src-tauri/src/commands/history.rs` 歷史記錄 CRUD
  - [ ] 7.1 實作 history JSON 讀寫輔助函式
    - 實作 `history_path(app: &AppHandle) -> PathBuf`，使用 `app.path().app_data_dir()` 取得平台適合路徑並附加 `history.json`
    - 實作 `load_history(app: &AppHandle) -> Vec<HistoryRecord>`：檔案不存在時回傳空 `Vec`，讀取失敗時同樣回傳空 `Vec`
    - 實作 `save_history(app: &AppHandle, records: &[HistoryRecord])`：建立父目錄（`create_dir_all`），以 `serde_json::to_string_pretty` 序列化後寫入
    - _Requirements: 6.1_

  - [ ]* 7.2 為歷史記錄序列化撰寫 property test
    - **Property 9: 下載歷史持久化往返一致性**
    - 使用 `proptest`，對任意 `completed`/`failed`/`cancelled` 狀態的 `HistoryRecord`，序列化再反序列化後，`id`、`url`、`quality`、`outputPath`、`status` 必與原始值相同
    - **Validates: Requirements 6.1**

  - [ ] 7.3 實作 `get_history`、`delete_history_item`、`clear_all_history` commands
    - 實作 `#[tauri::command] async fn get_history(app: AppHandle) -> Result<Vec<HistoryRecord>, AppError>`
    - 實作 `#[tauri::command] async fn delete_history_item(app: AppHandle, id: String) -> Result<(), AppError>`：過濾後回寫 JSON
    - 實作 `#[tauri::command] async fn clear_all_history(app: AppHandle) -> Result<(), AppError>`：清空後回寫空 `records` JSON
    - 在 `main.rs` `invoke_handler!` 中掛載三個 history commands
    - _Requirements: 6.1, 6.2, 6.4, 6.5_

  - [ ]* 7.4 為 `delete_history_item` 撰寫 property test
    - **Property 11: 歷史記錄刪除隔離性**
    - 對任意 N ≥ 1 筆記錄的列表，刪除任意一筆後：列表長度必為 N-1，被刪 id 不再出現，其餘 N-1 筆欄位不變
    - **Validates: Requirements 6.4**

  - [ ] 7.5 在 `start_download` 完成/失敗時寫入歷史記錄
    - 在 `download.rs` Tokio task 完成時呼叫 `save_history` 附加新 `HistoryRecord`（status: `completed`）
    - 失敗時同樣寫入 `HistoryRecord`（status: `failed`）
    - _Requirements: 6.1_

---

### Group 5：Vue 3 前端 — Pinia Stores

- [ ] 8. 實作 `useUrlInputStore`
  - [ ] 8.1 建立 `src/stores/urlInput.ts`
    - 定義全部 state（`url`、`validationState`、`isParsing`、`metadata`、`parseError`、`selectedQuality`、`selectedPath`）
    - 實作 `canParse` 與 `hasMetadata` computed getters
    - 實作 `setUrl(value: string)`：空字串 → `idle`，否則呼叫 `validateUrl` 設定 `valid`/`invalid`
    - 實作 `parseVideo()`：設定 `isParsing = true`，invoke `parse_video`，成功時設定 `metadata` 並預選最高畫質（`selectedQuality`）
    - 實作 `selectFolder()`：invoke `select_folder`，僅在使用者有選取時更新 `selectedPath`
    - 實作 `reset()`：清空全部狀態
    - _Requirements: 1.2, 1.3, 1.4, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.4, 3.5_

  - [ ]* 8.2 為 `selectedQuality` 預設選取撰寫 property test
    - **Property 5: 預設選取最高畫質**
    - 對任意非空 `QualityOption[]`，`setUrl` + `parseVideo` 完成後 `selectedQuality` 必為優先順序最高的選項（1080p > 720p > 480p > audio_mp3）
    - **Validates: Requirements 3.1**

- [ ] 9. 實作 `useDownloadTaskStore`
  - [ ] 9.1 建立 `src/stores/downloadTask.ts`
    - 以 `Map<string, DownloadTask>` 維護進行中任務
    - 實作 `taskList` computed（按 `createdAt` 降序排列）與 `activeCount` computed
    - 實作 `startDownload(url, quality, outputPath, metadata)`：invoke `start_download`，以回傳的 `task_id` 建立 `DownloadTask` 並插入 Map，初始狀態 `pending`
    - 實作 `updateProgress(event: DownloadProgressEvent)`：更新對應 task 的 `percent`、`speed`、`speedBytes`、`etaSeconds`
    - 實作 `markCompleted(event)` 與 `markFailed(event)`
    - 實作 `cancelTask(taskId)` 與 `removeTask(taskId)`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 7.2_

  - [ ]* 9.2 為 `updateProgress` 撰寫 property test
    - **Property 8: 進度事件驅動 Store 狀態一致性**
    - 對 Map 中存在的 task_id，接收 `download://progress` 事件後，該 task 的四個進度欄位必等於事件攜帶數值，其他 task 狀態不變
    - **Validates: Requirements 4.5**

  - [ ]* 9.3 為 `markFailed` 撰寫 property test
    - **Property 12: 下載失敗狀態轉換正確性**
    - 對狀態為 `downloading` 的 task，接收 `download://failed` 後，`status` 必轉為 `failed`，`errorMessage` 必為非空字串，其他 task 狀態不變
    - **Validates: Requirements 7.1, 7.2**

- [ ] 10. 實作 `useHistoryStore` 與 `useTauriEvents` composable
  - [ ] 10.1 建立 `src/stores/history.ts`
    - 定義 `records: HistoryRecord[]` state 與 `isLoading` flag
    - 實作 `loadHistory()`：invoke `get_history`，更新 `records`
    - 實作 `deleteRecord(id)`：invoke `delete_history_item`，本地過濾
    - 實作 `clearAll()`：invoke `clear_all_history`，清空 `records`
    - 實作 `appendRecord(record: HistoryRecord)`：`records.unshift(record)`（由 `useTauriEvents` 呼叫）
    - 實作 `retryDownload(record: HistoryRecord)`：呼叫 `downloadTaskStore.startDownload` 以原始參數重新建立任務
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 7.3_

  - [ ]* 10.2 為 `retryDownload` 撰寫 property test
    - **Property 10: 重試任務參數不變性**
    - 對任意 `failed`/`cancelled` 的 `HistoryRecord`，`retryDownload` 建立的新 `DownloadTask`，其 `url`、`quality`、`outputPath` 必與原 record 完全一致
    - **Validates: Requirements 6.3, 7.3**

  - [ ] 10.3 建立 `src/composables/useTauriEvents.ts`
    - 實作 `useTauriEvents()`：訂閱 `download://progress` → 呼叫 `downloadTaskStore.updateProgress()`
    - 訂閱 `download://completed` → 呼叫 `downloadTaskStore.markCompleted()` 與 `historyStore.appendRecord()`，並觸發系統通知（`sendNotification`）
    - 訂閱 `download://failed` → 呼叫 `downloadTaskStore.markFailed()` 與 `historyStore.appendRecord()`
    - 在 `App.vue` `onMounted` 中呼叫此 composable，在 `onUnmounted` 中取消訂閱
    - _Requirements: 4.4, 4.5, 5.1, 7.1, 7.2_

- [ ] 11. Checkpoint — 確認 Stores 與事件鏈路正常
  - 執行 `npm run test --run` 確認所有 Vitest 測試通過
  - 以 Tauri dev 環境驗證 `start_download` 觸發後 Store 狀態正確更新
  - 確認所有測試通過，如有問題請向使用者反映。

---

### Group 6：Vue 3 前端 — UI 元件

- [ ] 12. 實作 `UrlInputBar.vue` 與 `VideoPreview.vue`
  - [ ] 12.1 實作 `src/components/UrlInputBar.vue`
    - 單行文字輸入欄位，`v-model` 雙向綁定 `urlInputStore.url`，`@input` 呼叫 `setUrl()`
    - URL 格式錯誤時顯示紅色錯誤訊息（條件渲染，`validationState === 'invalid'`）
    - 「解析影片」按鈕，`:disabled="!canParse || isParsing"`；解析中顯示 spinner
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2_

  - [ ] 12.2 實作 `src/components/VideoPreview.vue`
    - 顯示封面縮圖（`<img :src="metadata.thumbnail">`）、影片標題、上傳者
    - 畫質選擇器（radio group），選項依 `metadata.availableQualities` 產生，預設選取 `urlInputStore.selectedQuality`
    - 儲存路徑顯示欄位 + 「變更路徑」按鈕（呼叫 `urlInputStore.selectFolder()`），預設顯示 `~/Downloads`
    - 「開始下載」按鈕，點擊呼叫 `downloadTaskStore.startDownload(...)` 並 `urlInputStore.reset()`
    - `v-if="urlInputStore.hasMetadata"` 條件渲染，無 metadata 時不顯示
    - _Requirements: 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1_

- [ ] 13. 實作 `DownloadTaskCard.vue` 與 `DownloadList.vue`
  - [ ] 13.1 實作 `src/components/DownloadTaskCard.vue`
    - 顯示縮圖、影片標題、畫質、儲存路徑
    - 下載中狀態：進度條（`percent`）、即時速度（`speed`）、ETA，以及「取消」按鈕（呼叫 `cancelTask(task.id)`）
    - 完成狀態：進度條 100%、「已完成」文字、「開啟檔案位置」按鈕（invoke `open_folder`）
    - 失敗狀態：⚠ 圖示 + `errorMessage`、「重試」按鈕（以原始參數重新呼叫 `startDownload`）
    - _Requirements: 4.3, 5.2, 5.3, 7.2, 7.3_

  - [ ] 13.2 實作 `src/components/DownloadList.vue`
    - 以 `v-for` 渲染 `downloadTaskStore.taskList`，每筆使用 `DownloadTaskCard`
    - 無任務時顯示空狀態提示（`taskList.length === 0`）
    - _Requirements: 4.2, 4.3_

  - [ ] 13.3 實作 `src/views/HomeView.vue` — 組裝主頁
    - 組合 `UrlInputBar`、`VideoPreview`、`DownloadList` 三個元件
    - 頂部導覽列含「歷史記錄」連結（`<router-link to="/history">`）
    - _Requirements: 1.1, 2.3, 4.2_

- [ ] 14. 實作 `HistoryPage.vue` 與 `HistoryView.vue`
  - [ ] 14.1 實作 `src/components/HistoryPage.vue`
    - 頂部「清除全部歷史」按鈕（呼叫 `historyStore.clearAll()`）
    - 表格列每行：縮圖、標題、畫質、路徑、完成時間、狀態徽章（`completed`/`failed`/`cancelled`）
    - 每行操作按鈕：「清除」（`deleteRecord(record.id)`）；`failed`/`cancelled` 行額外顯示「重試」（`retryDownload(record)`）
    - `onMounted` 呼叫 `historyStore.loadHistory()`
    - _Requirements: 6.2, 6.3, 6.4, 6.5_

  - [ ] 14.2 組裝 `src/views/HistoryView.vue`
    - 包含返回首頁連結與 `HistoryPage` 元件
    - _Requirements: 6.2_

- [ ] 15. Checkpoint — 確認完整 UI 流程可操作
  - 在 Tauri dev 環境下完整測試：貼上 URL → 解析 → 選擇畫質 → 下載 → 通知 → 開啟資料夾
  - 確認歷史記錄頁面正確顯示與操作
  - 確認所有測試通過，如有問題請向使用者反映。

---

### Group 7：Tauri v2 Capability 設定

- [ ] 16. 設定 `src-tauri/capabilities/default.json`
  - [ ] 16.1 建立或更新 `default.json` 加入所有必要 permissions
    - 加入 `"core:default"`
    - 加入 `"shell:allow-execute"`（yt-dlp sidecar 執行）與 `"shell:allow-open"`（開啟檔案總管）
    - 加入 `"dialog:allow-open"`（原生資料夾選取對話框）
    - 加入 `"fs:allow-read"`、`"fs:allow-write"`、`"fs:allow-read-dir"`、`"fs:scope-app-data"`、`"fs:scope-download"`
    - 加入 `"notification:default"`（下載完成系統通知）
    - 確認 `windows: ["main"]`，並驗證 JSON schema 正確（`$schema: "../gen/schemas/desktop-schema.json"`）
    - _Requirements: 3.3, 5.1, 5.3, 6.1_

  - [ ] 16.2 在 `tauri.conf.json` 設定 plugins 與 sidecar
    - 確認 `bundle.externalBin: ["binaries/yt-dlp"]` 宣告正確
    - 加入 `plugins.shell`、`plugins.dialog`、`plugins.fs`、`plugins.notification` 設定區塊
    - _Requirements: 2.1, 3.3, 5.3_

- [ ] 17. Checkpoint — 確認 Capability 設定無誤
  - 執行 `npm run tauri build` 確認打包時無 capability 缺失警告
  - 確認 sidecar 命名規範符合目標 triple，如有問題請向使用者反映。

---

### Group 8：GitHub Actions CI/CD

- [ ] 18. 建立 `.github/workflows/release.yml` — Matrix Build + Draft Release
  - [ ] 18.1 建立 workflow 骨架與 trigger 設定
    - 設定 `on.push.tags: ["v*.*.*"]` 觸發條件
    - 定義 `jobs.build` 含 `strategy.fail-fast: true`（確保任一 matrix 失敗不建立 Release）
    - 定義三個 matrix targets：`windows-latest`（x64）、`macos-latest`（aarch64）、`macos-latest`（x86_64）
    - 每個 matrix 攜帶 `yt_dlp_url` 與 `yt_dlp_filename` 變數
    - _Requirements: 8.1, 8.2, 8.5_

  - [ ] 18.2 實作 CI steps：環境安裝與 yt-dlp sidecar 預下載
    - 加入 `actions/checkout@v4`、`actions/setup-node@v4`（Node 20, npm cache）、`dtolnay/rust-toolchain@stable`
    - macOS target 額外執行 `rustup target add ${{ matrix.target }}`
    - 加入 `swatinem/rust-cache@v2`（`workspaces: "./src-tauri -> target"`）
    - 實作 Unix 步驟（`curl -L ... && chmod +x`）與 Windows 步驟（`Invoke-WebRequest` PowerShell）下載 yt-dlp 至 `src-tauri/binaries/`
    - _Requirements: 8.2, 8.3_

  - [ ] 18.3 實作 `tauri-apps/tauri-action@v0` 建構與 Draft Release 步驟
    - 設定 `tagName`、`releaseName`、`releaseBody`、`releaseDraft: true`、`prerelease: false`
    - 傳入 `args: --target ${{ matrix.target }}`
    - 設定必要 secrets env：`GITHUB_TOKEN`、`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`
    - _Requirements: 8.2, 8.4, 8.5_

- [ ] 19. Final Checkpoint — 確認所有任務完成
  - 確認所有 Rust 與 TypeScript 測試通過（`cargo test` + `npm run test --run`）
  - 確認 `npm run tauri build` 在本地環境可成功編譯
  - 確認 `.github/workflows/release.yml` YAML 語法正確（可使用 `actionlint`）
  - 確認所有測試通過，如有問題請向使用者反映。

---

## Notes

- 標有 `*` 的子任務為選用，可跳過以加速 MVP 開發
- 每個任務均引用對應需求編號以確保可追溯性
- Property tests 使用 Rust `proptest` 套件（後端）與 TypeScript `fast-check` 套件（前端）
- Checkpoint 任務為驗證節點，確保每個群組完成後系統仍可正常運作
- yt-dlp sidecar 二進位檔不應提交至 git（加入 `.gitignore`），由 CI 下載
- macOS 兩個 target 共用 `yt-dlp_macos` universal binary；如需固定版本，替換 `latest` 為指定版本號

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.5", "3.4"] },
    { "id": 2, "tasks": ["3.1", "3.2"] },
    { "id": 3, "tasks": ["3.3", "4.1", "4.3"] },
    { "id": 4, "tasks": ["4.2", "4.5", "5.1", "5.3"] },
    { "id": 5, "tasks": ["5.2", "5.4", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3"] },
    { "id": 7, "tasks": ["7.4", "7.5", "8.1"] },
    { "id": 8, "tasks": ["8.2", "9.1", "10.1"] },
    { "id": 9, "tasks": ["8.3", "9.2", "9.3", "10.2", "10.3"] },
    { "id": 10, "tasks": ["12.1", "12.2"] },
    { "id": 11, "tasks": ["13.1", "14.1"] },
    { "id": 12, "tasks": ["13.2", "13.3", "14.2"] },
    { "id": 13, "tasks": ["16.1", "16.2"] },
    { "id": 14, "tasks": ["18.1"] },
    { "id": 15, "tasks": ["18.2"] },
    { "id": 16, "tasks": ["18.3"] }
  ]
}
```
