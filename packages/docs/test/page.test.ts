import { expect, test } from "@playwright/test";

test("renders the single-page docs without overflow or runtime errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.text().includes("ERROR (#")) errors.push(message.text());
  });

  await page.goto("/");
  await expect(page).toHaveTitle("fs-durable — a filesystem for Durable Objects");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A filesystem for Durable Objects.");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.locator("main > p .justice-line").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("SQLite-backed Durable Object");
  const diagram = page.getByRole("img", { name: /^Architecture:/ });
  await expect(diagram).toBeVisible();
  await expect(diagram).toHaveJSProperty("tagName", "DIV");
  await expect(diagram).not.toContainText("┌");
  await expect(diagram).toContainText("Application or agent");
  await expect(diagram).toContainText("fs-durable");
  await expect(diagram).toContainText("storage.transactionSync()");
  await expect(diagram).toContainText("Private SQLite database");
  await expect(page.getByRole("main")).toContainText("it does not execute it");
  await expect(page.getByLabel("Filesystem usage example")).toContainText("writeFileString");
  const code = page.getByLabel("Filesystem usage example");
  await expect(code.locator(".hljs-keyword").first()).toHaveText("const");
  await expect(code.locator(".hljs-string").first()).toHaveText('"/src"');
  await expect(code.locator(".hljs-keyword").first()).toHaveCSS("color", "rgb(196, 181, 253)");
  await expect(code.locator(".hljs-string").first()).toHaveCSS("color", "rgb(167, 243, 208)");
  await expect(page.getByRole("link", { name: "Read the library documentation" })).toHaveCount(0);
  await expect(page.getByText("Built with", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("main")).toHaveCSS("font-family", /monospace/);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");

  const layout = await page.getByRole("main").evaluate((main) => ({
    width: main.getBoundingClientRect().width,
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(layout.width).toBeLessThanOrEqual(672);
  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("docs.png"), fullPage: true });
});

test("Justice preserves paragraph text, selection, and copying across responsive reflow", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const paragraph = page.locator("main > p").first();
  const firstLine = paragraph.locator(".justice-line").first();
  await expect(firstLine).toBeVisible();
  const original = await paragraph.textContent();
  const firstLineBefore = await firstLine.textContent();

  await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(original);
  await page.keyboard.press("Control+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(original);

  await page.setViewportSize({ width: (page.viewportSize()?.width ?? 1280) > 640 ? 375 : 960, height: 900 });
  await expect(firstLine).not.toHaveText(firstLineBefore ?? "");
  expect(await paragraph.textContent()).toBe(original);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(original);
  await page.keyboard.press("Control+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(original);
});
