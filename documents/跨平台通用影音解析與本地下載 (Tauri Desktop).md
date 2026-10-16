# Feature: 跨平台通用影音解析與本地下載 (Tauri Desktop App)

  As a 資料分析師
  I want to 在桌面應用程式中貼上任意影音平台的網址
  So that 我可以自動解析影片資訊並下載高畫質影片至本地資料夾進行分析

  Background:
    Given 使用者已開啟 Tauri 桌面應用程式
    And 應用程式內建之 `yt-dlp` Sidecar 核心已正常載入

  Scenario: 成功動態解析任意平台影片網址
    Given 使用者在網址輸入框輸入未限定平台的有效影片 URL "https://x.com/example/status/123456789"
    When 使用者點擊「解析影片」按鈕
    Then 系統應透過 `yt-dlp` Sidecar 執行背景解析作業
    And 系統應於前端介面顯示解析結果，包含：
      | 欄位       | 內容範例                           |
      | 影片標題   | 範例影片標題                       |
      | 封面預覽圖 | 影片縮圖                           |
      | 可選畫質   | [1080p, 720p, 480p, 僅音訊 (MP3)]  |
      | 預設儲存路徑| C:\Users\User\Downloads (或 Mac 預設 Downloads 路徑) |

  Scenario: 選擇畫質並成功下載至指定本地路徑
    Given 使用者已成功解析影片資訊
    When 使用者選擇畫質 "1080p"
    And 使用者點擊「選擇儲存路徑」並指定資料夾 "/Users/analytics/videos"
    And 使用者點擊「開始下載」按鈕
    Then 系統應呼叫 `yt-dlp` 開始執行下載與音視流合併作業
    And 前端介面應即時更新並顯示下載進度條（包含百分比與下載速度）
    When 下載完成
    Then 系統應跳出「下載完成」提示
    And 介面應提供「開啟檔案位置」按鈕，點擊後開啟系統檔案總管並定位該檔案

  Scenario: 輸入不支援或無法讀取的無效網址
    Given 使用者在網址輸入框輸入無效或損壞的 URL "https://invalid-domain.com/test"
    When 使用者點擊「解析影片」按鈕
    Then 系統應捕捉 `yt-dlp` 回傳之錯誤代碼
    And 系統應顯示錯誤訊息 "無法解析該網址，請確認網址格式是否正確或該內容是否已被刪除"
    And 系統應停用「開始下載」按鈕

  Scenario: 解析權限受限或私人影片
    Given 使用者輸入需要權限或登入的影片 URL "https://x.com/private_user/status/987654321"
    When 使用者點擊「解析影片」按鈕
    Then 系統應辨識出權限異常
    And 系統應顯示提示訊息 "該內容為私人影片或需要登入驗證，無法直接取得串流"

  Scenario: 下載過程中網路中斷或下載失敗
    Given 使用者正在下載影片，進度顯示為 45%
    When 本機網路連線中斷或伺服器連線逾時
    Then 系統應中斷下載作業
    And 系統應顯示「下載失敗：網路連線中斷」警告
    And 系統應顯示「重新嘗試」按鈕，允許使用者重新發起下載

# Feature: 自動化跨平台打包與發佈 (GitHub Actions CI/CD)

  As a 軟體開發者
  I want to 推送版本 Tag 至 GitHub 儲存庫
  So that 系統能自動編譯出 Windows 與 Mac 的最新安裝檔並更新至 Releases 頁面

  Scenario: 推送版本 Tag 觸發跨平台自動打包
    Given 開發者已完成程式碼修改並更新 `tauri.conf.json` 中的版本號為 "1.0.0"
    When 開發者推送 Git Tag "v1.0.0" 至 GitHub 儲存庫
    Then GitHub Actions 應自動啟動打包工作流程
    And 系統應分別於 `windows-latest` 與 `macos-latest` 虛擬機環境進行編譯
    When 編譯完成
    Then GitHub Actions 應於 Releases 頁面自動建立 "v1.0.0" 的 Draft Release
    And Release 附件中應包含以下平台安裝包：
      | 檔案類型        | 適用平台                      |
      | `.exe` / `.msi` | Windows x64                 |
      | `.dmg`          | macOS (Apple Silicon aarch64)|
      | `.dmg`          | macOS (Intel x86_64)         |