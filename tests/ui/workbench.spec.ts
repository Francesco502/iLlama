import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installTestOnlyTauriIpcFixture } from "./fixtures/testOnlyTauriIpc";

test("1000x680 preview supports warning recovery without horizontal scrolling or native claims", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.goto("/");

  await expect(
    page.getByRole("listbox", { name: "GGUF 模型列表" }).getByRole("option", { selected: true }),
  ).toBeVisible();
  const alignContext = page.getByRole("button", { name: "一键对齐到 4,096" });
  await expect(alignContext).toBeVisible();
  await alignContext.click();
  await expect(alignContext).toHaveCount(0);

  await page.getByRole("button", { name: "启动", exact: true }).click();
  await expect(page.getByRole("region", { name: "当前运行状态" })).toHaveCount(0);
  await page.getByRole("button", { name: "日志 2", exact: true }).click();
  await expect(
    page.getByText("浏览器预览模式仅展示界面，无法执行原生 llama-server。"),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test("tabs, log dock and resize handle are keyboard operable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  const connectTab = page.getByRole("tab", { name: "连接" });
  await connectTab.focus();
  await page.keyboard.press("Enter");
  await expect(connectTab).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: /日志 \d+/ }).click();
  const drawer = page.locator(".log-drawer");
  await expect(drawer).toBeVisible();
  const separator = drawer.getByRole("separator", { name: "调整日志面板高度" });
  await separator.focus();
  await page.keyboard.press("ArrowUp");
  await expect(separator).toHaveAttribute("aria-valuenow", "204");

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveAttribute("aria-hidden", "true");
});

test("workbench has no serious accessibility violations in light and dark modes", async ({
  page,
}) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1000, height: 680 });
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(blocking, `${colorScheme} accessibility violations`).toEqual([]);
  }
});

test("keyboard semantics use explicit test-only IPC and HTTP fixtures", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installTestOnlyTauriIpcFixture(page);
  await page.route("http://127.0.0.1:8080/health", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"ok"}' }),
  );
  await page.route("http://127.0.0.1:8080/v1/models", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"data":[{"id":"local"}]}' }),
  );
  await page.route("http://127.0.0.1:8080/v1/chat/completions", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.abort();
  });
  await page.goto("/");

  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __ILLAMA_TEST_ONLY_IPC__?: { kind: string } })
      .__ILLAMA_TEST_ONLY_IPC__?.kind,
  )).toBe("browser-test-only");

  const selectedModel = page
    .getByRole("listbox", { name: "GGUF 模型列表" })
    .getByRole("option", { selected: true });
  await selectedModel.focus();
  await page.keyboard.press("Enter");
  const start = page.getByRole("button", { name: "启动", exact: true });
  await start.focus();
  await page.keyboard.press("Enter");

  const connectTab = page.getByRole("tab", { name: "连接" });
  await connectTab.focus();
  await page.keyboard.press("Enter");
  const check = page.getByRole("button", { name: "检测连接" });
  await check.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("检测通过")).toBeVisible();

  const testTab = page.getByRole("tab", { name: "测试" });
  await testTab.focus();
  await page.keyboard.press("Enter");
  const composer = page.getByPlaceholder(/输入消息/);
  await composer.fill("hello");
  await composer.press("Enter");
  const cancel = page.getByRole("button", { name: "取消生成" });
  await expect(cancel).toBeVisible();
  await cancel.focus();
  await page.keyboard.press("Enter");

  const runTab = page.getByRole("tab", { name: "运行" });
  await runTab.focus();
  await page.keyboard.press("Enter");
  const stop = page.getByRole("button", { name: "停止服务" });
  await stop.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "当前运行状态" })).toHaveCount(0);

  const ipcCalls = await page.evaluate(() =>
    (window as unknown as { __ILLAMA_TEST_ONLY_IPC__: { calls: string[] } })
      .__ILLAMA_TEST_ONLY_IPC__.calls,
  );
  expect(ipcCalls).toEqual(expect.arrayContaining(["start_llama_command", "stop_llama_command"]));
});
