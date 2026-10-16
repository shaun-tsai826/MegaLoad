# MegaLoad（萬用下載器）

跨平台桌面影音下載器：貼上 YouTube、X/Twitter、Bilibili 等網址 → 解析 metadata → 選畫質與路徑 → 多工下載並顯示進度 → 通知、下載歷史、重試。
技術棧：Vue 3 + Vite + Tailwind v4 + Pinia（前端）、Tauri v2 + Rust（後端）、yt-dlp（與 ffmpeg）以 sidecar 打包。

## 規格與進度

- 規格以 `documents/` 為準：`requirements.md`（8 項需求）、`design.md`（架構、Commands、Events、Stores）、`tasks.md`（實作清單）、`跨平台通用影音解析與本地下載 (Tauri Desktop).md`（BDD 情境）。
- 進度以**程式碼實況**為準，不要只看勾選。完成一項任務後，在 `documents/tasks.md` 打勾。
- `.kiro/specs/` 是 Kiro 產生的舊副本，不要更新它。
- 開始一個任務前，先確認相關檔案的現況，再動手。

## 常用指令

- 開發：`npm run tauri dev`（Vite 使用固定的 1420 port）
- 前端測試：`npm run test:run`（Vitest + fast-check）
- 後端測試：在 `src-tauri/` 下執行 `cargo test`（proptest）
- 型別檢查與建置：`npm run build`（`vue-tsc && vite build`）
- 打包：`npm run tauri build`

## 已決定的設計調整（優先於 design.md）

1. **加入 ffmpeg sidecar**：合併 `bestvideo+bestaudio` 與 MP3 轉檔都需要 ffmpeg。呼叫 yt-dlp 時傳入 `--ffmpeg-location`。
2. **前後端命名**：回傳給前端的 Rust struct（`VideoMetadata`、`HistoryRecord`、event payload）一律加上 `#[serde(rename_all = "camelCase")]`，與 `src/types/index.ts` 一致。Tauri 只會自動轉換 command 的傳入參數，不會轉換回傳值。history.json 的鍵名格式尚未決定。
3. **開啟檔案位置**：改用 `tauri-plugin-opener` 的 `reveal_item_in_dir`，不要用 `tauri-plugin-shell` 的 `open()`（它的預設 scope 會擋下本機路徑）。
4. **預設下載路徑**：新增 `get_default_download_dir` command，使用 `app.path().download_dir()`。
5. **history.json 寫入**：多個下載任務會同時寫入，必須用 Mutex 讓寫入依序進行。
6. **yt-dlp 下載參數**：加上 `--newline --no-colors`，並用 `--print after_move:filepath` 取得最終檔案路徑。
7. **取消下載**：狀態標記為 `cancelled`，不要標記為 `failed`。
8. **Capability**：Rust 端直接呼叫 plugin 不受 capability 限制，前端只開放實際需要的權限（預期為 `core:default`、`notification:default`）。設定前先對照 Tauri v2 實際的權限名稱。
9. **yt-dlp 版本**：CI 中固定版本號，不要用 `latest`。

## Sidecar

- 放在 `src-tauri/binaries/`，依目標 triple 命名：`yt-dlp-x86_64-apple-darwin`（Intel Mac）、`yt-dlp-aarch64-apple-darwin`（Apple Silicon）、`yt-dlp-x86_64-pc-windows-msvc.exe`；ffmpeg 也用同樣的規則。
- 二進位檔不提交 git（已列在 `.gitignore`）。本機執行 `npm run fetch-sidecars`（即 `scripts/fetch-sidecars.sh`，版本固定為 yt-dlp 2026.08.19、ffmpeg-static b6.1.1）；CI 可用同一支腳本並傳入 target triple。
- yt-dlp 舊版很快會被 YouTube 擋下：2026-10-16 時 2026.07.04 下載任何格式都回傳 HTTP 403，因此升到 2026.08.19。遇到 403 時先用最新版 yt-dlp 重現，再決定是否升級。
- 開發機有 Intel Mac 與 M4 Mac mini 兩台：腳本要用 `rustc -vV` 的 host triple 判斷要下載哪個版本。

## 程式風格

- Rust：錯誤一律回傳 `AppError`（`src-tauri/src/error.rs`），yt-dlp 的 stderr 用 `AppError::from_ytdlp_stderr` 分類；新模組附上 `#[cfg(test)]` 單元測試。
- 前端：Composition API + `<script setup lang="ts">`；Pinia 使用 setup store 寫法；`@/` 指向 `src/`。
- UI 文字使用繁體中文。

## 建議的實作順序

階段 0 修好環境（git init、lock 檔、圖示、sidecar 腳本、把 `parse` 加進 `commands/mod.rs`）→ 階段 1 後端 G3 + G4 → 階段 2 Pinia Stores（G5）→ 階段 3 UI（G6）→ 階段 4 Capability 與本機打包（G7）→ 階段 5 CI/CD（G8）。每個階段結束時都要實際跑起來驗證。

## 目前進度（交接紀錄）

**階段 0 已完成（2026-10-16）**：`cargo test` 通過，`npm run tauri dev` 可以啟動；在 devtools Console 執行 `window.__TAURI_INTERNALS__.invoke('parse_video', { url })` 已能成功回傳 `title`、`thumbnail`、`availableQualities`（camelCase）。

已處理的事項：
- `sidecar.rs` 的 `spawn_sidecar` 回傳型別改為 `Result<(tauri::async_runtime::Receiver<CommandEvent>, CommandChild), tauri_plugin_shell::Error>`（Kiro 原本的寫法無法編譯）。
- `commands/mod.rs` 已加入 `parse`；`main.rs` 已註冊 `parse_video`、`select_folder`、`open_folder`（使用完整模組路徑）。
- 已建立 `src-tauri/capabilities/default.json`（`core:default`、`notification:default`），解決 notification plugin 啟動時的權限錯誤。
- `vue-tsc` 已升到 ^2.2（1.8 不相容新版 TypeScript），並補上 `jsdom`、`src/vite-env.d.ts`。
- 圖示已由 `app-icon.png` 透過 `npm run tauri icon` 產生。

待處理的小事：
- `npm audit` 的 5 個漏洞都在開發工具（Vite 5 → esbuild、Vitest 1 → tinypool）。**不要執行 `npm audit fix --force`**（會直接跳到 Vite 8 / Vitest 5）；之後把 Vite、Vitest、`@vitejs/plugin-vue` 一起升到互相相容的版本。
- npm 擋下 `esbuild`、`vue-demi` 的 install script，目前沒有影響；遇到 esbuild 錯誤時執行 `npm install-scripts approve esbuild`。

**階段 1 已完成（2026-10-16，分支 `stage-1-backend`，尚未合併回 `main`）**：`cargo test` 84 項通過、無警告；Console 檢查點已實測完整下載、取消、下載失敗、歷史記錄 CRUD、`open_folder`。

給前端（階段 2）的介面：
- Commands：`get_default_download_dir`、`start_download({ url, quality, outputPath, title?, thumbnail? })` → `taskId`、`cancel_download({ taskId })`、`get_history`、`delete_history_item({ id })`、`clear_all_history`、`open_folder({ path })`（傳 `filePath` 會在 Finder 中選取該檔案）。`title`、`thumbnail` 請從 metadata 傳入，歷史記錄要用。
- Events（payload 皆為 camelCase，型別在 `src/types/index.ts`）：`download://progress`、`download://completed`、`download://failed`，以及新增的 `download://cancelled`（`{ taskId }`）。每個任務結束時只會收到其中一個結束事件；取消**不會**送 `failed`。
- 錯誤回傳格式為 `{ type, message }`（`type` 為 `AppError` 的 variant 名稱）。
- 後端在任務結束時就已寫入 history.json；前端的 `appendRecord` 只需更新畫面。

實作上的決定與已知行為：
- history.json 位於 `app_data_dir()`，macOS 為 `~/Library/Application Support/com.video-downloader.app/history.json`（目錄名稱用的是 identifier，不是 design.md 寫的 productName）。格式為 `{ "version": 1, "records": [...] }`，camelCase、最新在前。
- 下載完成時用 `--print after_move:MEGALOAD_DONE:%(.{title,filepath})j` 取得標題與最終路徑；`--print` 會隱含 `--quiet`，所以要加 `--progress`。
- 輸出檔名帶上**實際下載的高度**（`標題 [720p].mp4`，選 1080p 但影片只有 480p 時會標 `[480p]`），MP3 為 `標題 [MP3].mp3`。原因：yt-dlp 看到同名檔案會跳過下載，舊的 `%(title)s.%(ext)s` 會讓不同畫質共用檔名，回報的其實是舊檔。同一畫質重複下載時仍會直接回報完成，不會有進度事件。
- 影像與音訊分開下載，進度會從 0% 跑到 100% **兩次**；UI 要不要合併成一條進度，留到階段 3 再決定。
- 取消時在 Unix 上送 SIGTERM，因為 PyInstaller 單檔版收到 SIGKILL 會留下孤兒子程序繼續下載（已實測）。Windows 上直接呼叫 `kill()`，**尚未在 Windows 驗證**是否會留下子程序。取消後 `.part` 檔會保留，供重試時續傳。
- 尚未驗證：`select_folder` 對話框、`parse_video` 給無效 URL 的情況（tasks.md 的 6. Checkpoint 因此還沒勾）。

**下一步：階段 2（Pinia Stores，G5）**：`urlInput`、`downloadTask`、`history` stores 與 `useTauriEvents`（要另外處理 `download://cancelled`）。

## 測試時的注意事項

- 修改 `src-tauri/` 後，`tauri dev` 會自動重建並重啟視窗。若畫面變成空白、Console 出現 `Could not connect to the server http://localhost:1420/`，代表 Vite 停掉了：按 `Ctrl+C` 停止後重新執行 `npm run tauri dev`（必要時用 `lsof -i :1420` 找出並結束舊程序）。
- yt-dlp 第一次啟動需要解壓，回應會慢幾秒。
- macOS 的 WKWebView Web Inspector 不支援在 Console 最上層寫 `await`，要包成 `(async () => { ... })()`。監聽事件可用 `__TAURI_INTERNALS__.invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler: __TAURI_INTERNALS__.transformCallback(fn) })`。
- dev 模式下系統通知會以「終端機」的名義發出（tauri-plugin-notification 在 `is_dev()` 時使用 `com.apple.Terminal`），要到系統設定 → 通知 → 終端機開啟；打包後才會使用 App 自己的 identifier。
- 下載出現 HTTP 403 時，先確認是不是 yt-dlp 版本太舊（見 Sidecar 一節）。
