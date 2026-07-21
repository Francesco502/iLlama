import { Clipboard, ExternalLink, FlaskConical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  buildExternalClientCopyText,
  buildExternalClientJson,
  checkRuntimeConnection,
  externalClientProfiles,
  type RuntimeConnectionCheckResult,
  type RuntimeConnection,
} from "../lib/externalClients";

interface ConnectionPanelProps {
  connection: RuntimeConnection;
  runningInTauri?: boolean;
  trayEnabled: boolean;
  onTrayToggle: (enabled: boolean) => void;
  onOpenTest: () => void;
  onExportLegacyHistory?: () => void;
  appendSystemLog: (message: string) => void;
}

export function ConnectionPanel({
  connection,
  runningInTauri = true,
  trayEnabled,
  onTrayToggle,
  onOpenTest,
  onExportLegacyHistory,
  appendSystemLog,
}: ConnectionPanelProps) {
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);
  const [copiedInfo, setCopiedInfo] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [checkState, setCheckState] = useState<{
    status: "idle" | "checking" | "complete";
    result: RuntimeConnectionCheckResult | null;
  }>({ status: "idle", result: null });
  const checkControllerRef = useRef<AbortController | null>(null);
  const checkGenerationRef = useRef(0);

  useEffect(() => {
    checkGenerationRef.current += 1;
    checkControllerRef.current?.abort();
    checkControllerRef.current = null;
    setCheckState({ status: "idle", result: null });
    return () => {
      checkGenerationRef.current += 1;
      checkControllerRef.current?.abort();
    };
  }, [
    connection.healthy,
    connection.host,
    connection.model,
    connection.modelsUrl,
    connection.port,
    connection.source,
  ]);

  async function copy(text: string, label: string, type: "info" | "json") {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(text);
      setManualCopyText(null);
      appendSystemLog(`已复制${label}。`);
      if (type === "info") {
        setCopiedInfo(true);
        setTimeout(() => setCopiedInfo(false), 2000);
      } else {
        setCopiedJson(true);
        setTimeout(() => setCopiedJson(false), 2000);
      }
    } catch {
      setManualCopyText(text);
      appendSystemLog(`无法写入剪贴板，请手动复制${label}。`);
    }
  }

  async function handleConnectionCheck() {
    checkControllerRef.current?.abort();
    const controller = new AbortController();
    checkControllerRef.current = controller;
    const generation = ++checkGenerationRef.current;
    setCheckState({ status: "checking", result: null });
    const result = await checkRuntimeConnection(connection, controller.signal);
    if (controller.signal.aborted || generation !== checkGenerationRef.current) return;
    setCheckState({ status: "complete", result });
    appendSystemLog(result.message);
    checkControllerRef.current = null;
  }

  return (
    <div className="connection-view">
      {!runningInTauri && (
        <section className="connection-notice" aria-label="浏览器预览模式">
          <strong>浏览器预览模式</strong>
          <span>这里展示的是本地端点形态，浏览器预览不会真实启动 llama-server。</span>
        </section>
      )}

      <section className="connection-summary panel" aria-label="OpenAI-compatible 连接信息">
        <div className="connection-summary-header">
          <div>
            <span className="eyebrow">OpenAI-compatible endpoint</span>
            <h2>连接</h2>
            <p>把下面的信息填入 Chatbox、Cherry Studio、Open WebUI 或任何兼容客户端。</p>
          </div>
          <span className="health-chip" data-status={connection.healthy ? "healthy" : "idle"}>
            {connection.healthy ? "运行中" : "等待启动"}
          </span>
        </div>
        <dl className="connection-fields">
          <div>
            <dt>Base URL</dt>
            <dd>{connection.baseUrl}</dd>
          </div>
          <div>
            <dt>API Key</dt>
            <dd>{connection.apiKey}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{connection.model}</dd>
          </div>
          <div>
            <dt>Chat Completions</dt>
            <dd>{connection.chatCompletionsUrl}</dd>
          </div>
        </dl>
        <div className="connection-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => void copy(buildExternalClientCopyText(connection), "连接信息", "info")}
          >
            <Clipboard size={14} className={copiedInfo ? "copy-success-icon" : ""} />
            {copiedInfo ? "已复制 ✓" : "复制连接信息"}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void copy(buildExternalClientJson(connection), "JSON 配置", "json")}
          >
            <Clipboard size={14} className={copiedJson ? "copy-success-icon" : ""} />
            {copiedJson ? "已复制 ✓" : "复制 JSON"}
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={checkState.status === "checking"}
            onClick={() => void handleConnectionCheck()}
          >
            <FlaskConical size={14} />
            {checkState.status === "checking" ? "检测中" : "检测连接"}
          </button>
          <button className="start-button secondary" type="button" onClick={onOpenTest}>
            <FlaskConical size={14} />
            打开测试
          </button>
          {onExportLegacyHistory && (
            <button className="ghost-button" type="button" onClick={onExportLegacyHistory}>
              <Clipboard size={14} />
              导出 V2 历史
            </button>
          )}
        </div>
        {checkState.result && (
          <div className="connection-check-result" data-ok={checkState.result.ok}>
            <strong>{checkState.result.ok ? "检测通过" : "检测未通过"}</strong>
            <span>{checkState.result.message}</span>
            {checkState.result.models.length > 0 && (
              <span>模型：{checkState.result.models.join(", ")}</span>
            )}
          </div>
        )}
        {manualCopyText && (
          <label className="manual-copy-block">
            <span>手动复制</span>
            <textarea readOnly value={manualCopyText} />
          </label>
        )}
      </section>

      <section className="external-clients panel" aria-label="外部客户端">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">External clients</span>
            <h2>推荐客户端</h2>
          </div>
        </div>
        <div className="external-client-grid">
          {externalClientProfiles.map((profile) => (
            <article className="external-client-card" key={profile.id}>
              <div>
                <h3>{profile.name}</h3>
                <p>{profile.summary}</p>
              </div>
              <div className="external-client-fields">
                {profile.fields.map((field) => (
                  <span key={field}>{field}</span>
                ))}
              </div>
              <a
                aria-label={`${profile.name} 官网`}
                className="ghost-button compact"
                href={profile.homepageUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink size={13} />
                官网
              </a>
            </article>
          ))}
        </div>
      </section>

      {runningInTauri && (
        <section className="tray-settings panel" aria-label="状态栏设置">
          <div className="section-title-row">
            <div>
              <span className="eyebrow">System</span>
              <h2>顶部系统状态栏</h2>
              <p>在 macOS 顶部系统状态栏（包含 Wifi、电池等图标的栏）显示 iLlama 状态图标。启用后可通过状态栏菜单快捷操作；未启用时，关闭窗口后应用仍保持在后台（Dock 栏中）运行。</p>
            </div>
          </div>
          <label className="tray-toggle-row">
            <span className="tray-toggle-label">在顶部系统状态栏显示图标</span>
            <button
              type="button"
              role="switch"
              aria-checked={trayEnabled}
              className={`toggle-switch ${trayEnabled ? "active" : ""}`}
              onClick={() => onTrayToggle(!trayEnabled)}
            >
              <span className="toggle-knob" />
            </button>
          </label>
        </section>
      )}
    </div>
  );
}
