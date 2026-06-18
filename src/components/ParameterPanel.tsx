import { FileSearch, Settings2, HelpCircle } from "lucide-react";
import { builtInProfiles, resolveModelContextLimit } from "../lib/parameterSchema";
import type { ParameterPresetSource, ParameterPresetSourceId } from "../lib/parameterPresets";
import type { ParameterProfile, PrometheusHintsConfig, StartupParameters, ValidationResult } from "../types/domain";

interface ParameterPanelProps {
  profile: ParameterProfile;
  parameters: StartupParameters;
  modelContextLength?: number | null;
  port: number;
  onPortChange: (port: number) => void;
  mmprojCandidates?: string[];
  onSelectMmproj?: () => void;
  validation?: ValidationResult;
  prometheusHints: PrometheusHintsConfig;
  parameterPresetSourceId: ParameterPresetSourceId;
  parameterPresetSources: ParameterPresetSource[];
  appliedParameterPresetName: string;
  onParameterPresetSourceChange: (id: ParameterPresetSourceId) => void;
  onPrometheusHintsChange: (next: PrometheusHintsConfig) => void;
  onProfileChange: (id: ParameterProfile["id"]) => void;
  onParametersChange: (parameters: StartupParameters) => void;
}

export function ParameterPanel({
  profile, parameters, modelContextLength, port, onPortChange,
  mmprojCandidates = [], onSelectMmproj,
  validation,
  prometheusHints,
  parameterPresetSourceId,
  parameterPresetSources,
  appliedParameterPresetName,
  onParameterPresetSourceChange,
  onPrometheusHintsChange,
  onProfileChange, onParametersChange,
}: ParameterPanelProps) {
  function update<K extends keyof StartupParameters>(key: K, value: StartupParameters[K]) {
    onParametersChange({ ...parameters, [key]: value });
  }
  const modelContextLimit = resolveModelContextLimit(modelContextLength);
  const customMode = profile.id === "custom";
  const mmprojEnabled = Boolean(parameters.mmprojPath?.trim());

  return (
    <section className="panel">
      <div className="panel-title">
        <Settings2 size={16} />
        <span>参数配置</span>
      </div>
      <div className="segmented-control" aria-label="启动预设">
        {builtInProfiles.map((item) => (
          <button key={item.id} type="button" data-active={item.id === profile.id} onClick={() => onProfileChange(item.id)}>
            {item.name}
          </button>
        ))}
      </div>
      <div className="parameter-mode-note">
        <strong>{profile.name}</strong>
        <span>{profile.description}</span>
      </div>
      <div className="parameter-mode-note">
        <label className="field field-stretch">
          <FieldLabel
            label="参数来源"
            tooltip="选择 App 内置模型族参数或用户常用 preset；切换后会覆盖采样、Flash Attention 和部分 batch 设置。"
          />
          <select
            value={parameterPresetSourceId}
            onChange={(event) => onParameterPresetSourceChange(event.target.value as ParameterPresetSourceId)}
          >
            {parameterPresetSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <span>当前应用：{appliedParameterPresetName}</span>
      </div>
      {customMode ? (
        <ContextLengthControl
          max={modelContextLimit}
          value={parameters.ctxSize}
          onChange={(value) => update("ctxSize", value)}
        />
      ) : (
        <div className="auto-capability-summary" aria-label="最大能力上下文">
          <div>
            <span>上下文长度</span>
            <strong>{parameters.ctxSize.toLocaleString("zh-CN")}</strong>
          </div>
          <p>已按模型能力自动拉满上下文</p>
          <small>
            模型声明上限：{modelContextLength ? modelContextLength.toLocaleString("zh-CN") : "未知，使用安全默认值"}
          </small>
        </div>
      )}
      <div className="form-grid">
        <TextField
          label="CPU 线程"
          value={String(parameters.threads)}
          onChange={(v) => update("threads", parseAutoNumber(v))}
          tooltip="指定运行模型所使用的 CPU 线程数。'auto' 表示自动决定最佳线程数。"
          presets={[{ label: "自动", value: "auto" }]}
        />
        <TextField
          label="GPU 层数"
          value={String(parameters.gpuLayers)}
          onChange={(v) => update("gpuLayers", parseGpuLayers(v))}
          tooltip="卸载到 GPU 显存中的模型层数。设置为 'all' 将尽量全部卸载，'auto' 为自动。"
          presets={[
            { label: "自动", value: "auto" },
            { label: "全部", value: "all" },
          ]}
        />
        <NumberField
          label="Batch size"
          value={parameters.batchSize}
          onChange={(v) => update("batchSize", v)}
          tooltip="单次评估的批大小（Batch Size），用于控制 Prompt 处理吞吐量。"
        />
        <NumberField
          label="Micro-batch"
          value={parameters.ubatchSize}
          onChange={(v) => update("ubatchSize", v)}
          tooltip="微批次大小，用于控制指令流的微批大小，通常与 Batch size 相同。"
        />
        <SelectField
          label="Flash Attention"
          value={parameters.flashAttention}
          options={[
            { value: "auto", label: "自动" },
            { value: "on", label: "开启" },
            { value: "off", label: "关闭" },
          ]}
          onChange={(v) => update("flashAttention", v as StartupParameters["flashAttention"])}
          tooltip="使用闪光注意力机制（Flash Attention），能有效降低显存并加速推理。"
        />
        <NumberField
          label="端口号"
          value={port}
          onChange={onPortChange}
          tooltip="llama-server 本地 API 监听的 TCP 端口号。"
        />
        <NumberField
          label="空闲休眠（秒）"
          value={parameters.idleSleepSeconds}
          onChange={(v) => update("idleSleepSeconds", Math.max(0, v))}
          tooltip="llama-server 空闲多少秒后自动进入休眠状态，以释放 CPU/GPU 资源（0 表示禁用）。"
        />
      </div>

      {validation && (validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="validation-list" role="status" aria-label="参数校验">
          {validation.errors.map((error) => (
            <div className="validation-item" data-kind="error" key={error}>
              {error}
            </div>
          ))}
          {validation.warnings.map((warning) => (
            <div className="validation-item" data-kind="warning" key={warning}>
              {warning}
            </div>
          ))}
        </div>
      )}

      <div className="multimodal-config">
        <div className="section-heading">
          <span>多模态</span>
          <small>{mmprojCandidates.length > 0 ? `发现 ${mmprojCandidates.length} 个 projector` : "可选"}</small>
        </div>
        <div className="mmproj-row">
          <TextField label="mmproj 文件" value={parameters.mmprojPath ?? ""} onChange={(v) => update("mmprojPath", v.trim().length > 0 ? v : null)} />
          <button className="ghost-button compact" type="button" onClick={onSelectMmproj}>
            <FileSearch size={14} /> 选择
          </button>
        </div>
        {mmprojCandidates.length > 0 && (
          <div className="candidate-list" aria-label="mmproj 候选">
            {mmprojCandidates.slice(0, 3).map((candidate) => (
              <button key={candidate} type="button" onClick={() => update("mmprojPath", candidate)} data-active={candidate === parameters.mmprojPath}>
                {fileName(candidate)}
              </button>
            ))}
          </div>
        )}
        {mmprojEnabled ? (
          <div className="multimodal-status" data-kind="ready">
            Projector 已启用，图片会随请求发送给 llama-server。
          </div>
        ) : mmprojCandidates.length > 0 ? (
          <div className="multimodal-status" data-kind="warning">
            发现 projector，但尚未启用，图片输入不会生效。
          </div>
        ) : (
          <div className="multimodal-status" data-kind="idle">
            未启用 projector；纯文本模型可忽略，图片输入需要对应 mmproj。
          </div>
        )}
        <ToggleRow label="Projector GPU offload" enabled={parameters.mmprojOffload} onToggle={() => update("mmprojOffload", !parameters.mmprojOffload)} />
      </div>

      <div className="toggle-list">
        <ToggleRow
          label="内存映射 mmap"
          enabled={parameters.mmap}
          onToggle={() => update("mmap", !parameters.mmap)}
          tooltip="允许模型文件通过内存映射 (mmap) 异步加载，缩短启动时间并允许多进程共享。"
        />
        <ToggleRow
          label="Metrics 监控"
          enabled={parameters.metrics}
          onToggle={() => update("metrics", !parameters.metrics)}
          tooltip="启用 Prometheus 指标监控接口，方便外接监控仪表盘查看性能。"
        />
        <ToggleRow
          label="mlock 锁定内存"
          enabled={parameters.mlock}
          warning
          onToggle={() => update("mlock", !parameters.mlock)}
          tooltip="强制将模型数据锁定在物理内存中，防止其被交换到 Swap 分区，可保证推理延迟稳定，但需要物理内存充足。"
        />
      </div>

      <details className="prometheus-hints-details">
        <summary>Prometheus 指标名子串（高级，可选）</summary>
        <p className="prometheus-hints-help">
          逗号分隔；留空则使用内置默认。KV 至少 2 段；Prompt 至少 3 段；生成 TPS 需「任含」与「必含」两组子串。
        </p>
        <div className="form-grid prometheus-hints-grid">
          <CsvHintsField
            label="KV cache 子串"
            value={prometheusHints.kvSubstrings}
            onChange={(kvSubstrings) => onPrometheusHintsChange({ ...prometheusHints, kvSubstrings })}
          />
          <CsvHintsField
            label="Prompt TPS 子串"
            value={prometheusHints.promptSubstrings}
            onChange={(promptSubstrings) => onPrometheusHintsChange({ ...prometheusHints, promptSubstrings })}
          />
          <CsvHintsField
            label="生成 TPS（任含其一）"
            value={prometheusHints.generationAnyOf}
            onChange={(generationAnyOf) => onPrometheusHintsChange({ ...prometheusHints, generationAnyOf })}
          />
          <CsvHintsField
            label="生成 TPS（须全部包含）"
            value={prometheusHints.generationRequired}
            onChange={(generationRequired) => onPrometheusHintsChange({ ...prometheusHints, generationRequired })}
          />
        </div>
      </details>
    </section>
  );
}

function FieldLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  if (!tooltip) {
    return <span>{label}</span>;
  }
  return (
    <span className="field-label-container">
      <span>{label}</span>
      <span className="tooltip-wrapper" data-tooltip={tooltip} onClick={(e) => e.stopPropagation()}>
        <HelpCircle size={12} className="tooltip-icon" />
      </span>
    </span>
  );
}

function ContextLengthControl({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const safeMax = Math.max(1024, max);
  const safeValue = Math.min(safeMax, Math.max(1024, value));
  return (
    <div className="range-control">
      <div className="range-control-header">
        <label htmlFor="ctx-size-number">上下文长度</label>
        <span>{safeValue.toLocaleString("zh-CN")} / {safeMax.toLocaleString("zh-CN")}</span>
      </div>
      <input
        aria-label="上下文长度滑杆"
        max={safeMax}
        min={1024}
        onChange={(event) => onChange(Number.parseInt(event.target.value || "0", 10))}
        step={1024}
        type="range"
        value={safeValue}
      />
      <input
        id="ctx-size-number"
        inputMode="numeric"
        max={safeMax}
        min={1024}
        onChange={(event) => onChange(Number.parseInt(event.target.value || "0", 10))}
        step={1024}
        type="number"
        value={Number.isFinite(value) ? value : 0}
      />
    </div>
  );
}

function CsvHintsField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <label className="field field-stretch">
      <span>{label}</span>
      <textarea
        rows={2}
        spellCheck={false}
        value={csvFromList(value)}
        onChange={(e) => onChange(listFromCsv(e.target.value))}
      />
    </label>
  );
}

function csvFromList(list: string[]): string {
  return list.join(", ");
}

function listFromCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function NumberField({
  label,
  value,
  onChange,
  tooltip,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  tooltip?: string;
}) {
  return (
    <label className="field">
      <FieldLabel label={label} tooltip={tooltip} />
      <input inputMode="numeric" min={0} onChange={(e) => onChange(Number.parseInt(e.target.value || "0", 10))} type="number" value={value} />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  tooltip,
  presets,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  tooltip?: string;
  presets?: { label: string; value: string }[];
}) {
  return (
    <label className="field">
      <FieldLabel label={label} tooltip={tooltip} />
      <div className="input-with-presets">
        <input onChange={(e) => onChange(e.target.value)} value={value} />
        {presets && presets.length > 0 && (
          <div className="preset-badges">
            {presets.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className="preset-badge"
                onClick={() => onChange(preset.value)}
                data-active={value === preset.value}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  tooltip,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  tooltip?: string;
}) {
  return (
    <label className="field">
      <FieldLabel label={label} tooltip={tooltip} />
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </label>
  );
}

function ToggleRow({
  label,
  enabled,
  warning,
  onToggle,
  tooltip,
}: {
  label: string;
  enabled: boolean;
  warning?: boolean;
  onToggle?: () => void;
  tooltip?: string;
}) {
  return (
    <button className="toggle-row" data-warning={warning} type="button" onClick={onToggle}>
      <FieldLabel label={label} tooltip={tooltip} />
      <span className="toggle" data-enabled={enabled}><span /></span>
    </button>
  );
}

function parseAutoNumber(value: string): StartupParameters["threads"] {
  if (value.trim() === "auto") return "auto";
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : "auto";
}

function parseGpuLayers(value: string): StartupParameters["gpuLayers"] {
  const trimmed = value.trim();
  if (trimmed === "auto" || trimmed === "all") return trimmed;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : "auto";
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
