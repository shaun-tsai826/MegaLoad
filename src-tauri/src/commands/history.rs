use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AppError;
use crate::models::HistoryRecord;

const HISTORY_VERSION: u32 = 1;

/// On-disk layout of `history.json`: `{ "version": 1, "records": [...] }`.
/// Records are stored newest first.
#[derive(Debug, Serialize, Deserialize)]
struct HistoryFile {
    version: u32,
    records: Vec<HistoryRecord>,
}

/// Owns `history.json` and serializes every read-modify-write on it.
///
/// Several downloads can finish at the same time; holding `lock` across the
/// whole load → modify → save sequence keeps one writer from dropping
/// another's record.
pub struct HistoryState {
    path: PathBuf,
    lock: Mutex<()>,
}

impl HistoryState {
    /// `path` is normally `app_data_dir()/history.json`.
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    /// Returns all records, newest first.
    pub fn list(&self) -> Result<Vec<HistoryRecord>, AppError> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        load_records(&self.path)
    }

    /// Inserts `record` at the front of the history.
    pub fn append(&self, record: HistoryRecord) -> Result<(), AppError> {
        self.modify(|records| records.insert(0, record))
    }

    /// Removes the record with the given id. Unknown ids are ignored.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        self.modify(|records| records.retain(|r| r.id != id))
    }

    pub fn clear(&self) -> Result<(), AppError> {
        self.modify(Vec::clear)
    }

    fn modify(&self, f: impl FnOnce(&mut Vec<HistoryRecord>)) -> Result<(), AppError> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut records = load_records(&self.path)?;
        f(&mut records);
        save_records(&self.path, records)
    }
}

/// Reads the history file. A missing file is an empty history; an unreadable
/// one is moved aside to `history.json.bak` so the next save does not destroy it.
fn load_records(path: &Path) -> Result<Vec<HistoryRecord>, AppError> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(AppError::IoError(e.to_string())),
    };
    match serde_json::from_str::<HistoryFile>(&content) {
        Ok(file) => Ok(file.records),
        Err(e) => {
            eprintln!("history.json 格式錯誤，已備份為 history.json.bak：{e}");
            fs::rename(path, path.with_extension("json.bak"))
                .map_err(|e| AppError::IoError(e.to_string()))?;
            Ok(Vec::new())
        }
    }
}

/// Writes to a temporary file and renames it over `path`, so a crash mid-write
/// never leaves a truncated history.
fn save_records(path: &Path, records: Vec<HistoryRecord>) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::IoError(e.to_string()))?;
    }
    let file = HistoryFile {
        version: HISTORY_VERSION,
        records,
    };
    let content =
        serde_json::to_string_pretty(&file).map_err(|e| AppError::IoError(e.to_string()))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| AppError::IoError(e.to_string()))?;
    fs::rename(&tmp, path).map_err(|e| AppError::IoError(e.to_string()))
}

#[tauri::command]
pub async fn get_history(state: State<'_, HistoryState>) -> Result<Vec<HistoryRecord>, AppError> {
    state.list()
}

#[tauri::command]
pub async fn delete_history_item(
    state: State<'_, HistoryState>,
    id: String,
) -> Result<(), AppError> {
    state.delete(&id)
}

#[tauri::command]
pub async fn clear_all_history(state: State<'_, HistoryState>) -> Result<(), AppError> {
    state.clear()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::QualityOption;
    use std::sync::Arc;

    /// A fresh, not-yet-created history path in its own temp directory.
    fn temp_history() -> (PathBuf, HistoryState) {
        let dir = std::env::temp_dir().join(format!("megaload-test-{}", uuid::Uuid::new_v4()));
        let path = dir.join("history.json");
        (path.clone(), HistoryState::new(path))
    }

    fn record(id: &str) -> HistoryRecord {
        HistoryRecord {
            id: id.to_string(),
            url: "https://example.com/v".to_string(),
            title: format!("title {id}"),
            thumbnail: String::new(),
            quality: QualityOption::Q720p,
            output_path: "/out".to_string(),
            file_path: None,
            status: "failed".to_string(),
            error_message: Some("err".to_string()),
            created_at: "2026-10-16T00:00:00Z".to_string(),
            completed_at: None,
        }
    }

    fn ids(state: &HistoryState) -> Vec<String> {
        state.list().unwrap().into_iter().map(|r| r.id).collect()
    }

    #[test]
    fn missing_file_is_empty_history() {
        let (_, state) = temp_history();
        assert!(state.list().unwrap().is_empty());
    }

    #[test]
    fn append_puts_newest_first_and_persists() {
        let (path, state) = temp_history();
        state.append(record("a")).unwrap();
        state.append(record("b")).unwrap();
        assert_eq!(ids(&state), ["b", "a"]);
        // A new state on the same path sees the same records.
        assert_eq!(ids(&HistoryState::new(path)), ["b", "a"]);
    }

    #[test]
    fn file_has_version_and_camel_case_records() {
        let (path, state) = temp_history();
        state.append(record("a")).unwrap();
        let json: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(json["version"], 1);
        assert_eq!(json["records"][0]["outputPath"], "/out");
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn delete_removes_only_matching_record() {
        let (_, state) = temp_history();
        for id in ["a", "b", "c"] {
            state.append(record(id)).unwrap();
        }
        state.delete("b").unwrap();
        assert_eq!(ids(&state), ["c", "a"]);
        state.delete("missing").unwrap();
        assert_eq!(ids(&state), ["c", "a"]);
    }

    #[test]
    fn clear_empties_history() {
        let (_, state) = temp_history();
        state.append(record("a")).unwrap();
        state.clear().unwrap();
        assert!(state.list().unwrap().is_empty());
    }

    #[test]
    fn corrupt_file_is_backed_up_not_overwritten() {
        let (path, state) = temp_history();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "not json").unwrap();
        state.append(record("a")).unwrap();
        assert_eq!(ids(&state), ["a"]);
        assert_eq!(
            fs::read_to_string(path.with_extension("json.bak")).unwrap(),
            "not json"
        );
    }

    #[test]
    fn concurrent_appends_keep_every_record() {
        let (_, state) = temp_history();
        let state = Arc::new(state);
        let handles: Vec<_> = (0..16)
            .map(|i| {
                let state = Arc::clone(&state);
                std::thread::spawn(move || state.append(record(&i.to_string())).unwrap())
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(state.list().unwrap().len(), 16);
    }
}
