# External Client Compatibility

This matrix is a 3.2.0 release gate for clients that consume the active external
`llama-server` endpoint. It records executable evidence separately from
configuration guidance.

When the runtime is healthy, iLlama exposes values from its immutable active
launch snapshot:

```text
Base URL: http://127.0.0.1:<actual-port>/v1
API Key: llama
Model: </v1/models first returned ID>
Chat Completions: http://127.0.0.1:<actual-port>/v1/chat/completions
Models: http://127.0.0.1:<actual-port>/v1/models
```

Draft model names and requested ports are previews only. They must not replace
the active endpoint or model ID while a server is running.

## 3.2.0 profile matrix

| Client | Profile field names | Exact tested version | Required behavior | Release status |
| --- | --- | --- | --- | --- |
| Executable `curl` | URL and JSON `model` field | Captured from the exact executed `curl --version` output | `/v1/models`, non-stream chat, SSE content followed by `[DONE]`, and client cancellation | Pending protected acceptance; the evidence validator may mark this Verified only after executing and hashing the discovered binary. |
| Chatbox | Base URL, API Key, Model | Not run | Configuration reference only | Pending |
| Cherry Studio | API Host, API Key, Model | Not run | Configuration reference only | Pending |
| Open WebUI | OpenAI API Base URL, API Key, Model | Not run | Configuration reference only | Pending |
| AnythingLLM | Base URL, API Key, Model | Not run | Configuration reference only | Pending |
| Other OpenAI-compatible GUI | Product-specific | Not run | Configuration reference only | Pending |

The GUI rows are configuration references, not compatibility claims. A profile,
screenshot, self-reported version, or manually entered success value cannot
change a row to Verified. For 3.2.0, only the repository's protected executable
`curl` path is an automated external-client release gate.

## Executable evidence contract

The `external-client` acceptance job must launch the packaged native Tauri app
against a real external `llama-server` and GGUF, then execute the discovered
`curl` binary. Its report must include and validate:

- the canonical `curl` executable path, SHA-256, and exact multiline
  `curl --version` output;
- the active loopback endpoint and model ID returned by `/v1/models`;
- a successful non-streaming `/v1/chat/completions` response;
- an SSE response containing content and a terminal `[DONE]` event;
- cancellation performed against the spawned client process;
- the candidate repository, 40-character HEAD SHA, workflow path, run ID, and
  run attempt;
- a bounded, redacted transcript and its SHA-256.

The uploaded artifact name is
`evidence-external-client-<HEAD_SHA>-<RUN_ID>-<RUN_ATTEMPT>`. The release job
must fetch that exact, unexpired artifact and confirm that the GitHub workflow
run succeeded on the same repository and candidate SHA. Until such a run exists,
the row remains Pending.

## Optional GUI investigation

GUI clients may still be explored manually. Record the product version,
platform, exact profile fields, detected model ID, streaming behavior, and any
field-name mismatch, but retain `Pending` unless a future protected workflow
adds an executable, tamper-evident validator for that client. Use the `/v1` base
URL rather than the chat-completions URL, keep the API key non-empty where the
client requires it, and copy the detected model ID exactly.
