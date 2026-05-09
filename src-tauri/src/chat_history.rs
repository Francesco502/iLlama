use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatConversationSummary {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub pinned: bool,
    pub archived: bool,
    pub message_count: usize,
    pub last_message_preview: String,
    pub model_path: Option<String>,
    pub model_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryIndex {
    pub schema_version: u32,
    pub conversations: Vec<ChatConversationSummary>,
}

pub fn chat_history_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("chat-history")
}

pub fn load_chat_history_index(app_data_dir: &Path) -> io::Result<ChatHistoryIndex> {
    let path = index_path(app_data_dir);
    if !path.exists() {
        return Ok(empty_index());
    }

    let content = fs::read_to_string(path)?;
    serde_json::from_str(&content).map_err(invalid_data)
}

pub fn load_chat_conversation(app_data_dir: &Path, id: &str) -> io::Result<Option<Value>> {
    validate_conversation_id(id)?;
    let path = conversation_path(app_data_dir, id);
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path)?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(invalid_data)
}

pub fn save_chat_conversation(
    app_data_dir: &Path,
    conversation: &Value,
) -> io::Result<ChatHistoryIndex> {
    let summary = summary_from_conversation(conversation)?;
    validate_conversation_id(&summary.id)?;

    let path = conversation_path(app_data_dir, &summary.id);
    write_json_atomic(&path, conversation)?;

    let mut index = load_chat_history_index(app_data_dir)?;
    index.conversations.retain(|item| item.id != summary.id);
    index.conversations.push(summary);
    sort_conversation_summaries(&mut index.conversations);
    save_chat_history_index(app_data_dir, &index)?;
    Ok(index)
}

pub fn delete_chat_conversation(app_data_dir: &Path, id: &str) -> io::Result<ChatHistoryIndex> {
    validate_conversation_id(id)?;
    let path = conversation_path(app_data_dir, id);
    if path.exists() {
        fs::remove_file(path)?;
    }

    let mut index = load_chat_history_index(app_data_dir)?;
    index.conversations.retain(|item| item.id != id);
    save_chat_history_index(app_data_dir, &index)?;
    Ok(index)
}

pub fn clear_chat_history(app_data_dir: &Path) -> io::Result<()> {
    let path = chat_history_dir(app_data_dir);
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

pub fn export_chat_conversation(
    app_data_dir: &Path,
    id: &str,
    format: &str,
    include_reasoning: bool,
) -> io::Result<String> {
    let conversation = load_chat_conversation(app_data_dir, id)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "conversation not found"))?;
    let title = value_str(&conversation, "title").unwrap_or(id);
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let extension = match format {
        "json" => "json",
        "markdown" => "md",
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid export format",
            ))
        }
    };
    let file_name = format!(
        "{}-{}.{}",
        sanitize_export_name(title),
        timestamp,
        extension
    );
    let path = chat_history_dir(app_data_dir)
        .join("exports")
        .join(file_name);
    ensure_parent(&path)?;

    match format {
        "json" => fs::write(
            &path,
            serde_json::to_vec_pretty(&conversation).map_err(invalid_data)?,
        )?,
        "markdown" => fs::write(
            &path,
            render_markdown_export(&conversation, include_reasoning),
        )?,
        _ => unreachable!(),
    }

    Ok(path.to_string_lossy().to_string())
}

fn save_chat_history_index(app_data_dir: &Path, index: &ChatHistoryIndex) -> io::Result<()> {
    write_json_atomic(&index_path(app_data_dir), index)
}

fn index_path(app_data_dir: &Path) -> PathBuf {
    chat_history_dir(app_data_dir).join("index.json")
}

fn conversations_dir(app_data_dir: &Path) -> PathBuf {
    chat_history_dir(app_data_dir).join("conversations")
}

fn conversation_path(app_data_dir: &Path, id: &str) -> PathBuf {
    conversations_dir(app_data_dir).join(format!("{id}.json"))
}

fn empty_index() -> ChatHistoryIndex {
    ChatHistoryIndex {
        schema_version: 1,
        conversations: Vec::new(),
    }
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

fn summary_from_conversation(conversation: &Value) -> io::Result<ChatConversationSummary> {
    Ok(ChatConversationSummary {
        id: required_str(conversation, "id")?.to_string(),
        title: required_str(conversation, "title")?.to_string(),
        created_at: required_str(conversation, "createdAt")?.to_string(),
        updated_at: required_str(conversation, "updatedAt")?.to_string(),
        pinned: conversation
            .get("pinned")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        archived: conversation
            .get("archived")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        message_count: conversation
            .get("messageCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize,
        last_message_preview: value_str(conversation, "lastMessagePreview")
            .unwrap_or("")
            .to_string(),
        model_path: value_str(conversation, "modelPath").map(ToString::to_string),
        model_name: value_str(conversation, "modelName").map(ToString::to_string),
    })
}

fn required_str<'a>(value: &'a Value, key: &str) -> io::Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, format!("missing {key}")))
}

fn value_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn sort_conversation_summaries(summaries: &mut [ChatConversationSummary]) {
    summaries.sort_by(|left, right| {
        right
            .pinned
            .cmp(&left.pinned)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
            .then_with(|| left.title.cmp(&right.title))
    });
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    ensure_parent(path)?;
    let tmp = path.with_extension("json.tmp");
    let content = serde_json::to_vec_pretty(value).map_err(invalid_data)?;
    fs::write(&tmp, content)?;
    fs::rename(tmp, path)
}

fn render_markdown_export(conversation: &Value, include_reasoning: bool) -> String {
    let title = value_str(conversation, "title").unwrap_or("Untitled Conversation");
    let model_name = value_str(conversation, "modelName").unwrap_or("unknown");
    let created_at = value_str(conversation, "createdAt").unwrap_or("");
    let updated_at = value_str(conversation, "updatedAt").unwrap_or("");
    let mut output = format!(
        "# {title}\n\n- Model: {model_name}\n- Created: {created_at}\n- Updated: {updated_at}\n\n"
    );

    if let Some(messages) = conversation.get("messages").and_then(Value::as_array) {
        for message in messages {
            let role = match value_str(message, "role").unwrap_or("assistant") {
                "user" => "User",
                "system" => "System",
                _ => "Assistant",
            };
            output.push_str(&format!("## {role}\n\n"));
            if include_reasoning {
                if let Some(reasoning) = value_str(message, "reasoningContent") {
                    if !reasoning.trim().is_empty() {
                        output.push_str("<details>\n<summary>思考过程</summary>\n\n");
                        output.push_str(reasoning);
                        output.push_str("\n\n</details>\n\n");
                    }
                }
            }
            if let Some(content) = value_str(message, "content") {
                output.push_str(content);
                output.push_str("\n\n");
            }
        }
    }

    output
}

fn sanitize_export_name(input: &str) -> String {
    let mut name: String = input
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    name.truncate(60);
    while name.contains("--") {
        name = name.replace("--", "-");
    }
    let name = name.trim_matches('-');
    if name.is_empty() {
        "conversation".to_string()
    } else {
        name.to_string()
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
