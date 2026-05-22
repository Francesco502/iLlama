import { describe, expect, it, vi } from "vitest";
import {
  buildExternalClientCopyText,
  buildRuntimeConnection,
  checkRuntimeConnection,
  externalClientProfiles,
} from "./externalClients";

describe("external client connection helpers", () => {
  it("builds OpenAI-compatible endpoint details from the active runtime", () => {
    const connection = buildRuntimeConnection({
      port: 8088,
      modelName: "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
      healthy: true,
    });

    expect(connection.baseUrl).toBe("http://127.0.0.1:8088/v1");
    expect(connection.chatCompletionsUrl).toBe("http://127.0.0.1:8088/v1/chat/completions");
    expect(connection.modelsUrl).toBe("http://127.0.0.1:8088/v1/models");
    expect(connection.model).toBe("Qwen2.5-7B-Instruct-Q4_K_M.gguf");
    expect(connection.apiKey).toBe("llama");
    expect(connection.healthy).toBe(true);
  });

  it("falls back to the llama.cpp local model name when no model is selected", () => {
    const connection = buildRuntimeConnection({
      port: 8080,
      modelName: null,
      healthy: false,
    });

    expect(connection.model).toBe("local");
    expect(connection.healthy).toBe(false);
  });

  it("ships launcher-oriented profiles for common external clients", () => {
    expect(externalClientProfiles.map((profile) => profile.id)).toEqual([
      "chatbox",
      "cherry-studio",
      "open-webui",
      "anythingllm",
      "custom",
    ]);
    expect(externalClientProfiles[0]).toMatchObject({
      id: "chatbox",
      name: "Chatbox",
      connectionKind: "desktop",
    });
  });

  it("formats a compact copy payload for external clients", () => {
    const text = buildExternalClientCopyText(
      buildRuntimeConnection({
        port: 9090,
        modelName: "local-model.gguf",
        healthy: true,
      }),
    );

    expect(text).toContain("Base URL: http://127.0.0.1:9090/v1");
    expect(text).toContain("API Key: llama");
    expect(text).toContain("Model: local-model.gguf");
  });

  it("checks health and models endpoints for the runtime connection", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "http://127.0.0.1:8080/health") {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (url === "http://127.0.0.1:8080/v1/models") {
        return new Response(JSON.stringify({ data: [{ id: "local" }] }), { status: 200 });
      }
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkRuntimeConnection(
      buildRuntimeConnection({ port: 8080, modelName: "local.gguf", healthy: true }),
    );

    expect(result.ok).toBe(true);
    expect(result.healthOk).toBe(true);
    expect(result.modelsOk).toBe(true);
    expect(result.models).toEqual(["local"]);
  });
});
