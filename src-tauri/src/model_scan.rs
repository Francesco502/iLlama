use crate::gguf::read_gguf_metadata;
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
    Unreadable,
    Pending,
}

pub fn scan_model_directory(path: &Path) -> io::Result<Vec<ModelEntry>> {
    let root = fs::canonicalize(path)?;
    let mut model_paths = Vec::new();
    let mut mmproj_paths = Vec::new();
    let mut models = Vec::new();

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_hidden_dir(entry))
    {
        let entry = entry?;
        if !entry.file_type().is_file() || !is_gguf(entry.path()) {
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
        models.push(read_model_entry(&root, &path, candidates)?);
    }

    models.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(models)
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

    let gguf = read_gguf_metadata(path);
    let (metadata_status, metadata_error, gguf_metadata) = match gguf {
        Ok(metadata) => (MetadataStatus::Ready, None, Some(metadata)),
        Err(error) => (MetadataStatus::Unreadable, Some(error.to_string()), None),
    };

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
        available: true,
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
