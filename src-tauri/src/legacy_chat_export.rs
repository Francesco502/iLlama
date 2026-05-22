use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs, io,
    path::{Path, PathBuf},
};

const LEGACY_EXPORT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyChatHistoryIndex {
    #[allow(dead_code)]
    schema_version: Option<u32>,
    conversations: Vec<LegacyConversationSummary>,
}

#[derive(Debug, Deserialize)]
struct LegacyConversationSummary {
    id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyChatHistoryExport {
    schema_version: u32,
    source: &'static str,
    exported_at: String,
    conversations: Vec<Value>,
    missing_conversation_ids: Vec<String>,
}

pub fn export_legacy_chat_history(app_data_dir: &Path) -> io::Result<String> {
    let index = load_legacy_index(app_data_dir)?;
    let mut conversations = Vec::new();
    let mut missing_conversation_ids = Vec::new();

    for summary in index.conversations {
        validate_conversation_id(&summary.id)?;
        let path = conversation_path(app_data_dir, &summary.id);
        if !path.exists() {
            missing_conversation_ids.push(summary.id);
            continue;
        }

        let content = fs::read_to_string(path)?;
        conversations.push(serde_json::from_str(&content).map_err(invalid_data)?);
    }

    if conversations.is_empty() && missing_conversation_ids.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "未找到可导出的 V2 聊天历史",
        ));
    }

    let export = LegacyChatHistoryExport {
        schema_version: LEGACY_EXPORT_SCHEMA_VERSION,
        source: "iLlama V2 chat-history",
        exported_at: chrono::Utc::now().to_rfc3339(),
        conversations,
        missing_conversation_ids,
    };
    let path = export_path(app_data_dir);
    ensure_parent(&path)?;
    fs::write(
        &path,
        serde_json::to_vec_pretty(&export).map_err(invalid_data)?,
    )?;

    Ok(path.to_string_lossy().to_string())
}

fn load_legacy_index(app_data_dir: &Path) -> io::Result<LegacyChatHistoryIndex> {
    let path = index_path(app_data_dir);
    if !path.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "未找到 V2 聊天历史索引",
        ));
    }

    let content = fs::read_to_string(path)?;
    serde_json::from_str(&content).map_err(invalid_data)
}

fn legacy_chat_history_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("chat-history")
}

fn index_path(app_data_dir: &Path) -> PathBuf {
    legacy_chat_history_dir(app_data_dir).join("index.json")
}

fn conversation_path(app_data_dir: &Path, id: &str) -> PathBuf {
    legacy_chat_history_dir(app_data_dir)
        .join("conversations")
        .join(format!("{id}.json"))
}

fn export_path(app_data_dir: &Path) -> PathBuf {
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    legacy_chat_history_dir(app_data_dir)
        .join("exports")
        .join(format!("legacy-chat-history-{timestamp}.json"))
}

fn validate_conversation_id(id: &str) -> io::Result<()> {
    let valid = !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if valid {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid conversation id",
        ))
    }
}

fn ensure_parent(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn invalid_data(error: impl std::error::Error + Send + Sync + 'static) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error)
}
