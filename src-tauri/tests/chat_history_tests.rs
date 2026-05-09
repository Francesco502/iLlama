use illama_lib::chat_history::{
    delete_chat_conversation, load_chat_conversation, load_chat_history_index,
    save_chat_conversation,
};

fn sample_conversation(id: &str, title: &str) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "id": id,
        "title": title,
        "createdAt": "2026-05-09T00:00:00.000Z",
        "updatedAt": "2026-05-09T00:01:00.000Z",
        "pinned": false,
        "archived": false,
        "messageCount": 2,
        "lastMessagePreview": "你好",
        "modelPath": "/models/qwen.gguf",
        "modelName": "qwen.gguf",
        "systemPrompt": "",
        "messages": [
            {
                "id": "message-1",
                "role": "user",
                "content": "你好",
                "createdAt": "2026-05-09T00:00:00.000Z",
                "status": "complete"
            },
            {
                "id": "message-2",
                "role": "assistant",
                "content": "你好，有什么可以帮你？",
                "createdAt": "2026-05-09T00:01:00.000Z",
                "status": "complete"
            }
        ]
    })
}

#[test]
fn loads_empty_chat_history_index_when_missing() {
    let dir = tempfile::tempdir().unwrap();

    let index = load_chat_history_index(dir.path()).unwrap();

    assert_eq!(index.schema_version, 1);
    assert!(index.conversations.is_empty());
}

#[test]
fn saves_and_loads_chat_conversation() {
    let dir = tempfile::tempdir().unwrap();
    let conversation = sample_conversation("conversation-1", "测试对话");

    let index = save_chat_conversation(dir.path(), &conversation).unwrap();
    let loaded = load_chat_conversation(dir.path(), "conversation-1")
        .unwrap()
        .unwrap();

    assert_eq!(index.conversations.len(), 1);
    assert_eq!(index.conversations[0].id, "conversation-1");
    assert_eq!(index.conversations[0].title, "测试对话");
    assert_eq!(loaded["title"], "测试对话");
}

#[test]
fn replaces_existing_conversation_summary() {
    let dir = tempfile::tempdir().unwrap();
    save_chat_conversation(dir.path(), &sample_conversation("conversation-1", "旧标题")).unwrap();

    let index =
        save_chat_conversation(dir.path(), &sample_conversation("conversation-1", "新标题"))
            .unwrap();

    assert_eq!(index.conversations.len(), 1);
    assert_eq!(index.conversations[0].title, "新标题");
}

#[test]
fn deletes_chat_conversation() {
    let dir = tempfile::tempdir().unwrap();
    save_chat_conversation(
        dir.path(),
        &sample_conversation("conversation-1", "测试对话"),
    )
    .unwrap();

    let index = delete_chat_conversation(dir.path(), "conversation-1").unwrap();
    let loaded = load_chat_conversation(dir.path(), "conversation-1").unwrap();

    assert!(index.conversations.is_empty());
    assert!(loaded.is_none());
}

#[test]
fn rejects_path_traversal_conversation_ids() {
    let dir = tempfile::tempdir().unwrap();
    let conversation = sample_conversation("../bad", "bad");

    let error = save_chat_conversation(dir.path(), &conversation).unwrap_err();

    assert!(error.to_string().contains("invalid conversation id"));
}
