import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { getProfileById } from "../lib/parameterSchema";
import { MODEL_FAMILY_AUTO_PRESET_SOURCE_ID, parameterPresetSources } from "../lib/parameterPresets";
import { ParameterPanel } from "./ParameterPanel";
import type { PrometheusHintsConfig, StartupParameters } from "../types/domain";
import { emptyPrometheusHintsConfig } from "../types/domain";

describe("ParameterPanel", () => {
  it("allows the automatic port preference to be changed", async () => {
    const user = userEvent.setup();
    const onAutoPortChange = vi.fn();
    const profile = getProfileById("custom");
    render(
      <ParameterPanel
        profile={profile}
        parameters={profile.parameters}
        port={8080}
        onPortChange={vi.fn()}
        autoPort={false}
        onAutoPortChange={onAutoPortChange}
        prometheusHints={emptyPrometheusHintsConfig()}
        parameterPresetSourceId={MODEL_FAMILY_AUTO_PRESET_SOURCE_ID}
        parameterPresetSources={parameterPresetSources}
        appliedParameterPresetName="Llama 通用"
        onParameterPresetSourceChange={vi.fn()}
        onPrometheusHintsChange={vi.fn()}
        onParametersChange={vi.fn()}
        onProfileChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("switch", { name: /自动端口/ }));
    expect(onAutoPortChange).toHaveBeenCalledWith(true);
  });

  it("emits updated context size values", async () => {
    const user = userEvent.setup();
    const profile = getProfileById("custom");
    const onParametersChange = vi.fn();
    const onPrometheusHintsChange = vi.fn();

    function Host() {
      const [parameters, setParameters] = useState<StartupParameters>(profile.parameters);
      const [hints, setHints] = useState<PrometheusHintsConfig>(emptyPrometheusHintsConfig());
      return (
        <ParameterPanel
          profile={profile}
          parameters={parameters}
          modelContextLength={32768}
          port={8080}
          onPortChange={vi.fn()}
          prometheusHints={hints}
          parameterPresetSourceId={MODEL_FAMILY_AUTO_PRESET_SOURCE_ID}
          parameterPresetSources={parameterPresetSources}
          appliedParameterPresetName="Llama 通用"
          onParameterPresetSourceChange={vi.fn()}
          onPrometheusHintsChange={(next) => {
            setHints(next);
            onPrometheusHintsChange(next);
          }}
          onParametersChange={(next) => {
            setParameters(next);
            onParametersChange(next);
          }}
          onProfileChange={vi.fn()}
        />
      );
    }

    render(<Host />);

    expect(screen.getByRole("button", { name: "自动配置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自定义" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自定义" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "低内存" })).not.toBeInTheDocument();

    const ctxInput = screen.getByLabelText("上下文长度");
    await user.clear(ctxInput);
    await user.type(ctxInput, "16384");

    expect(onParametersChange).toHaveBeenLastCalledWith({
      ...profile.parameters,
      ctxSize: 16384,
    });
  });

  it("keeps the primary launch fields visible and advanced controls collapsed", async () => {
    const user = userEvent.setup();
    const profile = getProfileById("custom");
    render(
      <ParameterPanel
        profile={profile}
        parameters={profile.parameters}
        port={8080}
        onPortChange={vi.fn()}
        prometheusHints={emptyPrometheusHintsConfig()}
        parameterPresetSourceId={MODEL_FAMILY_AUTO_PRESET_SOURCE_ID}
        parameterPresetSources={parameterPresetSources}
        appliedParameterPresetName="Llama 通用"
        onParameterPresetSourceChange={vi.fn()}
        onPrometheusHintsChange={vi.fn()}
        onParametersChange={vi.fn()}
        onProfileChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("GPU 层数")).toBeVisible();
    expect(screen.getByLabelText("端口号")).toBeVisible();
    expect(screen.getByText("高级启动参数").closest("details")).not.toHaveAttribute("open");

    await user.click(screen.getByText("高级启动参数"));
    expect(screen.getByRole("switch", { name: /内存映射 mmap/ })).toHaveAttribute(
      "aria-checked",
      String(profile.parameters.mmap),
    );
    const help = screen.getByRole("button", { name: "CPU 线程说明" });
    expect(help).toHaveAttribute("aria-describedby");
  });

  it("shows maximum capability as an automatic read-only context mode", () => {
    const profile = getProfileById("max-capability");

    render(
      <ParameterPanel
        profile={profile}
        parameters={{ ...profile.parameters, ctxSize: 32768 }}
        modelContextLength={32768}
        port={8080}
        onPortChange={vi.fn()}
        prometheusHints={emptyPrometheusHintsConfig()}
        parameterPresetSourceId={MODEL_FAMILY_AUTO_PRESET_SOURCE_ID}
        parameterPresetSources={parameterPresetSources}
        appliedParameterPresetName="Llama 通用"
        onParameterPresetSourceChange={vi.fn()}
        onPrometheusHintsChange={vi.fn()}
        onParametersChange={vi.fn()}
        onProfileChange={vi.fn()}
      />,
    );

    expect(screen.getByText("已按模型能力自动拉满上下文")).toBeInTheDocument();
    expect(screen.getByText("32,768")).toBeInTheDocument();
    expect(screen.queryByLabelText("上下文长度")).not.toBeInTheDocument();
  });

  it("emits parameter preset source changes", async () => {
    const user = userEvent.setup();
    const profile = getProfileById("custom");
    const onParameterPresetSourceChange = vi.fn();

    render(
      <ParameterPanel
        profile={profile}
        parameters={profile.parameters}
        modelContextLength={32768}
        port={8080}
        onPortChange={vi.fn()}
        prometheusHints={emptyPrometheusHintsConfig()}
        parameterPresetSourceId={MODEL_FAMILY_AUTO_PRESET_SOURCE_ID}
        parameterPresetSources={parameterPresetSources}
        appliedParameterPresetName="Qwen 通用"
        onParameterPresetSourceChange={onParameterPresetSourceChange}
        onPrometheusHintsChange={vi.fn()}
        onParametersChange={vi.fn()}
        onProfileChange={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("参数来源"), "user:low-memory");

    expect(onParameterPresetSourceChange).toHaveBeenCalledWith("user:low-memory");
  });

  it("warns when projector candidates exist but none is enabled", () => {
    const profile = getProfileById("custom");

    render(
      <ParameterPanel
        profile={profile}
        parameters={{ ...profile.parameters, mmprojPath: null }}
        modelContextLength={32768}
        port={8080}
        onPortChange={vi.fn()}
        mmprojCandidates={["/models/mmproj-gemma.gguf"]}
        prometheusHints={emptyPrometheusHintsConfig()}
        parameterPresetSourceId={MODEL_FAMILY_AUTO_PRESET_SOURCE_ID}
        parameterPresetSources={parameterPresetSources}
        appliedParameterPresetName="Gemma"
        onParameterPresetSourceChange={vi.fn()}
        onPrometheusHintsChange={vi.fn()}
        onParametersChange={vi.fn()}
        onProfileChange={vi.fn()}
      />,
    );

    expect(screen.getByText("发现 projector，但尚未启用，图片输入不会生效。")).toBeInTheDocument();
  });

  it("shows when a projector is enabled", () => {
    const profile = getProfileById("custom");

    render(
      <ParameterPanel
        profile={profile}
        parameters={{ ...profile.parameters, mmprojPath: "/models/mmproj-gemma.gguf" }}
        modelContextLength={32768}
        port={8080}
        onPortChange={vi.fn()}
        mmprojCandidates={["/models/mmproj-gemma.gguf"]}
        prometheusHints={emptyPrometheusHintsConfig()}
        parameterPresetSourceId={MODEL_FAMILY_AUTO_PRESET_SOURCE_ID}
        parameterPresetSources={parameterPresetSources}
        appliedParameterPresetName="Gemma"
        onParameterPresetSourceChange={vi.fn()}
        onPrometheusHintsChange={vi.fn()}
        onParametersChange={vi.fn()}
        onProfileChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Projector 已启用，图片会随请求发送给 llama-server。")).toBeInTheDocument();
  });

  it("disables advanced controls for flags unsupported by the selected server", async () => {
    const user = userEvent.setup();
    const profile = getProfileById("custom");
    render(
      <ParameterPanel
        profile={profile}
        parameters={profile.parameters}
        port={8080}
        onPortChange={vi.fn()}
        prometheusHints={emptyPrometheusHintsConfig()}
        parameterPresetSourceId={MODEL_FAMILY_AUTO_PRESET_SOURCE_ID}
        parameterPresetSources={parameterPresetSources}
        appliedParameterPresetName="Llama 通用"
        onParameterPresetSourceChange={vi.fn()}
        onPrometheusHintsChange={vi.fn()}
        onParametersChange={vi.fn()}
        onProfileChange={vi.fn()}
        serverCapabilities={{
          binaryPath: "/bin/llama-server",
          versionText: "fixture",
          supportedFlags: ["--model", "--host", "--port"],
          status: "compatible",
          warnings: [],
        }}
      />,
    );

    await user.click(screen.getByText("高级启动参数"));
    expect(screen.getByLabelText("Flash Attention")).toBeDisabled();
    expect(screen.getByRole("switch", { name: /Metrics 监控/ })).toBeDisabled();
    expect(screen.getByLabelText("Batch 线程数")).toBeInTheDocument();
  });

  it("allows mmap to be disabled when the server exposes only --no-mmap", async () => {
    const user = userEvent.setup();
    const profile = getProfileById("custom");
    const onParametersChange = vi.fn();
    render(
      <ParameterPanel
        profile={profile}
        parameters={{ ...profile.parameters, mmap: true }}
        port={8080}
        onPortChange={vi.fn()}
        prometheusHints={emptyPrometheusHintsConfig()}
        parameterPresetSourceId={MODEL_FAMILY_AUTO_PRESET_SOURCE_ID}
        parameterPresetSources={parameterPresetSources}
        appliedParameterPresetName="Llama 通用"
        onParameterPresetSourceChange={vi.fn()}
        onPrometheusHintsChange={vi.fn()}
        onParametersChange={onParametersChange}
        onProfileChange={vi.fn()}
        serverCapabilities={{
          binaryPath: "/bin/llama-server",
          versionText: "fixture",
          supportedFlags: ["--model", "--host", "--port", "--no-mmap"],
          status: "compatible",
          warnings: [],
        }}
      />,
    );

    await user.click(screen.getByText("高级启动参数"));
    const mmap = screen.getByRole("switch", { name: /内存映射 mmap/ });
    expect(mmap).toBeEnabled();

    await user.click(mmap);
    expect(onParametersChange).toHaveBeenCalledWith({ ...profile.parameters, mmap: false });
  });

  it("allows mmap to return to the enabled server default without claiming --mmap support", async () => {
    const user = userEvent.setup();
    const profile = getProfileById("custom");
    const onParametersChange = vi.fn();
    render(
      <ParameterPanel
        profile={profile}
        parameters={{ ...profile.parameters, mmap: false }}
        port={8080}
        onPortChange={vi.fn()}
        prometheusHints={emptyPrometheusHintsConfig()}
        parameterPresetSourceId={MODEL_FAMILY_AUTO_PRESET_SOURCE_ID}
        parameterPresetSources={parameterPresetSources}
        appliedParameterPresetName="Llama 通用"
        onParameterPresetSourceChange={vi.fn()}
        onPrometheusHintsChange={vi.fn()}
        onParametersChange={onParametersChange}
        onProfileChange={vi.fn()}
        serverCapabilities={{
          binaryPath: "/bin/llama-server",
          versionText: "fixture",
          supportedFlags: ["--model", "--host", "--port", "--no-mmap"],
          status: "compatible",
          warnings: [],
        }}
      />,
    );

    await user.click(screen.getByText("高级启动参数"));
    const mmap = screen.getByRole("switch", { name: /内存映射 mmap/ });
    expect(mmap).toBeEnabled();

    await user.click(mmap);
    expect(onParametersChange).toHaveBeenCalledWith({ ...profile.parameters, mmap: true });
  });
});
