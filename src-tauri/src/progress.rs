use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ProgressInfo {
    pub percent: f64,
    pub speed_str: String,
    pub speed_bytes: u64,
    pub eta_str: String,
    pub eta_seconds: u64,
}

/// 解析 yt-dlp stdout 進度行，回傳 ProgressInfo。
/// 不符合格式的行回傳 None。
///
/// 支援兩種格式：
/// 1. `--progress-template` 輸出: "downloading  45.3%  1.23MiB/s  00:23"
/// 2. 標準 `[download]` 輸出: "[download]  45.3% of ~100.00MiB at    1.23MiB/s ETA 00:23"
pub fn parse_progress_line(line: &str) -> Option<ProgressInfo> {
    // 先嘗試匹配 --progress-template 格式
    // 格式: "downloading  45.3%  1.23MiB/s  00:23"
    let template_re = Regex::new(
        r"downloading\s+([\d.]+)%\s+([\d.]+\s*(?:KiB|MiB|GiB|B)/s)\s+([\d:]+)"
    )
    .ok()?;

    if let Some(caps) = template_re.captures(line) {
        let percent: f64 = caps.get(1)?.as_str().parse().ok()?;
        let speed_str = caps.get(2)?.as_str().trim().to_string();
        let eta_str = caps.get(3)?.as_str().to_string();

        return Some(ProgressInfo {
            percent,
            speed_bytes: parse_speed_to_bytes(&speed_str),
            speed_str,
            eta_seconds: parse_eta_to_seconds(&eta_str),
            eta_str,
        });
    }

    // 再嘗試匹配標準 [download] 格式
    // 格式: "[download]  45.3% of ~100.00MiB at    1.23MiB/s ETA 00:23"
    let download_re = Regex::new(
        r"\[download\]\s+([\d.]+)%\s+of\s+~?[\d.]+\s*\w+\s+at\s+([\d.]+\s*(?:KiB|MiB|GiB|KB|MB|GB|B)/s)\s+ETA\s+([\d:]+)"
    )
    .ok()?;

    if let Some(caps) = download_re.captures(line) {
        let percent: f64 = caps.get(1)?.as_str().parse().ok()?;
        let speed_str = caps.get(2)?.as_str().trim().to_string();
        let eta_str = caps.get(3)?.as_str().to_string();

        return Some(ProgressInfo {
            percent,
            speed_bytes: parse_speed_to_bytes(&speed_str),
            speed_str,
            eta_seconds: parse_eta_to_seconds(&eta_str),
            eta_str,
        });
    }

    None
}

/// 將速度字串（如 "1.23MiB/s"、"456KiB/s"、"2.00GiB/s"）轉換為每秒位元組數。
/// 無法解析時回傳 0。
pub fn parse_speed_to_bytes(speed: &str) -> u64 {
    let re = match Regex::new(r"([\d.]+)\s*([\w]+)/s") {
        Ok(r) => r,
        Err(_) => return 0,
    };

    let caps = match re.captures(speed) {
        Some(c) => c,
        None => return 0,
    };

    let value: f64 = match caps.get(1).and_then(|m| m.as_str().parse().ok()) {
        Some(v) => v,
        None => return 0,
    };

    let unit = caps
        .get(2)
        .map(|m| m.as_str().to_uppercase())
        .unwrap_or_default();

    let multiplier: u64 = match unit.as_str() {
        "B" => 1,
        "KIB" => 1024,
        "MIB" => 1024 * 1024,
        "GIB" => 1024 * 1024 * 1024,
        "KB" => 1000,
        "MB" => 1000 * 1000,
        "GB" => 1000 * 1000 * 1000,
        _ => 1,
    };

    (value * multiplier as f64) as u64
}

/// 將 ETA 字串（如 "00:23"、"1:23:45"）轉換為總秒數。
/// 無法解析時回傳 0。
pub fn parse_eta_to_seconds(eta: &str) -> u64 {
    let parts: Vec<&str> = eta.split(':').collect();
    match parts.len() {
        2 => {
            let mins: u64 = parts[0].parse().unwrap_or(0);
            let secs: u64 = parts[1].parse().unwrap_or(0);
            mins * 60 + secs
        }
        3 => {
            let hours: u64 = parts[0].parse().unwrap_or(0);
            let mins: u64 = parts[1].parse().unwrap_or(0);
            let secs: u64 = parts[2].parse().unwrap_or(0);
            hours * 3600 + mins * 60 + secs
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_progress_line ──────────────────────────────────────────────────

    #[test]
    fn test_parse_template_format() {
        let line = "downloading  45.3%  1.23MiB/s  00:23";
        let info = parse_progress_line(line).expect("should parse template format");
        assert!((info.percent - 45.3).abs() < f64::EPSILON);
        assert_eq!(info.speed_str, "1.23MiB/s");
        assert_eq!(info.eta_str, "00:23");
        assert_eq!(info.eta_seconds, 23);
    }

    #[test]
    fn test_parse_download_bracket_format() {
        let line = "[download]  45.3% of ~100.00MiB at    1.23MiB/s ETA 00:23";
        let info = parse_progress_line(line).expect("should parse [download] format");
        assert!((info.percent - 45.3).abs() < f64::EPSILON);
        assert_eq!(info.speed_str, "1.23MiB/s");
        assert_eq!(info.eta_str, "00:23");
    }

    #[test]
    fn test_parse_progress_100_percent() {
        let line = "downloading  100.0%  5.00MiB/s  00:00";
        let info = parse_progress_line(line).expect("should parse 100%");
        assert!((info.percent - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_progress_zero_percent() {
        let line = "downloading  0.0%  512KiB/s  01:30";
        let info = parse_progress_line(line).expect("should parse 0%");
        assert!((info.percent - 0.0).abs() < f64::EPSILON);
        assert_eq!(info.eta_seconds, 90);
    }

    #[test]
    fn test_parse_invalid_line_returns_none() {
        assert!(parse_progress_line("").is_none());
        assert!(parse_progress_line("some random text").is_none());
        assert!(parse_progress_line("[download] Destination: video.mp4").is_none());
        assert!(parse_progress_line("[info] Downloading webpage").is_none());
    }

    #[test]
    fn test_parse_non_progress_yt_dlp_lines() {
        assert!(parse_progress_line("[youtube] Extracting URL: https://youtu.be/...").is_none());
        assert!(parse_progress_line("[Merger] Merging formats").is_none());
        assert!(parse_progress_line("ERROR: Video unavailable").is_none());
    }

    // ── parse_speed_to_bytes ─────────────────────────────────────────────────

    #[test]
    fn test_speed_kib_per_second() {
        assert_eq!(parse_speed_to_bytes("512KiB/s"), 512 * 1024);
    }

    #[test]
    fn test_speed_mib_per_second() {
        assert_eq!(parse_speed_to_bytes("1.23MiB/s"), (1.23 * 1024.0 * 1024.0) as u64);
    }

    #[test]
    fn test_speed_gib_per_second() {
        let expected = (2.0_f64 * 1024.0 * 1024.0 * 1024.0) as u64;
        assert_eq!(parse_speed_to_bytes("2.00GiB/s"), expected);
    }

    #[test]
    fn test_speed_bytes_per_second() {
        assert_eq!(parse_speed_to_bytes("1024B/s"), 1024);
    }

    #[test]
    fn test_speed_kb_per_second() {
        assert_eq!(parse_speed_to_bytes("500KB/s"), 500 * 1000);
    }

    #[test]
    fn test_speed_mb_per_second() {
        assert_eq!(parse_speed_to_bytes("2MB/s"), 2 * 1000 * 1000);
    }

    #[test]
    fn test_speed_invalid_returns_zero() {
        assert_eq!(parse_speed_to_bytes(""), 0);
        assert_eq!(parse_speed_to_bytes("N/A"), 0);
        assert_eq!(parse_speed_to_bytes("unknown"), 0);
    }

    // ── parse_eta_to_seconds ─────────────────────────────────────────────────

    #[test]
    fn test_eta_mm_ss() {
        assert_eq!(parse_eta_to_seconds("00:23"), 23);
        assert_eq!(parse_eta_to_seconds("01:30"), 90);
        assert_eq!(parse_eta_to_seconds("10:00"), 600);
    }

    #[test]
    fn test_eta_hh_mm_ss() {
        assert_eq!(parse_eta_to_seconds("1:23:45"), 1 * 3600 + 23 * 60 + 45);
        assert_eq!(parse_eta_to_seconds("00:01:00"), 60);
        assert_eq!(parse_eta_to_seconds("2:00:00"), 7200);
    }

    #[test]
    fn test_eta_zero() {
        assert_eq!(parse_eta_to_seconds("00:00"), 0);
    }

    #[test]
    fn test_eta_invalid_returns_zero() {
        assert_eq!(parse_eta_to_seconds(""), 0);
        assert_eq!(parse_eta_to_seconds("N/A"), 0);
        assert_eq!(parse_eta_to_seconds("unknown"), 0);
    }

    // ── speed_bytes 整合驗證（透過 parse_progress_line）───────────────────────

    #[test]
    fn test_speed_bytes_populated_in_progress_info() {
        let line = "downloading  50.0%  2.00MiB/s  00:30";
        let info = parse_progress_line(line).unwrap();
        let expected = (2.0_f64 * 1024.0 * 1024.0) as u64;
        assert_eq!(info.speed_bytes, expected);
    }
}
