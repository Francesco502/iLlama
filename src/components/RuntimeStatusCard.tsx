import { Square } from "lucide-react";
import { useEffect, useState } from "react";
import type { RuntimeSnapshot } from "../api/tauri";
import type { RuntimeStatus } from "../types/domain";

interface RuntimeStatusCardProps {
  snapshot: Readonly<RuntimeSnapshot>;
  onStop: () => void;
}

const statusLabel: Record<RuntimeStatus, string> = {
  idle: "空闲",
  scanning: "扫描中",
  starting: "启动中",
  healthy: "运行中",
  failed: "失败",
  stopping: "停止中",
  stopped: "已停止",
};

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function elapsedSeconds(startedAt: string, nowMs: number): number {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1_000));
}

function formatElapsedTime(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function RuntimeStatusCard({ snapshot, onStop }: RuntimeStatusCardProps) {
  const startedAt = snapshot.activeLaunch?.startedAt ?? null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setNowMs(Date.now());
    if (!startedAt) return;

    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const activeLaunch = snapshot.activeLaunch;
  if (!activeLaunch) return null;

  const uptimeSeconds = elapsedSeconds(activeLaunch.startedAt, nowMs);
  const modelName = activeLaunch.modelId?.trim() || fileNameFromPath(activeLaunch.modelPath);
  const isSlowStartup = snapshot.status === "starting" && uptimeSeconds > 120;

  return (
    <section className="runtime-status-card panel" aria-label="当前运行状态">
      <div className="runtime-status-header">
        <div className="runtime-status-title">
          <span className="status-dot-live" data-status={snapshot.status} aria-hidden="true" />
          <div>
            <span className="eyebrow">当前运行</span>
            <strong>{modelName}</strong>
          </div>
        </div>
        <div className="runtime-status-actions">
          <span className="health-chip" data-status={snapshot.status}>
            {statusLabel[snapshot.status]}
          </span>
          {snapshot.pid !== null && (
            <button className="stop-button" type="button" onClick={onStop} aria-label="停止服务">
              <Square size={10} />
              停止
            </button>
          )}
        </div>
      </div>

      <dl className="runtime-status-facts">
        <div>
          <dt>端口</dt>
          <dd>{activeLaunch.port}</dd>
        </div>
        <div>
          <dt>PID</dt>
          <dd>{snapshot.pid ?? "—"}</dd>
        </div>
        <div>
          <dt>运行时长</dt>
          <dd>{formatElapsedTime(uptimeSeconds)}</dd>
        </div>
      </dl>

      {isSlowStartup && (
        <p className="runtime-slow-start" role="status">
          加载较慢，服务仍在启动中
        </p>
      )}
    </section>
  );
}
