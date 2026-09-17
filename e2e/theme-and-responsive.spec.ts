import { test, expect } from "@playwright/test";

test.describe("Dark mode", () => {
  test("toggling theme updates the document attribute and persists on reload", async ({ page, isMobile }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");

    if (isMobile) {
      await page.getByRole("button", { name: "Open menu" }).click();
    }
    await page.getByRole("button", { name: /Switch to dark mode/i }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("Responsive layout", () => {
  test("no horizontal overflow at common viewport widths", async ({ page }) => {
    for (const width of [375, 768, 1366, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      expect(hasOverflow, `horizontal overflow at ${width}px`).toBe(false);
    }
  });
});
