import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { getProfileById } from "../lib/parameterSchema";
import { ParameterPanel } from "./ParameterPanel";
import type { StartupParameters } from "../types/domain";

describe("ParameterPanel", () => {
  it("emits updated context size values", async () => {
    const user = userEvent.setup();
    const profile = getProfileById("balanced");
    const onParametersChange = vi.fn();

    function Host() {
      const [parameters, setParameters] = useState<StartupParameters>(profile.parameters);
      return (
        <ParameterPanel
          profile={profile}
          parameters={parameters}
          port={8080}
          onPortChange={vi.fn()}
          onParametersChange={(next) => {
            setParameters(next);
            onParametersChange(next);
          }}
          onProfileChange={vi.fn()}
        />
      );
    }

    render(<Host />);

    const ctxInput = screen.getByLabelText("上下文长度");
    await user.clear(ctxInput);
    await user.type(ctxInput, "16384");

    expect(onParametersChange).toHaveBeenLastCalledWith({
      ...profile.parameters,
      ctxSize: 16384,
    });
  });
});
