# Design Document

## Introduction

本文件描述以 **Vue 3 + Vite + Tauri v2** 架構建構的跨平台桌面影音下載應用程式的技術設計。系統以 yt-dlp 固定版本 sidecar 作為下載引擎，支援 YouTube、X/Twitter、Bilibili 等主流影音平台，並透過 GitHub Actions Matrix Build 完成 Windows / macOS 多平台自動化打包與 Draft Release 發佈。

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Tauri App                            │
│                                                             │
│  ┌────────────────────────┐   ┌───────────────────────────┐ │
│  │   Frontend (Vue 3)     │   │   Tauri Backend (Rust)    │ │
│  │                        │   │                           │ │
│  │  ┌──────────────────┐  │   │  ┌─────────────────────┐  │ │
│  │  │  Pinia Stores    │  │◄──┤  │  Tauri Commands     │  │ │
│  │  │  - urlInput      │  │   │  │  - parse_video      │  │ │
│  │  │  - downloadTask  │  │   │  │  - start_download   │  │ │
│  │  │  - history       │  │   │  │  - cancel_download  │  │ │
│  │  └──────────────────┘  │   │  │  - open_folder      │  │ │
│  │                        │   │  │  - select_folder    │  │ │
│  │  ┌──────────────────┐  │   │  │  - get_history      │  │ │
│  │  │  Vue Components  │  │   │  │  - clear_history    │  │ │
│  │  │  - UrlInputBar   │  │   │  └─────────────────────┘  │ │
│  │  │  - VideoPreview  │  │   │                           │ │
│  │  │  - DownloadList  │  │   │  ┌─────────────────────┐  │ │
│  │  │  - HistoryPage   │  │   │  │  Event Emitter      │  │ │
│  │  └──────────────────┘  │   │  │  - download://      │  │ │
│  │                        │◄──┤  │    progress         │  │ │
│  └────────────────────────┘   │  │    completed        │  │ │
│                                │  │    failed           │  │ │
│                                │  └─────────────────────┘  │ │
│                                │                           │ │
│                                │  ┌─────────────────────┐  │ │
│                                │  │  Sidecar Manager    │  │ │
│                                │  │  (yt-dlp process)   │  │ │
│                                │  └─────────────────────┘  │ │
│                                └───────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                        │
                              ┌─────────▼──────────┐
                              │    yt-dlp sidecar  │
                              │  src-tauri/        │
                              │  binaries/         │
                              └────────────────────┘
```

資料流向：
1. Frontend 透過 `invoke()` 呼叫 Tauri Commands（Request/Response）
2. Tauri Backend 透過 `emit()` 推送進度事件至 Frontend（Server Push）
3. Tauri Backend 以 `Command::new_sidecar()` 啟動 yt-dlp 子程序
4. yt-dlp stdout/stderr 由 Rust 非同步讀取後轉為事件推送

---

## Project Directory Structure

```
cross-platform-video-downloader/
├── .github/
│   └── workflows/
│       └── release.yml               # Matrix build + Draft Release
│
├── src/                              # Vue 3 Frontend
│   ├── assets/
│   ├── components/
│   │   ├── UrlInputBar.vue
│   │   ├── VideoPreview.vue
│   │   ├── DownloadTaskCard.vue
│   │   ├── DownloadList.vue
│   │   └── HistoryPage.vue
│   ├── stores/
│   │   ├── urlInput.ts               # URL 輸入與解析狀態
│   │   ├── downloadTask.ts           # 進行中下載任務列表
│   │   └── history.ts                # 下載歷史記錄
│   ├── composables/
│   │   ├── useProgressParser.ts      # yt-dlp stdout 進度解析
│   │   └── useTauriEvents.ts         # Tauri Event 訂閱管理
│   ├── types/
│   │   └── index.ts                  # 共用型別定義
│   ├── utils/
│   │   └── urlValidator.ts           # URL 格式驗證正規表達式
│   ├── views/
│   │   ├── HomeView.vue
│   │   └── HistoryView.vue
│   ├── App.vue
│   └── main.ts
│
├── src-tauri/
│   ├── binaries/                     # yt-dlp sidecar 執行檔（Tauri 命名規範）
│   │   ├── yt-dlp-x86_64-pc-windows-msvc.exe
│   │   ├── yt-dlp-aarch64-apple-darwin
│   │   └── yt-dlp-x86_64-apple-darwin
│   ├── capabilities/
│   │   └── default.json              # Tauri v2 Capability 設定
│   ├── icons/
│   ├── src/
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── parse.rs              # parse_video command
│   │   │   ├── download.rs           # start_download / cancel_download
│   │   │   ├── folder.rs             # select_folder / open_folder
│   │   │   └── history.rs            # get_history / clear_history / delete_history_item
│   │   ├── models/
│   │   │   ├── mod.rs
│   │   │   ├── download_task.rs
│   │   │   └── history.rs
│   │   ├── sidecar.rs                # yt-dlp sidecar 啟動與管理
│   │   ├── progress.rs               # stdout 進度解析
│   │   ├── error.rs                  # 錯誤型別與分類
│   │   └── main.rs
│   ├── tauri.conf.json
│   └── Cargo.toml
│
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## yt-dlp Sidecar 命名規範

Tauri sidecar 要求執行檔依照目標 triple 命名，並放置於 `src-tauri/binaries/`：

| 平台           | 目標 Triple                       | 檔名                                          |
|--------------|-----------------------------------|-----------------------------------------------|
| Windows x64  | `x86_64-pc-windows-msvc`          | `yt-dlp-x86_64-pc-windows-msvc.exe`           |
| macOS ARM64  | `aarch64-apple-darwin`            | `yt-dlp-aarch64-apple-darwin`                 |
| macOS x86_64 | `x86_64-apple-darwin`             | `yt-dlp-x86_64-apple-darwin`                  |

在 `tauri.conf.json` 中必須宣告：

```json
{
  "bundle": {
    "externalBin": [
      "binaries/yt-dlp"
    ]
  }
}
```

Tauri 在打包時會自動依建構機器的 target triple 選取對應的 `binaries/yt-dlp-<triple>[.exe]`，並將其嵌入最終應用程式包。

---

## Tauri Commands Design

### Command 介面總覽

```rust
// src-tauri/src/commands/mod.rs
pub use parse::parse_video;
pub use download::{start_download, cancel_download};
pub use folder::{select_folder, open_folder};
pub use history::{get_history, delete_history_item, clear_all_history};
```

### 1. `parse_video`

解析影片 Metadata，呼叫 yt-dlp `-J` flag。

```rust
// src-tauri/src/commands/parse.rs
#[tauri::command]
pub async fn parse_video(
    app: tauri::AppHandle,
    url: String,
) -> Result<VideoMetadata, AppError>
```

**呼叫流程：**
1. 以 `Command::new_sidecar("yt-dlp")` 建立 sidecar 實例
2. 傳入 `["--no-warnings", "-J", &url]` 參數
3. 等待 stdout 輸出，解析 JSON → `VideoMetadata`
4. 若 stderr 包含 `login`、`private`、`Sign in` 關鍵字 → 回傳 `AppError::AuthRequired`
5. 其他錯誤 → 回傳 `AppError::YtDlpError(message)`

### 2. `start_download`

建立 Download Task 並以背景 Tokio task 執行下載，透過 Event Emitter 串流進度。

```rust
// src-tauri/src/commands/download.rs
#[tauri::command]
pub async fn start_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, DownloadState>,
    url: String,
    quality: QualityOption,
    output_path: String,
) -> Result<String, AppError>  // 回傳 task_id
```

**呼叫流程：**
1. 生成 UUID 作為 `task_id`
2. 將 task 插入 `DownloadState`（`Arc<Mutex<HashMap<String, DownloadTask>>>>`）
3. Spawn Tokio task，執行 yt-dlp 帶 `--progress-template` 與 `-f` 格式選擇
4. 逐行讀取 stdout，呼叫進度解析器，emit `download://progress` 事件
5. 成功 → emit `download://completed`，寫入 history，觸發系統通知
6. 失敗 → emit `download://failed`，寫入 history

### 3. `cancel_download`

取消指定 task_id 的下載。

```rust
#[tauri::command]
pub async fn cancel_download(
    state: tauri::State<'_, DownloadState>,
    task_id: String,
) -> Result<(), AppError>
```

### 4. `select_folder`

透過 Tauri Dialog Plugin 開啟原生資料夾選取對話框。

```rust
#[tauri::command]
pub async fn select_folder(
    app: tauri::AppHandle,
) -> Result<Option<String>, AppError>
```

### 5. `open_folder`

透過 Tauri Shell Plugin 開啟系統檔案總管並定位目錄。

```rust
#[tauri::command]
pub async fn open_folder(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), AppError>
```

### 6. History Commands

```rust
#[tauri::command]
pub async fn get_history() -> Result<Vec<HistoryRecord>, AppError>

#[tauri::command]
pub async fn delete_history_item(id: String) -> Result<(), AppError>

#[tauri::command]
pub async fn clear_all_history() -> Result<(), AppError>
```

---

## Tauri Event Design

所有事件使用 `download://` 命名空間，由 Backend emit，Frontend 訂閱。

### `download://progress`

```typescript
interface DownloadProgressEvent {
  task_id: string;
  percent: number;        // 0.0 ~ 100.0
  speed: string;          // e.g. "1.23MiB/s"
  speed_bytes: number;    // bytes per second
  eta: string;            // e.g. "00:23"
  eta_seconds: number;
}
```

### `download://completed`

```typescript
interface DownloadCompletedEvent {
  task_id: string;
  file_path: string;
  title: string;
  completed_at: string;   // ISO 8601
}
```

### `download://failed`

```typescript
interface DownloadFailedEvent {
  task_id: string;
  error_type: "NetworkError" | "AuthRequired" | "YtDlpError" | "Unknown";
  message: string;
}
```

---

## yt-dlp 呼叫參數設計

### Metadata 解析

```bash
yt-dlp --no-warnings -J <URL>
```

輸出為完整 JSON，解析 `title`、`thumbnail`、`formats` 欄位。

### 畫質格式選擇（Format Selector）

| Quality Option | yt-dlp `-f` 參數                                    |
|---------------|-----------------------------------------------------|
| 1080p          | `bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]` |
| 720p           | `bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]`  |
| 480p           | `bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]`  |
| 僅音訊 MP3     | `bestaudio/best -x --audio-format mp3`              |

### 進度輸出

使用 `--progress-template` 輸出固定格式，方便 Rust 端以 regex 解析：

```bash
yt-dlp \
  --newline \
  --progress-template "%(progress.status)s %(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s" \
  -f <format_selector> \
  -o "<output_path>/%(title)s.%(ext)s" \
  <URL>
```

輸出範例：
```
downloading  45.3%  1.23MiB/s  00:23
```

---

## Download Progress Parsing

### Rust 端解析（`src-tauri/src/progress.rs`）

```rust
use regex::Regex;

pub struct ProgressInfo {
    pub percent: f64,
    pub speed_str: String,
    pub speed_bytes: u64,
    pub eta_str: String,
    pub eta_seconds: u64,
}

/// 解析 yt-dlp --progress-template 輸出行
pub fn parse_progress_line(line: &str) -> Option<ProgressInfo> {
    // 匹配格式: "downloading  45.3%  1.23MiB/s  00:23"
    let re = Regex::new(
        r"downloading\s+([\d.]+)%\s+([\d.]+\s*(?:KiB|MiB|GiB|B)/s)\s+(\d+:\d+)"
    ).ok()?;
    
    let caps = re.captures(line)?;
    let percent = caps[1].parse::<f64>().ok()?;
    let speed_str = caps[2].to_string();
    let eta_str = caps[3].to_string();
    
    Some(ProgressInfo {
        percent,
        speed_str: speed_str.clone(),
        speed_bytes: parse_speed_to_bytes(&speed_str),
        eta_str: eta_str.clone(),
        eta_seconds: parse_eta_to_seconds(&eta_str),
    })
}

fn parse_speed_to_bytes(speed: &str) -> u64 { /* ... */ }
fn parse_eta_to_seconds(eta: &str) -> u64 { /* ... */ }
```

---

## Error Classification

### Rust 錯誤型別（`src-tauri/src/error.rs`）

```rust
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum AppError {
    #[error("認證失敗：此影片需要登入帳號方可存取")]
    AuthRequired,

    #[error("yt-dlp 錯誤：{0}")]
    YtDlpError(String),

    #[error("網路連線中斷：{0}")]
    NetworkError(String),

    #[error("IO 錯誤：{0}")]
    IoError(String),

    #[error("未知錯誤：{0}")]
    Unknown(String),
}

impl AppError {
    /// 從 yt-dlp stderr 輸出分類錯誤型別
    pub fn from_ytdlp_stderr(stderr: &str) -> Self {
        let s = stderr.to_lowercase();
        if s.contains("login") || s.contains("sign in")
            || s.contains("private") || s.contains("members only")
        {
            AppError::AuthRequired
        } else if s.contains("network") || s.contains("connection")
            || s.contains("timed out") || s.contains("unable to connect")
        {
            AppError::NetworkError(stderr.to_string())
        } else {
            AppError::YtDlpError(stderr.to_string())
        }
    }
}
```

---

## Data Models

### Frontend TypeScript Types（`src/types/index.ts`）

```typescript
// URL 驗證
export type UrlValidationState = "idle" | "valid" | "invalid";

// 影片 Metadata
export interface VideoMetadata {
  title: string;
  thumbnail: string;
  duration: number;           // 秒
  uploader: string;
  availableQualities: QualityOption[];
}

export type QualityOption = "1080p" | "720p" | "480p" | "audio_mp3";

// Download Task（進行中）
export type DownloadStatus =
  | "pending"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadTask {
  id: string;                 // UUID
  url: string;
  title: string;
  thumbnail: string;
  quality: QualityOption;
  outputPath: string;
  status: DownloadStatus;
  percent: number;
  speed: string;
  speedBytes: number;
  etaSeconds: number;
  filePath: string | null;
  errorMessage: string | null;
  errorType: string | null;
  createdAt: string;          // ISO 8601
  completedAt: string | null;
}

// Download History（持久化）
export interface HistoryRecord {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  quality: QualityOption;
  outputPath: string;
  filePath: string | null;
  status: "completed" | "failed" | "cancelled";
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}
```

---

## Vue 3 Frontend State Management（Pinia Stores）

### 1. `useUrlInputStore`（`src/stores/urlInput.ts`）

```typescript
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { validateUrl } from "@/utils/urlValidator";
import type { VideoMetadata, QualityOption } from "@/types";

export const useUrlInputStore = defineStore("urlInput", () => {
  // State
  const url = ref("");
  const validationState = ref<"idle" | "valid" | "invalid">("idle");
  const isParsing = ref(false);
  const metadata = ref<VideoMetadata | null>(null);
  const parseError = ref<{ type: string; message: string } | null>(null);
  const selectedQuality = ref<QualityOption | null>(null);
  const selectedPath = ref<string>("");

  // Getters
  const canParse = computed(
    () => validationState.value === "valid" && !isParsing.value
  );
  const hasMetadata = computed(() => metadata.value !== null);

  // Actions
  function setUrl(value: string) {
    url.value = value;
    if (value === "") {
      validationState.value = "idle";
    } else {
      validationState.value = validateUrl(value) ? "valid" : "invalid";
    }
  }

  async function parseVideo() { /* invoke parse_video */ }
  async function selectFolder() { /* invoke select_folder */ }
  function reset() { /* 清空狀態 */ }

  return {
    url, validationState, isParsing, metadata, parseError,
    selectedQuality, selectedPath, canParse, hasMetadata,
    setUrl, parseVideo, selectFolder, reset,
  };
});
```

### 2. `useDownloadTaskStore`（`src/stores/downloadTask.ts`）

```typescript
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { DownloadTask, QualityOption } from "@/types";

export const useDownloadTaskStore = defineStore("downloadTask", () => {
  // State：以 Map 維護 task_id → DownloadTask
  const tasks = ref<Map<string, DownloadTask>>(new Map());

  // Getters
  const taskList = computed(() =>
    Array.from(tasks.value.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  );
  const activeCount = computed(
    () => taskList.value.filter((t) => t.status === "downloading").length
  );

  // Actions
  async function startDownload(
    url: string,
    quality: QualityOption,
    outputPath: string,
    metadata: { title: string; thumbnail: string }
  ): Promise<string> { /* invoke start_download, return task_id */ }

  function updateProgress(event: DownloadProgressEvent) {
    const task = tasks.value.get(event.task_id);
    if (task) {
      task.percent = event.percent;
      task.speed = event.speed;
      task.speedBytes = event.speed_bytes;
      task.etaSeconds = event.eta_seconds;
      task.status = "downloading";
    }
  }

  function markCompleted(event: DownloadCompletedEvent) { /* ... */ }
  function markFailed(event: DownloadFailedEvent) { /* ... */ }
  async function cancelTask(taskId: string) { /* invoke cancel_download */ }
  function removeTask(taskId: string) { tasks.value.delete(taskId); }

  return {
    tasks, taskList, activeCount,
    startDownload, updateProgress, markCompleted, markFailed,
    cancelTask, removeTask,
  };
});
```

### 3. `useHistoryStore`（`src/stores/history.ts`）

```typescript
import { defineStore } from "pinia";
import { ref } from "vue";
import type { HistoryRecord, QualityOption } from "@/types";

export const useHistoryStore = defineStore("history", () => {
  // State
  const records = ref<HistoryRecord[]>([]);
  const isLoading = ref(false);

  // Actions
  async function loadHistory() { /* invoke get_history */ }
  async function deleteRecord(id: string) { /* invoke delete_history_item */ }
  async function clearAll() { /* invoke clear_all_history */ }

  async function retryDownload(record: HistoryRecord) {
    // 從 downloadTaskStore.startDownload() 用原始參數重新建立
  }

  // 由 downloadTaskStore 呼叫，完成後同步至 history
  function appendRecord(record: HistoryRecord) {
    records.value.unshift(record);
  }

  return { records, isLoading, loadHistory, deleteRecord, clearAll, retryDownload, appendRecord };
});
```

### Store 互動關係

```
useTauriEvents (composable)
  ├── subscribe("download://progress") → downloadTaskStore.updateProgress()
  ├── subscribe("download://completed") → downloadTaskStore.markCompleted()
  │                                     → historyStore.appendRecord()
  └── subscribe("download://failed")   → downloadTaskStore.markFailed()
                                       → historyStore.appendRecord()
```

---

## Download History Persistence

### 儲存格式選擇：JSON

選擇 JSON 檔案儲存（而非 SQLite）理由：
- 歷史記錄量少（數百筆），無需複雜查詢
- 無需額外 Rust crate 依賴，`serde_json` 已為標準依賴
- 便於跨平台除錯與使用者手動檢視

### 儲存路徑

使用 Tauri 的 `app_data_dir()` 取得平台適合路徑：

| 平台    | 路徑                                                              |
|---------|-------------------------------------------------------------------|
| Windows | `%APPDATA%\cross-platform-video-downloader\history.json`          |
| macOS   | `~/Library/Application Support/cross-platform-video-downloader/history.json` |

### JSON Schema

```json
{
  "version": 1,
  "records": [
    {
      "id": "uuid-v4",
      "url": "https://www.youtube.com/watch?v=...",
      "title": "影片標題",
      "thumbnail": "https://...",
      "quality": "1080p",
      "output_path": "/Users/user/Downloads",
      "file_path": "/Users/user/Downloads/影片標題.mp4",
      "status": "completed",
      "error_message": null,
      "created_at": "2024-01-01T00:00:00Z",
      "completed_at": "2024-01-01T00:05:00Z"
    }
  ]
}
```

### Rust 持久化實作

```rust
// src-tauri/src/commands/history.rs
use tauri::Manager;
use std::fs;

pub fn history_path(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir()
        .unwrap()
        .join("history.json")
}

pub fn load_history(app: &tauri::AppHandle) -> Vec<HistoryRecord> {
    let path = history_path(app);
    if !path.exists() { return vec![]; }
    let content = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or_default()
}

pub fn save_history(app: &tauri::AppHandle, records: &[HistoryRecord]) {
    let path = history_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let content = serde_json::to_string_pretty(records).unwrap();
    fs::write(&path, content).ok();
}
```

---

## Tauri v2 Capability 設定

`src-tauri/capabilities/default.json`：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for video downloader",
  "windows": ["main"],
  "permissions": [
    "core:default",

    "shell:allow-execute",
    "shell:allow-open",

    "dialog:allow-open",

    "fs:allow-read",
    "fs:allow-write",
    "fs:allow-read-dir",
    "fs:scope-app-data",
    "fs:scope-download",

    "notification:default"
  ]
}
```

### 各 Plugin 用途說明

| Plugin        | 權限                          | 用途                                    |
|---------------|-------------------------------|----------------------------------------|
| `shell`       | `allow-execute`               | 執行 yt-dlp sidecar                    |
| `shell`       | `allow-open`                  | 開啟系統檔案總管（`open_folder`）        |
| `dialog`      | `allow-open`                  | 開啟原生資料夾選取對話框                 |
| `fs`          | `allow-read/write`            | 讀寫 history.json                      |
| `fs`          | `scope-app-data`              | 限制 fs 存取範圍於 app data 目錄         |
| `fs`          | `scope-download`              | 允許讀取 ~/Downloads 目錄資訊            |
| `notification`| `default`                     | 發送下載完成系統通知                     |

---

## GitHub Actions Matrix Build Workflow

`.github/workflows/release.yml`：

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"

jobs:
  build:
    strategy:
      fail-fast: true    # 任一 matrix 失敗即中止全部，不建立 Draft Release
      matrix:
        include:
          - platform: windows-latest
            target: x86_64-pc-windows-msvc
            yt_dlp_url: https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
            yt_dlp_filename: yt-dlp-x86_64-pc-windows-msvc.exe

          - platform: macos-latest
            target: aarch64-apple-darwin
            yt_dlp_url: https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos
            yt_dlp_filename: yt-dlp-aarch64-apple-darwin

          - platform: macos-latest
            target: x86_64-apple-darwin
            yt_dlp_url: https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos
            yt_dlp_filename: yt-dlp-x86_64-apple-darwin

    runs-on: ${{ matrix.platform }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install Rust target (cross-compile macOS)
        if: matrix.platform == 'macos-latest'
        run: rustup target add ${{ matrix.target }}

      - name: Cache Rust dependencies
        uses: swatinem/rust-cache@v2
        with:
          workspaces: "./src-tauri -> target"

      - name: Install frontend dependencies
        run: npm ci

      # yt-dlp sidecar 預下載步驟
      - name: Download yt-dlp sidecar (Unix)
        if: matrix.platform != 'windows-latest'
        run: |
          mkdir -p src-tauri/binaries
          curl -L "${{ matrix.yt_dlp_url }}" \
            -o "src-tauri/binaries/${{ matrix.yt_dlp_filename }}"
          chmod +x "src-tauri/binaries/${{ matrix.yt_dlp_filename }}"

      - name: Download yt-dlp sidecar (Windows)
        if: matrix.platform == 'windows-latest'
        shell: pwsh
        run: |
          New-Item -ItemType Directory -Force -Path src-tauri/binaries
          Invoke-WebRequest -Uri "${{ matrix.yt_dlp_url }}" `
            -OutFile "src-tauri/binaries/${{ matrix.yt_dlp_filename }}"

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "v__VERSION__"
          releaseBody: "See the assets below to download the installer."
          releaseDraft: true          # Draft Release，需人工確認後公開
          prerelease: false
          args: --target ${{ matrix.target }}
```

### Workflow 設計說明

- `fail-fast: true`：確保任一 matrix 失敗時不建立 Draft Release（符合 Requirements 8.5）
- yt-dlp 每次從 GitHub Releases `latest` 下載：若需固定版本，可將 URL 中 `latest` 替換為特定版本號（如 `download/2024.11.18`）
- macOS 兩個 target 均使用 `yt-dlp_macos` universal binary，亦可依需求使用平台特定版本
- `tauri-action` 自動處理 `.dmg`、`.exe`、`.msi` 產物上傳至 Draft Release

---

## Component Design

### `UrlInputBar.vue`

```
[URL Input Field] [解析影片 Button]
     └── 驗證錯誤訊息（conditional）
```

- 綁定 `urlInputStore.url`，`@input` 呼叫 `setUrl()`
- `解析影片` button 綁定 `：disabled="!canParse || isParsing"`
- 解析中顯示 spinner

### `VideoPreview.vue`

```
[Thumbnail]  影片標題
             上傳者
             [Quality Selector: 1080p | 720p | 480p | MP3]
             [Path Input]  [變更路徑]
             [開始下載 Button]
```

### `DownloadTaskCard.vue`

```
[Thumbnail] 影片標題             [取消]
            畫質 | 儲存路徑
            [Progress Bar ████░░░░░░] 45.3%  1.23MB/s  ETA 00:23
```

完成後：
```
            [Progress Bar ██████████] 100%  已完成
            [開啟檔案位置]
```

失敗後：
```
            ⚠ 錯誤訊息
            [重試]
```

### `HistoryPage.vue`

表格列每行顯示：縮圖、標題、畫質、路徑、完成時間、狀態徽章、操作按鈕（清除 / 重試）。
頂部有「清除全部歷史」按鈕。

---

## URL Validation

`src/utils/urlValidator.ts`：

```typescript
/**
 * 驗證輸入是否為合法的 HTTP/HTTPS URL
 * 使用原生 URL constructor 進行結構驗證，再確認協議為 http/https
 */
export function validateUrl(input: string): boolean {
  if (!input || input.trim() === "") return false;
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: URL 驗證正確性

*For any* 字串輸入，`validateUrl` 函式若回傳 `true` 則該字串必為有效的 HTTP/HTTPS URL；若回傳 `false` 則該字串並非有效的 HTTP/HTTPS URL，且 UI 的「解析影片」按鈕必處於停用狀態。

**Validates: Requirements 1.2, 1.3, 1.4**

### Property 2: yt-dlp 指令參數完整性

*For any* 合法的影音 URL，建構 metadata 擷取指令時，產生的參數陣列必定包含該 URL 字串及 `-J` flag。

**Validates: Requirements 2.1**

### Property 3: Metadata 解析結果完整性

*For any* yt-dlp 成功回傳的 metadata JSON 物件，解析函式必定產生包含非空 `title`、非空 `thumbnail` URL，以及至少一個 `QualityOption` 的 `VideoMetadata` 物件。

**Validates: Requirements 2.3**

### Property 4: yt-dlp stderr 錯誤分類一致性

*For any* yt-dlp stderr 輸出字串，`AppError::from_ytdlp_stderr` 函式必定回傳恰好一個 `AppError` variant；凡包含 `login`、`sign in`、`private`、`members only`（不區分大小寫）的字串必分類為 `AuthRequired`，其餘字串分類為 `NetworkError` 或 `YtDlpError`。

**Validates: Requirements 2.4, 2.5**

### Property 5: 預設選取最高畫質

*For any* 非空的 `QualityOption` 列表，預設畫質選取函式必定回傳優先順序最高的選項（1080p > 720p > 480p > audio_mp3）。

**Validates: Requirements 3.1**

### Property 6: Download Task 建立不可變性

*For any* 合法的（url, quality, outputPath）參數組合，`startDownload` 所建立的 `DownloadTask` 必定具有唯一 UUID、`pending` 初始狀態，且其 `url`、`quality`、`outputPath` 欄位與傳入參數完全一致。

**Validates: Requirements 4.1, 4.2**

### Property 7: 進度事件解析正確性

*For any* 符合 yt-dlp `--progress-template` 輸出格式的字串，`parse_progress_line` 函式必定解析出範圍為 `[0.0, 100.0]` 的 `percent` 值及非負的 `speed_bytes`；不符合格式的字串必定回傳 `None`。

**Validates: Requirements 4.4**

### Property 8: 進度事件驅動 Store 狀態一致性

*For any* 已存在於 `downloadTaskStore` 中的 task_id，接收到對應的 `download://progress` 事件後，該 task 的 `percent`、`speed`、`speedBytes`、`etaSeconds` 欄位必定更新為事件攜帶的數值，且其他 task 的狀態保持不變。

**Validates: Requirements 4.5**

### Property 9: 下載歷史持久化往返一致性

*For any* 狀態為 `completed`、`failed` 或 `cancelled` 的 `DownloadTask`，將其序列化為 `HistoryRecord` 並寫入 JSON 後再讀取，所得物件的 `id`、`url`、`quality`、`outputPath`、`status` 欄位必定與原始值完全相同。

**Validates: Requirements 6.1**

### Property 10: 重試任務參數不變性

*For any* 狀態為 `failed` 或 `cancelled` 的 `HistoryRecord`，對其執行重試所建立的新 `DownloadTask`，其 `url`、`quality`、`outputPath` 欄位必定與原始 `HistoryRecord` 的對應欄位完全相同。

**Validates: Requirements 6.3, 7.3**

### Property 11: 歷史記錄刪除隔離性

*For any* 包含 N 筆（N ≥ 1）記錄的 `HistoryRecord` 列表，刪除其中任意一筆記錄後，列表長度必定為 N-1，且被刪除記錄的 id 不再出現於列表中，其餘 N-1 筆記錄的欄位保持不變。

**Validates: Requirements 6.4**

### Property 12: 下載失敗狀態轉換正確性

*For any* 狀態為 `downloading` 的 `DownloadTask`，接收到 `download://failed` 事件後，該 task 的 `status` 必定轉換為 `failed`，且 `errorMessage` 欄位攜帶非空字串；其他 task 的狀態保持不變。

**Validates: Requirements 7.1, 7.2**
