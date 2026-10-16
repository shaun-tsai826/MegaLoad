# Requirements Document

## Introduction

本功能為一套基於 Vue 3 + Vite + Tauri v2 架構的跨平台桌面影音下載應用程式。系統整合 yt-dlp 作為固定版本的 sidecar 執行檔，支援 YouTube、X/Twitter、Bilibili 等主流影音平台的解析與本地下載。同時，透過 GitHub Actions CI/CD 自動化完成多平台打包與 Release 發佈，涵蓋 Windows（x64）與 macOS（aarch64、x86_64）。

## Glossary

- **App**：以 Tauri v2 為基礎建立的跨平台桌面應用程式。
- **Frontend**：以 Vue 3 + Vite 實作的使用者介面層。
- **Tauri Backend**：以 Rust 實作的 Tauri v2 後端命令層，負責橋接 Frontend 與系統資源。
- **yt-dlp Sidecar**：隨應用程式一同打包的固定版本 yt-dlp 執行檔，依 Tauri sidecar 命名規範放置於 `src-tauri/binaries/`。
- **Metadata**：由 yt-dlp 以 `-J` flag 回傳的影片 JSON 資訊，包含標題、封面縮圖 URL 及可用畫質串流清單。
- **Download Task**：單一影片下載工作單元，包含 URL、選定畫質、儲存路徑、進度狀態。
- **Download History**：持久化儲存於本地的已完成、失敗及取消的 Download Task 記錄。
- **Quality Option**：可選的下載畫質，包含 1080p、720p、480p 及僅音訊 MP3。
- **Tauri Event Emitter**：Tauri v2 提供的事件機制，用於將後端資料串流推送至 Frontend。
- **Tauri Dialog Plugin**：Tauri v2 dialog plugin，用於呼叫原生資料夾選取對話框。
- **Tauri Shell Plugin**：Tauri v2 shell plugin，用於開啟系統檔案總管。
- **CI/CD Pipeline**：GitHub Actions workflow，由 Git Tag 觸發，執行多平台建構與 Draft Release 發佈。
- **Matrix Build**：GitHub Actions 的矩陣建構策略，同時針對多個目標平台平行執行建構任務。
- **Draft Release**：GitHub Releases 中狀態為 draft 的版本發佈，需人工確認後才公開。

---

## Requirements

### Requirement 1：URL 輸入與驗證

**User Story:** As a 使用者，I want 貼上影音平台 URL 後系統立即驗證格式，so that 我能在解析前得知 URL 是否有效，避免無效請求。

#### Acceptance Criteria

1. THE App SHALL 提供單行文字輸入欄位供使用者輸入或貼上影音 URL。
2. WHEN 輸入欄位內容變更，THE Frontend SHALL 以正規表達式驗證 URL 格式是否為合法的 HTTP/HTTPS URL。
3. IF URL 格式驗證失敗，THEN THE Frontend SHALL 顯示錯誤訊息並停用「解析影片」按鈕。
4. WHEN URL 格式驗證通過，THE Frontend SHALL 啟用「解析影片」按鈕。

---

### Requirement 2：影片 Metadata 解析

**User Story:** As a 使用者，I want 點擊「解析影片」後取得影片資訊，so that 我可以確認影片內容並選擇下載畫質。

#### Acceptance Criteria

1. WHEN 使用者點擊「解析影片」按鈕，THE Tauri Backend SHALL 以 `-J` flag 呼叫 yt-dlp Sidecar，對輸入 URL 執行 metadata 擷取。
2. WHILE yt-dlp Sidecar 執行 metadata 擷取，THE Frontend SHALL 顯示載入狀態指示器，並停用「解析影片」按鈕。
3. WHEN yt-dlp Sidecar 成功回傳 Metadata，THE Frontend SHALL 顯示影片標題、封面縮圖及 Quality Option 列表（1080p、720p、480p、僅音訊 MP3）。
4. IF yt-dlp Sidecar 回傳表示私人或需登入的錯誤，THEN THE Frontend SHALL 顯示權限提示訊息，說明該影片需要登入帳號方可存取。
5. IF yt-dlp Sidecar 回傳非預期錯誤，THEN THE Frontend SHALL 顯示錯誤描述訊息並恢復「解析影片」按鈕為可用狀態。

---

### Requirement 3：下載設定

**User Story:** As a 使用者，I want 在下載前選擇畫質與儲存路徑，so that 我能控制檔案格式與存放位置。

#### Acceptance Criteria

1. THE Frontend SHALL 預設選取 Metadata 解析結果中畫質最高的 Quality Option。
2. THE Frontend SHALL 預設將儲存路徑設定為系統使用者的 `~/Downloads` 目錄。
3. WHEN 使用者點擊「變更路徑」按鈕，THE Tauri Backend SHALL 透過 Tauri Dialog Plugin 開啟原生資料夾選取對話框。
4. WHEN 使用者於對話框選取資料夾，THE Frontend SHALL 以所選路徑更新儲存路徑顯示欄位。
5. IF 使用者關閉對話框未選取資料夾，THEN THE Frontend SHALL 保持原有儲存路徑不變。

---

### Requirement 4：多工並行下載

**User Story:** As a 使用者，I want 同時進行多個影片的下載，so that 我不需要等待一個完成才能開始下一個。

#### Acceptance Criteria

1. WHEN 使用者點擊「開始下載」，THE Tauri Backend SHALL 建立一個獨立的 Download Task，並立即允許使用者對新的 URL 重複解析與下載流程。
2. THE App SHALL 支援多個 Download Task 同時並行執行，且各 Download Task 之間互不阻塞。
3. WHILE Download Task 執行中，THE Frontend SHALL 為每個 Download Task 顯示獨立進度條，呈現下載百分比與即時速度（單位：KB/s 或 MB/s）。
4. WHEN yt-dlp Sidecar 透過 stdout 輸出進度資訊，THE Tauri Backend SHALL 透過 Tauri Event Emitter 將該資訊推送至 Frontend。
5. THE Frontend SHALL 解析 Tauri Event Emitter 推送的進度事件，並即時更新對應 Download Task 的進度條顯示。

---

### Requirement 5：下載完成通知

**User Story:** As a 使用者，I want 下載完成後收到通知，so that 我可以立即找到並使用下載的檔案。

#### Acceptance Criteria

1. WHEN Download Task 成功完成，THE App SHALL 顯示系統通知，通知內容包含影片標題。
2. WHEN Download Task 成功完成，THE Frontend SHALL 在該 Download Task 的進度條區域顯示「開啟檔案位置」按鈕。
3. WHEN 使用者點擊「開啟檔案位置」按鈕，THE Tauri Backend SHALL 透過 Tauri Shell Plugin 開啟系統檔案總管，並定位至已下載檔案所在目錄。

---

### Requirement 6：下載歷史記錄

**User Story:** As a 使用者，I want 查看過去所有下載任務的記錄，so that 我可以追蹤下載狀態並對失敗任務執行重試。

#### Acceptance Criteria

1. THE App SHALL 將每個 Download Task 的結果（已完成、失敗、取消）持久化儲存至本地 Download History。
2. THE Frontend SHALL 提供 Download History 列表頁面，顯示每筆記錄的影片標題、畫質、儲存路徑、完成時間及最終狀態。
3. WHEN 使用者對失敗或取消狀態的 Download Task 點擊「重試」，THE App SHALL 使用原 Download Task 的 URL、畫質及儲存路徑重新建立並執行下載。
4. WHEN 使用者點擊「清除」按鈕，THE App SHALL 從 Download History 中移除該筆記錄，且不影響已下載的本地檔案。
5. THE Frontend SHALL 提供「清除全部歷史」操作，執行後 THE App SHALL 移除全部 Download History 記錄。

---

### Requirement 7：下載中斷處理

**User Story:** As a 使用者，I want 在下載中途發生網路中斷時獲得明確提示與重試選項，so that 我不需要手動重新操作完整下載流程。

#### Acceptance Criteria

1. IF Download Task 執行中發生網路中斷或 yt-dlp Sidecar 異常退出，THEN THE Tauri Backend SHALL 將該 Download Task 狀態標記為失敗，並透過 Tauri Event Emitter 通知 Frontend。
2. WHEN Frontend 接收到 Download Task 失敗事件，THE Frontend SHALL 在該 Download Task 的顯示區域呈現失敗警告訊息及「重試」按鈕。
3. WHEN 使用者點擊失敗 Download Task 的「重試」按鈕，THE App SHALL 使用原 Download Task 的參數重新啟動下載。

---

### Requirement 8：CI/CD 多平台自動建構

**User Story:** As a 開發者，I want 推送符合格式的 Git Tag 後自動觸發多平台建構，so that 我不需要在本地手動為每個平台進行打包。

#### Acceptance Criteria

1. WHEN Git Tag 以 `v*.*.*` 格式推送至遠端儲存庫，THE CI/CD Pipeline SHALL 自動觸發建構 workflow。
2. THE CI/CD Pipeline SHALL 以 Matrix Build 策略同時針對以下三個目標執行建構：`windows-latest`（x64）、`macos-latest`（aarch64）、`macos-latest`（x86_64）。
3. WHEN CI/CD Pipeline 在各 Matrix Build 目標環境啟動，THE CI/CD Pipeline SHALL 依對應平台下載 yt-dlp 執行檔，並依 Tauri sidecar 命名規範將其放置於 `src-tauri/binaries/` 目錄。
4. WHEN 所有 Matrix Build 目標建構成功，THE CI/CD Pipeline SHALL 自動建立 GitHub Draft Release，附件包含：Windows 的 `.exe` 及 `.msi` 安裝檔，以及 macOS aarch64 與 x86_64 各一份 `.dmg` 安裝檔。
5. IF 任一 Matrix Build 目標建構失敗，THEN THE CI/CD Pipeline SHALL 標記該 workflow run 為失敗，且不建立 Draft Release。
