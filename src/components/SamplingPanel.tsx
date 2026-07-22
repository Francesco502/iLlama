import { ChevronDown, SlidersHorizontal, HelpCircle } from "lucide-react";
import { useId } from "react";
import { getAdaptiveSafetyFactor } from "../lib/contextBudget";
import { calculateMaxOutputTokens } from "../lib/parameterSchema";
import type { ParameterProfile, SamplingParameters } from "../types/domain";

interface SamplingPanelProps {
  parameterMode: ParameterProfile["id"];
  sampling: SamplingParameters;
  ctxSize: number;
  onSamplingChange: (sampling: SamplingParameters) => void;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
}

function FieldLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  const tooltipId = useId();
  if (!tooltip) {
    return <span>{label}</span>;
  }
  return (
    <span className="field-label-container">
      <span>{label}</span>
      <span
        className="tooltip-wrapper"
        data-tooltip={tooltip}
        role="button"
        tabIndex={0}
        aria-label={`${label}说明`}
        aria-describedby={tooltipId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <HelpCircle size={12} className="tooltip-icon" />
      </span>
      <span className="visually-hidden" id={tooltipId} role="tooltip">{tooltip}</span>
    </span>
  );
}

export function SamplingPanel({
  parameterMode,
  sampling,
  ctxSize,
  onSamplingChange,
  advancedOpen,
  onAdvancedOpenChange,
}: SamplingPanelProps) {
  function update<K extends keyof SamplingParameters>(key: K, value: SamplingParameters[K]) {
    onSamplingChange({ ...sampling, [key]: value });
  }

  const maxTokens = Math.max(0, sampling.maxTokens);
  const outputUpperBound = calculateMaxOutputTokens(ctxSize);
  const maximumMode = parameterMode === "max-capability";
  const promptBudget = Math.max(
    0,
    Math.floor((Math.max(0, ctxSize) - maxTokens) * getAdaptiveSafetyFactor(ctxSize)),
  );
  const budgetKind: "ok" | "warn" =
    promptBudget <= 0 || promptBudget < Math.floor(Math.max(0, ctxSize) * 0.2) ? "warn" : "ok";

  const stopJoined = sampling.stop.join("\n");

  return (
    <section className="panel">
      <div className="panel-title">
        <SlidersHorizontal size={16} />
        <span>采样与输出</span>
      </div>

      <div className="sampling-output-layout">
        <OutputLengthControl
          disabled={maximumMode}
          max={outputUpperBound}
          value={sampling.maxTokens}
          onChange={(v) => update("maxTokens", v)}
        />
        {maximumMode && (
          <div className="auto-capability-summary compact">
            <p>输出已按当前上下文自动拉到安全上限</p>
            <small>该值只影响内置测试聊天；外部客户端仍由客户端自己的 max_tokens 控制。</small>
          </div>
        )}
      </div>

      <div className="form-grid">
        <NumberField
          label="温度（temperature）"
          value={sampling.temperature}
          onChange={(v) => update("temperature", v)}
          min={0}
          step={0.05}
          tooltip="控制生成文本的随机性与创造性。值越高越有创意，值为 0 时输出最确定。"
        />
        <NumberField
          label="top-p"
          value={sampling.topP}
          onChange={(v) => update("topP", v)}
          min={0}
          max={1}
          step={0.05}
          tooltip="核采样参数。仅保留概率累加达到该比例的候选词，例如 0.9 表示只从累计概率占 90% 的候选词中采样。"
        />
      </div>

      <button
        type="button"
        className="sampling-advanced-toggle"
        aria-expanded={advancedOpen}
        aria-controls="sampling-advanced"
        onClick={() => onAdvancedOpenChange(!advancedOpen)}
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
            tooltip="仅保留概率最高的前 K 个候选词进行采样。设置为 0 表示不限制。"
          />
          <NumberField
            label="min-p"
            value={sampling.minP}
            onChange={(v) => update("minP", v)}
            min={0}
            max={1}
            step={0.01}
            tooltip="最小概率阈值截断。从候选词中排除概率低于最可能词一定比例的词，有助于在保持创造力的同时过滤无关词。"
          />
          <NumberField
            label="重复惩罚（repeat-penalty）"
            value={sampling.repeatPenalty}
            onChange={(v) => update("repeatPenalty", v)}
            min={0}
            step={0.05}
            tooltip="对已生成的词进行惩罚以减少复读。大于 1.0 时惩罚生效，通常设在 1.1 到 1.5 之间。"
          />
          <NumberField
            label="重复惩罚窗口（repeat-last-n）"
            value={sampling.repeatLastN}
            onChange={(v) => update("repeatLastN", v)}
            min={0}
            step={1}
            tooltip="应用重复惩罚时所考虑的历史 Token 数量。"
          />
          <label className="field">
            <FieldLabel label="随机种子（seed，留空为随机）" tooltip="指定随机数种子以获得可重复的输出结果。留空为随机。" />
            <input
              aria-label="随机种子（seed，留空为随机）"
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
            <FieldLabel label="停用序列（每行一个，stop）" tooltip="遇到这些停用词序列时立即停止生成。每行输入一个。" />
            <textarea
              aria-label="停用序列（每行一个，stop）"
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

function OutputLengthControl({
  value,
  max,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const safeMax = Math.max(64, max);
  const safeValue = Math.min(safeMax, Math.max(64, value));
  return (
    <div className="range-control">
      <div className="range-control-header">
        <label htmlFor="max-tokens-number">输出最大长度</label>
        <span>{safeValue.toLocaleString("zh-CN")} / {safeMax.toLocaleString("zh-CN")}</span>
      </div>
      <input
        aria-label="输出最大长度滑杆"
        disabled={disabled}
        max={safeMax}
        min={64}
        onChange={(event) => onChange(Number.parseInt(event.target.value || "0", 10))}
        step={64}
        type="range"
        value={safeValue}
      />
      <input
        disabled={disabled}
        id="max-tokens-number"
        inputMode="numeric"
        max={safeMax}
        min={64}
        onChange={(event) => onChange(Number.parseInt(event.target.value || "0", 10))}
        step={64}
        type="number"
        value={Number.isFinite(value) ? value : 0}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  tooltip,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  tooltip?: string;
}) {
  return (
    <label className="field">
      <FieldLabel label={label} tooltip={tooltip} />
      <input
        aria-label={label}
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
