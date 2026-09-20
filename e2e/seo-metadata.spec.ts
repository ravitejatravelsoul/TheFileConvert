import { test, expect } from "@playwright/test";

test.describe("Per-page SEO metadata", () => {
  test("the homepage declares the production domain as its canonical URL", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://thefileconvert.com");
  });

  test("a tool page has its own OpenGraph/Twitter title, not the homepage's", async ({ page }) => {
    await page.goto("/pdf/merge");
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
    const twitterTitle = await page.locator('meta[name="twitter:title"]').getAttribute("content");
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");

    expect(ogTitle).toContain("Merge PDF");
    expect(ogTitle).not.toContain("Every File. Any Format.");
    expect(ogUrl).toBe("https://thefileconvert.com/pdf/merge");
    expect(twitterTitle).toContain("Merge PDF");
    expect(canonical).toBe("https://thefileconvert.com/pdf/merge");
  });

  test("two different tool pages have distinct titles and descriptions", async ({ page }) => {
    await page.goto("/pdf/merge");
    const titleA = await page.title();
    const descA = await page.locator('meta[name="description"]').getAttribute("content");

    await page.goto("/image/compress");
    const titleB = await page.title();
    const descB = await page.locator('meta[name="description"]').getAttribute("content");

    expect(titleA).not.toBe(titleB);
    expect(descA).not.toBe(descB);
  });

  test("sitemap and robots reference the production domain", async ({ page }) => {
    const robots = await page.goto("/robots.txt");
    const robotsText = await robots?.text();
    expect(robotsText).toContain("https://thefileconvert.com/sitemap.xml");

    const sitemapRes = await page.goto("/sitemap.xml");
    const sitemapText = await sitemapRes?.text();
    expect(sitemapText).toContain("https://thefileconvert.com");
    expect(sitemapText).toContain("<loc>https://thefileconvert.com/pdf/merge</loc>");
  });
});
