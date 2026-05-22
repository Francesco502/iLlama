use illama_lib::legacy_chat_export::export_legacy_chat_history;

fn write_legacy_conversation(dir: &tempfile::TempDir, id: &str, title: &str) {
    let history_dir = dir.path().join("chat-history");
    let conversations_dir = history_dir.join("conversations");
    std::fs::create_dir_all(&conversations_dir).unwrap();
    std::fs::write(
        history_dir.join("index.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 2,
            "conversations": [
                {
                    "id": id,
                    "title": title,
                    "createdAt": "2026-05-09T00:00:00.000Z",
                    "updatedAt": "2026-05-09T00:01:00.000Z",
                    "pinned": false,
                    "archived": false,
                    "messageCount": 2,
                    "lastMessagePreview": "你好",
                    "modelPath": "/models/qwen.gguf",
                    "modelName": "qwen.gguf"
                }
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    std::fs::write(
        conversations_dir.join(format!("{id}.json")),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 1,
            "id": id,
            "title": title,
            "messages": [
                { "role": "user", "content": "你好" },
                { "role": "assistant", "content": "你好，有什么可以帮你？" }
            ]
        }))
        .unwrap(),
    )
    .unwrap();
}

#[test]
fn exports_legacy_chat_history_bundle_without_mutating_source() {
    let dir = tempfile::tempdir().unwrap();
    write_legacy_conversation(&dir, "conversation-1", "测试对话");

    let export_path = export_legacy_chat_history(dir.path()).unwrap();
    let exported = std::fs::read_to_string(export_path).unwrap();
    let value: serde_json::Value = serde_json::from_str(&exported).unwrap();

    assert_eq!(value["schemaVersion"], 1);
    assert_eq!(value["source"], "iLlama V2 chat-history");
    assert_eq!(value["conversations"][0]["title"], "测试对话");
    assert!(dir
        .path()
        .join("chat-history")
        .join("conversations")
        .join("conversation-1.json")
        .exists());
}

#[test]
fn rejects_invalid_legacy_conversation_ids() {
    let dir = tempfile::tempdir().unwrap();
    write_legacy_conversation(&dir, "../bad", "bad");

    let error = export_legacy_chat_history(dir.path()).unwrap_err();

    assert!(error.to_string().contains("invalid conversation id"));
}
