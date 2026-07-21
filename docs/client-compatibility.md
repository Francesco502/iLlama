# External Client Compatibility

This matrix is a 3.2.0 release gate for clients that consume the active external
`llama-server` endpoint.

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

| Client | Profile field names | Tested version | Streaming | Images | Release status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Chatbox | Base URL, API Key, Model | Pending RC acceptance | Pending | Pending | Compatible configuration reference | Keep the API key non-empty and copy the detected model ID exactly. |
| Cherry Studio | API Host, API Key, Model | Pending RC acceptance | Pending | Pending | Compatible configuration reference | Some versions label Base URL as API Host. |
| Open WebUI | OpenAI API Base URL, API Key, Model | Pending RC acceptance | Pending | Pending | Compatible configuration reference | Use the `/v1` base, not the chat-completions URL. |
| AnythingLLM | Base URL, API Key, Model | Pending RC acceptance | Pending | Pending | Compatible configuration reference | Check whether workspace model selection overrides the provider model. |
| Custom OpenAI-compatible client | Base URL, API Key, Model | Per client | Per client | Per client | Contract reference | Probe `/v1/models` before sending chat. |

“Verified” is allowed only after a real client version has completed the steps
below against the 3.2.0 release candidate. Shipping a profile or copying field
names from documentation is not verification.

## Manual validation

1. Start the signed RC with a real external `llama-server` and GGUF.
2. Record the server version, model file, actual port, `/health` response, and the
   first ID returned by `/v1/models`.
3. Configure the external client with the exact field names and active values.
4. Send a short text prompt and confirm cancellation and streaming behavior.
5. If the client supports images, repeat with a compatible model and `mmproj`.
6. Restart with a different model/port and confirm the client values update only
   after the new runtime becomes active.
7. Record client version, platform, config path, streaming result, image result,
   and any field-name mismatch.

At least one row must contain a real version and “Verified” before the signed RC
may be published. Its evidence URL or run ID is required by the protected release
workflow. Re-run the same client acceptance before final release when runtime or
connection behavior changes after RC.
