import { test, expect } from "@playwright/test";
import { liveTools } from "../src/lib/tools/registry";

test.describe("Smoke: every live tool page renders without errors", () => {
  for (const tool of liveTools) {
    test(`${tool.href} renders`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));

      await page.goto(tool.href);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(tool.name);

      expect(errors, `Runtime errors on ${tool.href}: ${errors.join("; ")}`).toEqual([]);
    });
  }
});
