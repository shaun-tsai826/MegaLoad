#!/usr/bin/env bash
# 下載 yt-dlp 與 ffmpeg sidecar 至 src-tauri/binaries/，並依 Tauri 規範以 target triple 命名。
#
# 用法：
#   bash scripts/fetch-sidecars.sh                       # 依本機 rustc host triple 自動判斷
#   bash scripts/fetch-sidecars.sh x86_64-apple-darwin   # 指定 target（CI 用）
#
# 版本固定於下方；要升級時修改這兩個變數，或以環境變數覆寫：
#   YTDLP_VERSION=2026.08.19 FFMPEG_STATIC_TAG=b6.1.1 bash scripts/fetch-sidecars.sh
set -euo pipefail

YTDLP_VERSION="${YTDLP_VERSION:-2026.08.19}"
FFMPEG_STATIC_TAG="${FFMPEG_STATIC_TAG:-b6.1.1}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"

if [[ $# -ge 1 ]]; then
  TRIPLE="$1"
else
  if ! command -v rustc >/dev/null 2>&1; then
    echo "找不到 rustc，請先安裝 Rust 或以參數指定 target triple。" >&2
    exit 1
  fi
  TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
fi

case "$TRIPLE" in
  aarch64-apple-darwin)
    YTDLP_ASSET="yt-dlp_macos";  FFMPEG_ASSET="ffmpeg-darwin-arm64"; EXT="" ;;
  x86_64-apple-darwin)
    YTDLP_ASSET="yt-dlp_macos";  FFMPEG_ASSET="ffmpeg-darwin-x64";   EXT="" ;;
  x86_64-pc-windows-msvc)
    YTDLP_ASSET="yt-dlp.exe";    FFMPEG_ASSET="ffmpeg-win32-x64";    EXT=".exe" ;;
  *)
    echo "不支援的 target triple：$TRIPLE" >&2
    exit 1 ;;
esac

YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${YTDLP_ASSET}"
FFMPEG_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_STATIC_TAG}/${FFMPEG_ASSET}.gz"

YTDLP_OUT="$BIN_DIR/yt-dlp-${TRIPLE}${EXT}"
FFMPEG_OUT="$BIN_DIR/ffmpeg-${TRIPLE}${EXT}"

mkdir -p "$BIN_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▶ target：$TRIPLE"

echo "▶ 下載 yt-dlp ${YTDLP_VERSION}（${YTDLP_ASSET}）"
curl -fL --retry 3 --progress-bar "$YTDLP_URL" -o "$TMP/yt-dlp"
mv -f "$TMP/yt-dlp" "$YTDLP_OUT"
chmod +x "$YTDLP_OUT"

echo "▶ 下載 ffmpeg（ffmpeg-static ${FFMPEG_STATIC_TAG}，${FFMPEG_ASSET}）"
curl -fL --retry 3 --progress-bar "$FFMPEG_URL" -o "$TMP/ffmpeg.gz"
gunzip -c "$TMP/ffmpeg.gz" > "$TMP/ffmpeg"
mv -f "$TMP/ffmpeg" "$FFMPEG_OUT"
chmod +x "$FFMPEG_OUT"

# macOS：移除可能的隔離屬性，避免 Gatekeeper 擋下執行
if [[ "$(uname -s)" == "Darwin" ]]; then
  xattr -d com.apple.quarantine "$YTDLP_OUT" "$FFMPEG_OUT" 2>/dev/null || true
fi

# 若下載的是本機可執行的版本，順便驗證
HOST_TRIPLE="$(rustc -vV 2>/dev/null | sed -n 's/^host: //p' || true)"
if [[ "$TRIPLE" == "$HOST_TRIPLE" ]]; then
  echo "▶ 驗證（yt-dlp 第一次啟動需要解壓，會花幾秒）"
  echo "  yt-dlp：$("$YTDLP_OUT" --version)"
  echo "  ffmpeg：$("$FFMPEG_OUT" -version | head -n 1)"
fi

echo "✔ 完成："
ls -lh "$YTDLP_OUT" "$FFMPEG_OUT"
