import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { getProfileById } from "../lib/parameterSchema";
import { ParameterPanel } from "./ParameterPanel";
import type { PrometheusHintsConfig, StartupParameters } from "../types/domain";
import { emptyPrometheusHintsConfig } from "../types/domain";

describe("ParameterPanel", () => {
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

    expect(screen.getByRole("button", { name: "最大能力" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自定义" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "低内存" })).not.toBeInTheDocument();

    const ctxInput = screen.getByLabelText("上下文长度");
    await user.clear(ctxInput);
    await user.type(ctxInput, "16384");

    expect(onParametersChange).toHaveBeenLastCalledWith({
      ...profile.parameters,
      ctxSize: 16384,
    });
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
        onPrometheusHintsChange={vi.fn()}
        onParametersChange={vi.fn()}
        onProfileChange={vi.fn()}
      />,
    );

    expect(screen.getByText("已按模型能力自动拉满上下文")).toBeInTheDocument();
    expect(screen.getByText("32,768")).toBeInTheDocument();
    expect(screen.queryByLabelText("上下文长度")).not.toBeInTheDocument();
  });
});
