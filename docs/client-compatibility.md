# External Client Compatibility

This matrix is the V3 release gate for clients that consume iLlama's OpenAI-compatible endpoint.

iLlama exposes:

```text
Base URL: http://127.0.0.1:<port>/v1
API Key: llama
Model: <selected GGUF file name>
Chat Completions: http://127.0.0.1:<port>/v1/chat/completions
Models: http://127.0.0.1:<port>/v1/models
```

## V3.0.0 Profile Matrix

| Client | Profile field names | Tested version | Config path | Streaming | Images | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chatbox | Base URL, API Key, Model | TBD before signed release | Settings / Model Provider / OpenAI-compatible | TBD | TBD | Profile shipped, manual validation pending | Use the value from iLlama's `Base URL`; keep API key non-empty. |
| Cherry Studio | API Host, API Key, Model | TBD before signed release | Providers / OpenAI-compatible | TBD | TBD | Profile shipped, manual validation pending | Some builds label the base URL as API host. |
| Open WebUI | OpenAI API Base URL, API Key, Model | TBD before signed release | Admin / Settings / Connections | TBD | TBD | Profile shipped, manual validation pending | Usually expects the `/v1` base URL, not the chat-completions URL. |
| AnythingLLM | Base URL, API Key, Model | TBD before signed release | LLM Preference / OpenAI-compatible | TBD | TBD | Profile shipped, manual validation pending | Confirm whether workspace-level model selection overrides provider model. |
| Custom OpenAI-compatible client | Base URL, API Key, Model | Per client | Per client | Per client | Per client | Supported by contract | Start with `/v1/models`, then `/v1/chat/completions`. |

## Manual Validation Steps

1. Launch iLlama with a real `llama-server` and a small GGUF model.
2. Open `连接` and click `检测连接`; record `/health`, `/v1/models`, and the model IDs shown.
3. In the external client, configure the profile using the exact field names in the matrix.
4. Send a short text prompt and confirm streaming behavior.
5. If the client supports image input, repeat with a model + `mmproj` capable of vision requests.
6. Record the client version, platform, config path, streaming result, image result, and any field-name mismatch.

Do not mark a row as validated unless it was tested against a locally running iLlama V3 build and the exact client version is recorded.
