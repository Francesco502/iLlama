import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";

describe("ChatPanel", () => {
  it("sends typed messages with Cmd+Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<ChatPanel messages={[]} disabled={false} streaming={false} onCancel={vi.fn()} onSend={onSend} onClear={vi.fn()} />);

    const input = screen.getByPlaceholderText("输入消息，与本地模型对话…");
    await user.type(input, "你好{Meta>}{Enter}{/Meta}");

    expect(onSend).toHaveBeenCalledWith({ text: "你好", attachments: [] });
    expect(input).toHaveValue("");
  });

  it("shows a cancel action while streaming", () => {
    render(<ChatPanel messages={[]} disabled={false} streaming onCancel={vi.fn()} onSend={vi.fn()} onClear={vi.fn()} />);

    expect(screen.getByRole("button", { name: "取消生成" })).toBeEnabled();
  });

  it("sends image attachments with the typed prompt", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const image = new File(["fake image"], "screenshot.png", { type: "image/png" });

    render(<ChatPanel messages={[]} disabled={false} streaming={false} onCancel={vi.fn()} onSend={onSend} onClear={vi.fn()} />);

    await user.upload(screen.getByLabelText("选择图片附件"), image);
    expect(await screen.findByText("screenshot.png")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("输入消息，与本地模型对话…"), "看一下这张图");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(onSend).toHaveBeenCalledWith({
      text: "看一下这张图",
      attachments: [
        expect.objectContaining({
          name: "screenshot.png",
          mimeType: "image/png",
          dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
        }),
      ],
    });
  });
});
