import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { clampInt, getAdaptiveSafetyFactor } from "../lib/contextBudget";
import type { SamplingParameters } from "../types/domain";

interface SamplingPanelProps {
  sampling: SamplingParameters;
  ctxSize: number;
  onSamplingChange: (sampling: SamplingParameters) => void;
}

export function SamplingPanel({ sampling, ctxSize, onSamplingChange }: SamplingPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  function update<K extends keyof SamplingParameters>(key: K, value: SamplingParameters[K]) {
    onSamplingChange({ ...sampling, [key]: value });
  }

  const maxTokens = Math.max(0, sampling.maxTokens);
  const promptBudget = Math.max(
    0,
    Math.floor((Math.max(0, ctxSize) - maxTokens) * getAdaptiveSafetyFactor(ctxSize)),
  );
  const budgetKind: "ok" | "warn" =
    promptBudget <= 0 || promptBudget < Math.floor(Math.max(0, ctxSize) * 0.2) ? "warn" : "ok";

  function applyLongReplyPreset() {
    const recommended = clampInt(Math.floor(Math.max(256, Math.min(2048, ctxSize * 0.4))), 64, 8192);
    update("maxTokens", recommended);
  }

  function applyLongMemoryPreset() {
    const recommended = clampInt(Math.floor(Math.max(128, Math.min(512, ctxSize * 0.15))), 32, 4096);
    update("maxTokens", recommended);
  }

  const stopJoined = sampling.stop.join("\n");

  return (
    <section className="panel">
      <div className="panel-title">
        <SlidersHorizontal size={16} />
        <span>采样与输出</span>
      </div>

      <div className="form-grid">
        <NumberField
          label="生成长度上限（maxTokens）"
          value={sampling.maxTokens}
          onChange={(v) => update("maxTokens", v)}
          min={0}
          step={1}
        />
        <NumberField
          label="温度（temperature）"
          value={sampling.temperature}
          onChange={(v) => update("temperature", v)}
          min={0}
          step={0.05}
        />
        <NumberField
          label="top-p"
          value={sampling.topP}
          onChange={(v) => update("topP", v)}
          min={0}
          max={1}
          step={0.05}
        />
      </div>

      <div className="sampling-presets" aria-label="输出偏好预设">
        <button className="ghost-button compact" type="button" onClick={applyLongReplyPreset}>
          长回复
        </button>
        <button className="ghost-button compact" type="button" onClick={applyLongMemoryPreset}>
          长记忆
        </button>
      </div>

      <button
        type="button"
        className="sampling-advanced-toggle"
        aria-expanded={advancedOpen}
        aria-controls="sampling-advanced"
        onClick={() => setAdvancedOpen((value) => !value)}
      >
        <ChevronDown size={14} data-rotated={advancedOpen} />
        高级采样参数
      </button>

      {advancedOpen && (
        <div className="form-grid" id="sampling-advanced">
          <NumberField
            label="top-k"
            value={sampling.topK}
            onChange={(v) => update("topK", v)}
            min={0}
            step={1}
          />
          <NumberField
            label="min-p"
            value={sampling.minP}
            onChange={(v) => update("minP", v)}
            min={0}
            max={1}
            step={0.01}
          />
          <NumberField
            label="重复惩罚（repeat-penalty）"
            value={sampling.repeatPenalty}
            onChange={(v) => update("repeatPenalty", v)}
            min={0}
            step={0.05}
          />
          <NumberField
            label="重复惩罚窗口（repeat-last-n）"
            value={sampling.repeatLastN}
            onChange={(v) => update("repeatLastN", v)}
            min={0}
            step={1}
          />
          <label className="field">
            <span>随机种子（seed，留空为随机）</span>
            <input
              inputMode="numeric"
              onChange={(event) => {
                const text = event.target.value.trim();
                if (!text) {
                  update("seed", null);
                  return;
                }
                const parsed = Number.parseInt(text, 10);
                update("seed", Number.isFinite(parsed) ? parsed : null);
              }}
              type="number"
              value={sampling.seed ?? ""}
            />
          </label>
          <label className="field field-wide">
            <span>停用序列（每行一个，stop）</span>
            <textarea
              rows={3}
              spellCheck={false}
              value={stopJoined}
              onChange={(event) => {
                const lines = event.target.value
                  .split(/\n/)
                  .map((line) => line.replace(/\r$/, ""))
                  .filter((line) => line.length > 0);
                update("stop", lines);
              }}
            />
          </label>
        </div>
      )}

      <div className="budget-hint" data-kind={budgetKind} aria-label="上下文预算提示">
        <div className="budget-hint-title">上下文预算（估算）</div>
        <div className="budget-hint-body">
          <div>ctxSize：{Number.isFinite(ctxSize) ? ctxSize.toLocaleString("zh-CN") : "--"}</div>
          <div>预留输出：{maxTokens.toLocaleString("zh-CN")}</div>
          <div>可用历史（含安全系数）：{promptBudget.toLocaleString("zh-CN")}</div>
        </div>
        {budgetKind === "warn" && (
          <div className="budget-hint-warning">
            预留输出过大可能导致历史上下文不足；可考虑降低 maxTokens 或提高 ctxSize。
          </div>
        )}
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        max={max}
        min={min}
        onChange={(event) => {
          const text = event.target.value;
          if (text === "") {
            onChange(0);
            return;
          }
          const parsed = step && step >= 1 ? Number.parseInt(text, 10) : Number.parseFloat(text);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        step={step}
        type="number"
        value={Number.isFinite(value) ? value : 0}
      />
    </label>
  );
}
