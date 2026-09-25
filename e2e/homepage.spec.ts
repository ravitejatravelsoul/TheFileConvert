import { test, expect } from "@playwright/test";

test.describe("Homepage", () => {
  test("loads with hero, drop zone, and no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Every file.");
    await expect(page.getByText("Drop your files here")).toBeVisible();
    await expect(page.getByText("Free", { exact: false }).first()).toBeVisible();

    expect(errors, `Console/page errors on homepage: ${errors.join("; ")}`).toEqual([]);
  });

  test("shows popular tools, categories, and FAQ sections", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Most used" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start with a category" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your files are yours." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Frequently asked questions" })).toBeVisible();
  });

  test("has no pricing, login, or signup CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /^log ?in$/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^sign ?up$/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^pricing$/i })).toHaveCount(0);
  });

  test("footer includes privacy and terms links", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Terms", exact: true }).first()).toBeVisible();
  });
});
