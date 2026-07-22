import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { SamplingPanel } from "./SamplingPanel";
import type { SamplingParameters } from "../types/domain";

const baseSampling: SamplingParameters = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  minP: 0.05,
  repeatPenalty: 1.1,
  repeatLastN: 64,
  seed: null,
  maxTokens: 1024,
  stop: [],
};

describe("SamplingPanel", () => {
  it("restores controlled advanced visibility and reports toggles", async () => {
    const user = userEvent.setup();
    const onAdvancedOpenChange = vi.fn();
    render(
      <SamplingPanel
        {...({
          parameterMode: "custom",
          sampling: baseSampling,
          ctxSize: 8192,
          onSamplingChange: vi.fn(),
          advancedOpen: true,
          onAdvancedOpenChange,
        } as React.ComponentProps<typeof SamplingPanel> & {
          advancedOpen: boolean;
          onAdvancedOpenChange: (open: boolean) => void;
        })}
      />,
    );

    expect(screen.getByLabelText("top-k")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /高级采样参数/ }));
    expect(onAdvancedOpenChange).toHaveBeenCalledWith(false);
  });

  it("emits updated maxTokens values", async () => {
    const user = userEvent.setup();
    const onSamplingChange = vi.fn();

    function Host() {
      const [sampling, setSampling] = useState<SamplingParameters>(baseSampling);
      return (
        <SamplingPanel
          parameterMode="custom"
          sampling={sampling}
          ctxSize={8192}
          advancedOpen={false}
          onAdvancedOpenChange={vi.fn()}
          onSamplingChange={(next) => {
            setSampling(next);
            onSamplingChange(next);
          }}
        />
      );
    }

    render(<Host />);

    const input = screen.getByLabelText("输出最大长度");
    await user.clear(input);
    await user.type(input, "256");

    expect(onSamplingChange).toHaveBeenLastCalledWith({
      ...baseSampling,
      maxTokens: 256,
    });
  });

  it("uses a slider for custom output length", () => {
    const onSamplingChange = vi.fn();

    render(
      <SamplingPanel
        parameterMode="custom"
        sampling={baseSampling}
        ctxSize={8192}
        advancedOpen={false}
        onAdvancedOpenChange={vi.fn()}
        onSamplingChange={onSamplingChange}
      />,
    );

    const slider = screen.getByRole("slider", { name: "输出最大长度滑杆" });
    fireEvent.change(slider, { target: { value: "2048" } });

    expect(onSamplingChange).toHaveBeenLastCalledWith({
      ...baseSampling,
      maxTokens: 2048,
    });
  });

  it("shows maximum capability output as automatic", () => {
    render(
      <SamplingPanel
        parameterMode="max-capability"
        sampling={{ ...baseSampling, maxTokens: 7536 }}
        ctxSize={8192}
        advancedOpen={false}
        onAdvancedOpenChange={vi.fn()}
        onSamplingChange={vi.fn()}
      />,
    );

    expect(screen.getByText("输出已按当前上下文自动拉到安全上限")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "长记忆" })).not.toBeInTheDocument();
  });

  it("exposes advanced sampling fields after expanding", async () => {
    const user = userEvent.setup();
    const onSamplingChange = vi.fn();

    function Host() {
      const [sampling, setSampling] = useState<SamplingParameters>({ ...baseSampling, maxTokens: 1500 });
      const [advancedOpen, setAdvancedOpen] = useState(false);
      return (
        <SamplingPanel
          parameterMode="custom"
          sampling={sampling}
          ctxSize={4096}
          advancedOpen={advancedOpen}
          onAdvancedOpenChange={setAdvancedOpen}
          onSamplingChange={(next) => {
            setSampling(next);
            onSamplingChange(next);
          }}
        />
      );
    }

    render(<Host />);

    expect(screen.queryByLabelText("top-k")).toBeNull();

    await user.click(screen.getByRole("button", { name: /高级采样参数/ }));

    expect(screen.getByLabelText("top-k")).toBeInTheDocument();
    expect(screen.getByLabelText("min-p")).toBeInTheDocument();
    expect(screen.getByLabelText("重复惩罚（repeat-penalty）")).toBeInTheDocument();
  });

  it("parses stop sequences from textarea", async () => {
    const user = userEvent.setup();
    const onSamplingChange = vi.fn();

    function Host() {
      const [sampling, setSampling] = useState<SamplingParameters>(baseSampling);
      const [advancedOpen, setAdvancedOpen] = useState(false);
      return (
        <SamplingPanel
          parameterMode="custom"
          sampling={sampling}
          ctxSize={8192}
          advancedOpen={advancedOpen}
          onAdvancedOpenChange={setAdvancedOpen}
          onSamplingChange={(next) => {
            setSampling(next);
            onSamplingChange(next);
          }}
        />
      );
    }

    render(<Host />);
    await user.click(screen.getByRole("button", { name: /高级采样参数/ }));
    const stopBox = screen.getByLabelText("停用序列（每行一个，stop）");
    fireEvent.change(stopBox, { target: { value: "END\n###" } });

    const last = onSamplingChange.mock.calls.at(-1)?.[0] as SamplingParameters;
    expect(last.stop).toEqual(["END", "###"]);
  });

  it("warns when prompt budget is unhealthy", () => {
    function Host() {
      const [sampling, setSampling] = useState<SamplingParameters>({ ...baseSampling, maxTokens: 4000 });
      return (
        <SamplingPanel
          parameterMode="custom"
          sampling={sampling}
          ctxSize={4096}
          onSamplingChange={setSampling}
          advancedOpen={false}
          onAdvancedOpenChange={vi.fn()}
        />
      );
    }
    render(<Host />);
    expect(screen.getByText(/预留输出过大可能导致历史上下文不足/)).toBeInTheDocument();
  });
});
