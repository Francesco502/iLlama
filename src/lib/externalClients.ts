export type ExternalClientId =
  | "chatbox"
  | "cherry-studio"
  | "open-webui"
  | "anythingllm"
  | "custom";

export type ExternalClientConnectionKind = "desktop" | "web" | "custom";

export interface RuntimeConnectionInput {
  port: number;
  modelName: string | null;
  healthy: boolean;
}

export interface RuntimeConnectionSnapshotInput {
  snapshot: RuntimeSnapshot;
  draftPort: number;
  draftModelName: string | null;
}

export interface RuntimeConnection {
  host: "127.0.0.1";
  port: number;
  baseUrl: string;
  chatCompletionsUrl: string;
  modelsUrl: string;
  apiKey: string;
  model: string;
  healthy: boolean;
  source: "active" | "draft";
}

export interface ExternalClientProfile {
  id: ExternalClientId;
  name: string;
  connectionKind: ExternalClientConnectionKind;
  homepageUrl: string;
  summary: string;
  fields: string[];
}

export interface RuntimeConnectionCheckResult {
  ok: boolean;
  healthOk: boolean;
  modelsOk: boolean;
  models: string[];
  message: string;
}

export const externalClientProfiles: ExternalClientProfile[] = [
  {
    id: "chatbox",
    name: "Chatbox",
    connectionKind: "desktop",
    homepageUrl: "https://chatboxai.app/",
    summary: "桌面聊天客户端，适合作为 iLlama 的默认外部对话入口。",
    fields: ["Base URL", "API Key", "Model"],
  },
  {
    id: "cherry-studio",
    name: "Cherry Studio",
    connectionKind: "desktop",
    homepageUrl: "https://cherry-ai.com/",
    summary: "多模型桌面客户端，适合管理多个本地和远程提供方。",
    fields: ["API Host", "API Key", "Model"],
  },
  {
    id: "open-webui",
    name: "Open WebUI",
    connectionKind: "web",
    homepageUrl: "https://openwebui.com/",
    summary: "Web UI / 自托管聊天前端，适合长期会话和多用户场景。",
    fields: ["OpenAI API Base URL", "API Key", "Model"],
  },
  {
    id: "anythingllm",
    name: "AnythingLLM",
    connectionKind: "desktop",
    homepageUrl: "https://anythingllm.com/",
    summary: "面向知识库和工作区的客户端，可连接 OpenAI-compatible 服务。",
    fields: ["Base URL", "API Key", "Model"],
  },
  {
    id: "custom",
    name: "自定义客户端",
    connectionKind: "custom",
    homepageUrl: "https://github.com/ggml-org/llama.cpp/tree/master/examples/server",
    summary: "任何支持 OpenAI-compatible API 的应用都可以连接到 iLlama 启动的服务。",
    fields: ["Base URL", "API Key", "Model"],
  },
];

export function buildRuntimeConnection(
  input: RuntimeConnectionInput | RuntimeConnectionSnapshotInput,
): RuntimeConnection {
  const active = "snapshot" in input ? input.snapshot.activeLaunch : null;
  const port = active?.port ?? ("snapshot" in input ? input.draftPort : input.port);
  const modelName = active
    ? active.modelId
    : "snapshot" in input
      ? input.draftModelName
      : input.modelName;
  const healthy = "snapshot" in input ? input.snapshot.status === "healthy" : input.healthy;
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  return {
    host: "127.0.0.1",
    port,
    baseUrl,
    chatCompletionsUrl: `${baseUrl}/chat/completions`,
    modelsUrl: `${baseUrl}/models`,
    apiKey: "llama",
    model: modelName?.trim() || (active ? "等待模型 ID" : "local"),
    healthy,
    source: active ? "active" : "draft",
  };
}

export function buildExternalClientCopyText(connection: RuntimeConnection): string {
  return [
    "iLlama OpenAI-compatible connection",
    `Base URL: ${connection.baseUrl}`,
    `API Key: ${connection.apiKey}`,
    `Model: ${connection.model}`,
    `Chat Completions: ${connection.chatCompletionsUrl}`,
  ].join("\n");
}

export function buildExternalClientJson(connection: RuntimeConnection): string {
  return JSON.stringify(
    {
      baseUrl: connection.baseUrl,
      apiKey: connection.apiKey,
      model: connection.model,
    },
    null,
    2,
  );
}

export async function checkRuntimeConnection(
  connection: RuntimeConnection,
): Promise<RuntimeConnectionCheckResult> {
  const healthUrl = `http://${connection.host}:${connection.port}/health`;
  const health = await fetchEndpoint(healthUrl);
  const models = await fetchEndpoint(connection.modelsUrl);
  const modelIds = extractModelIds(models.body);
  const healthOk = health.ok;
  const modelsOk = models.ok && modelIds.length > 0;

  return {
    ok: healthOk && modelsOk,
    healthOk,
    modelsOk,
    models: modelIds,
    message: buildCheckMessage(health, models, modelIds),
  };
}

interface EndpointResult {
  ok: boolean;
  status: number | null;
  error: string | null;
  body: unknown;
}

async function fetchEndpoint(url: string): Promise<EndpointResult> {
  try {
    const response = await fetch(url);
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      error: null,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
      body: null,
    };
  }
}

function extractModelIds(body: unknown): string[] {
  if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) {
    return [];
  }
  return body.data
    .map((item) => {
      if (!item || typeof item !== "object" || !("id" in item)) {
        return null;
      }
      return typeof item.id === "string" ? item.id : null;
    })
    .filter((id): id is string => Boolean(id));
}

function buildCheckMessage(
  health: EndpointResult,
  models: EndpointResult,
  modelIds: string[],
): string {
  if (health.ok && models.ok && modelIds.length > 0) {
    return `连接可用，发现 ${modelIds.length} 个模型。`;
  }
  if (!health.ok) {
    return `Health 检测失败：${describeEndpointFailure(health)}`;
  }
  if (!models.ok) {
    return `Models 检测失败：${describeEndpointFailure(models)}`;
  }
  return "Models 响应中没有可用模型。";
}

function describeEndpointFailure(result: EndpointResult): string {
  if (result.error) {
    return result.error;
  }
  if (result.status !== null) {
    return `HTTP ${result.status}`;
  }
  return "未知错误";
}
import type { RuntimeSnapshot } from "../api/tauri";
