import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("1000x680 supports the core start and stop flow without page-level horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.goto("/");

  await expect(
    page.getByRole("listbox", { name: "GGUF 模型列表" }).getByRole("option", { selected: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "启动", exact: true }).click();
  await page.getByRole("tab", { name: "运行" }).click();
  await expect(page.getByRole("region", { name: "当前运行状态" })).toBeVisible();
  await expect(page.getByText(/PID/).first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await page
    .getByRole("region", { name: "当前运行状态" })
    .getByRole("button", { name: "停止服务" })
    .click();
  await expect(page.getByRole("region", { name: "当前运行状态" })).toHaveCount(0);
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
