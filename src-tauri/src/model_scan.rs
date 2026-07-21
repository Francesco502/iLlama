use crate::gguf::{inspect_gguf, GgufStatus};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use walkdir::{DirEntry, WalkDir};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub path: String,
    pub file_name: String,
    pub directory: String,
    pub size_bytes: u64,
    pub modified_at: String,
    pub architecture: Option<String>,
    pub quantization: Option<String>,
    pub context_length: Option<u64>,
    pub parameter_count: Option<String>,
    pub metadata_status: MetadataStatus,
    pub metadata_error: Option<String>,
    pub available: bool,
    pub mmproj_candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MetadataStatus {
    Ready,
    Limited,
    Invalid,
}

pub fn scan_model_directory(path: &Path) -> io::Result<Vec<ModelEntry>> {
    scan_model_directory_with_progress(path, String::new(), |_| {}).map(|result| result.models)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelScanResult {
    pub request_id: String,
    pub directory: String,
    pub models: Vec<ModelEntry>,
    /// Regular files visited by the directory walker, including non-GGUF and mmproj files.
    pub files_scanned: u64,
    /// Available non-mmproj GGUF models. Invalid candidates are not counted as found models.
    pub models_found: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelScanProgress {
    pub request_id: String,
    pub directory: String,
    pub files_scanned: u64,
    pub models_found: u64,
}

pub fn scan_model_directory_with_progress(
    path: &Path,
    request_id: String,
    mut on_progress: impl FnMut(&ModelScanProgress),
) -> io::Result<ModelScanResult> {
    let directory = path.to_string_lossy().to_string();
    let root = fs::canonicalize(path)?;
    let mut model_paths = Vec::new();
    let mut mmproj_paths = Vec::new();
    let mut models = Vec::new();
    let mut progress = ModelScanProgress {
        request_id: request_id.clone(),
        directory: directory.clone(),
        files_scanned: 0,
        models_found: 0,
    };
    on_progress(&progress);

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_hidden_dir(entry))
    {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        progress.files_scanned = progress.files_scanned.saturating_add(1);
        on_progress(&progress);
        if !is_gguf(entry.path()) {
            continue;
        }

        if is_mmproj_file(entry.path()) {
            mmproj_paths.push(entry.path().to_path_buf());
        } else {
            model_paths.push(entry.path().to_path_buf());
        }
    }

    for path in model_paths {
        let candidates = mmproj_candidates_for_model(&path, &mmproj_paths);
        match read_model_entry(&root, &path, candidates.clone()) {
            Ok(entry) => {
                if entry.available {
                    progress.models_found = progress.models_found.saturating_add(1);
                }
                models.push(entry);
            }
            Err(error) => {
                let file_name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("model.gguf")
                    .to_string();
                let directory = parent_or_root(&path, &root).to_string_lossy().to_string();

                models.push(ModelEntry {
                    path: path.to_string_lossy().to_string(),
                    file_name,
                    directory,
                    size_bytes: fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
                    modified_at: fs::metadata(&path)
                        .and_then(|m| m.modified())
                        .map(chrono::DateTime::<chrono::Utc>::from)
                        .unwrap_or_else(|_| chrono::Utc::now())
                        .to_rfc3339(),
                    architecture: None,
                    quantization: None,
                    context_length: None,
                    parameter_count: None,
                    metadata_status: MetadataStatus::Invalid,
                    metadata_error: Some(error.to_string()),
                    available: false,
                    mmproj_candidates: candidates,
                });
            }
        }
        on_progress(&progress);
    }

    models.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(ModelScanResult {
        request_id,
        directory,
        models,
        files_scanned: progress.files_scanned,
        models_found: progress.models_found,
    })
}

fn read_model_entry(
    root: &Path,
    path: &Path,
    mmproj_candidates: Vec<String>,
) -> io::Result<ModelEntry> {
    let metadata = fs::metadata(path)?;
    let modified_at = metadata
        .modified()
        .map(DateTime::<Utc>::from)
        .unwrap_or_else(|_| Utc::now())
        .to_rfc3339();

    let inspection = inspect_gguf(path);
    let (metadata_status, available) = match inspection.status {
        GgufStatus::Ready => (MetadataStatus::Ready, true),
        GgufStatus::Limited => (MetadataStatus::Limited, true),
        GgufStatus::Invalid => (MetadataStatus::Invalid, false),
    };
    let metadata_error = inspection.warning;
    let gguf_metadata = inspection.metadata;

    Ok(ModelEntry {
        path: path.to_string_lossy().to_string(),
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("model.gguf")
            .to_string(),
        directory: parent_or_root(path, root).to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        modified_at,
        architecture: gguf_metadata
            .as_ref()
            .and_then(|metadata| metadata.architecture.clone()),
        quantization: gguf_metadata
            .as_ref()
            .and_then(|metadata| metadata.quantization.clone()),
        context_length: gguf_metadata
            .as_ref()
            .and_then(|metadata| metadata.context_length),
        parameter_count: gguf_metadata.and_then(|metadata| metadata.parameter_count),
        metadata_status,
        metadata_error,
        available,
        mmproj_candidates,
    })
}

fn is_gguf(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("gguf"))
        .unwrap_or(false)
}

fn is_mmproj_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase().contains("mmproj"))
        .unwrap_or(false)
}

fn mmproj_candidates_for_model(model_path: &Path, mmproj_paths: &[PathBuf]) -> Vec<String> {
    let model_directory = model_path.parent();
    let mut candidates: Vec<String> = mmproj_paths
        .iter()
        .filter(|path| path.parent() == model_directory)
        .map(|path| path.to_string_lossy().to_string())
        .collect();
    candidates.sort();
    candidates
}

fn is_hidden_dir(entry: &DirEntry) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_dir() {
        return false;
    }
    entry
        .file_name()
        .to_str()
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}

fn parent_or_root<'a>(path: &'a Path, root: &'a Path) -> PathBuf {
    path.parent().unwrap_or(root).to_path_buf()
}
