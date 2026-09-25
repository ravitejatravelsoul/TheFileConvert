import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("desktop nav links go to the right tool pages", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop-only test");
    await page.goto("/");
    await page.getByRole("link", { name: "PDF Tools", exact: true }).first().click();
    await expect(page).toHaveURL(/\/pdf\/merge$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Merge");
  });

  test("mobile menu opens and navigates", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile-only test");
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const aboutLink = page.getByRole("banner").getByRole("link", { name: "About", exact: true });
    await expect(aboutLink).toBeVisible();
    await aboutLink.click();
    await expect(page).toHaveURL(/\/about$/);
  });

  test("tool search finds a known tool", async ({ page }) => {
    await page.goto("/tools");
    await page.getByPlaceholder(/Search 40\+ file tools/).fill("compress image");
    await expect(page.getByTestId("tool-results").getByText("Compress Image", { exact: true })).toBeVisible();
  });

  test("tool search shows an empty state for nonsense queries", async ({ page }) => {
    await page.goto("/tools");
    await page.getByPlaceholder(/Search 40\+ file tools/).fill("zzzznonexistenttool");
    await expect(page.getByText(/No tools match/i)).toBeVisible();
  });

  test("tool status directory lists every tool with a status", async ({ page }) => {
    await page.goto("/tools/status");
    await expect(page.getByRole("heading", { name: "Tool status directory" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Merge PDF" })).toBeVisible();
    await expect(page.getByText("Coming soon").first()).toBeVisible();
  });
});
