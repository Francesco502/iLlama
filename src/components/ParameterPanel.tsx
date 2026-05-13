import { FileSearch, Settings2 } from "lucide-react";
import { builtInProfiles } from "../lib/parameterSchema";
import type { ParameterProfile, PrometheusHintsConfig, StartupParameters, ValidationResult } from "../types/domain";

interface ParameterPanelProps {
  profile: ParameterProfile;
  parameters: StartupParameters;
  port: number;
  onPortChange: (port: number) => void;
  mmprojCandidates?: string[];
  onSelectMmproj?: () => void;
  validation?: ValidationResult;
  prometheusHints: PrometheusHintsConfig;
  onPrometheusHintsChange: (next: PrometheusHintsConfig) => void;
  onProfileChange: (id: ParameterProfile["id"]) => void;
  onParametersChange: (parameters: StartupParameters) => void;
}

export function ParameterPanel({
  profile, parameters, port, onPortChange,
  mmprojCandidates = [], onSelectMmproj,
  validation,
  prometheusHints,
  onPrometheusHintsChange,
  onProfileChange, onParametersChange,
}: ParameterPanelProps) {
  function update<K extends keyof StartupParameters>(key: K, value: StartupParameters[K]) {
    onParametersChange({ ...parameters, [key]: value });
  }

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
      <div className="form-grid">
        <NumberField label="上下文长度" value={parameters.ctxSize} onChange={(v) => update("ctxSize", v)} />
        <TextField label="CPU 线程" value={String(parameters.threads)} onChange={(v) => update("threads", parseAutoNumber(v))} />
        <TextField label="GPU 层数" value={String(parameters.gpuLayers)} onChange={(v) => update("gpuLayers", parseGpuLayers(v))} />
        <NumberField label="Batch size" value={parameters.batchSize} onChange={(v) => update("batchSize", v)} />
        <NumberField label="Micro-batch" value={parameters.ubatchSize} onChange={(v) => update("ubatchSize", v)} />
        <SelectField label="Flash Attention" value={parameters.flashAttention} options={[
          { value: "auto", label: "自动" },
          { value: "on", label: "开启" },
          { value: "off", label: "关闭" },
        ]} onChange={(v) => update("flashAttention", v as StartupParameters["flashAttention"])} />
        <NumberField label="端口号" value={port} onChange={onPortChange} />
        <NumberField
          label="空闲休眠（秒，0 表示禁用）"
          value={parameters.idleSleepSeconds}
          onChange={(v) => update("idleSleepSeconds", Math.max(0, v))}
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
        <ToggleRow label="Projector GPU offload" enabled={parameters.mmprojOffload} onToggle={() => update("mmprojOffload", !parameters.mmprojOffload)} />
      </div>

      <div className="toggle-list">
        <ToggleRow label="内存映射 mmap" enabled={parameters.mmap} onToggle={() => update("mmap", !parameters.mmap)} />
        <ToggleRow label="Metrics 监控" enabled={parameters.metrics} onToggle={() => update("metrics", !parameters.metrics)} />
        <ToggleRow label="mlock 锁定内存" enabled={parameters.mlock} warning onToggle={() => update("mlock", !parameters.mlock)} />
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

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="numeric" min={0} onChange={(e) => onChange(Number.parseInt(e.target.value || "0", 10))} type="number" value={value} />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input onChange={(e) => onChange(e.target.value)} value={value} />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </label>
  );
}

function ToggleRow({ label, enabled, warning, onToggle }: { label: string; enabled: boolean; warning?: boolean; onToggle?: () => void }) {
  return (
    <button className="toggle-row" data-warning={warning} type="button" onClick={onToggle}>
      <span>{label}</span>
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
