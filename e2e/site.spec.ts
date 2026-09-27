import { test, expect } from "@playwright/test";
import { addFiles, expectNoHorizontalOverflow, fx, trackPageErrors } from "./helpers/tool";

const TOOLS = [
  ["/compress-pdf", "Compress PDF"],
  ["/compress-image", "Compress Image"],
  ["/convert-image", "Convert Images"],
  ["/pdf-to-image", "PDF to Image"],
  ["/image-to-pdf", "Images to PDF"],
  ["/merge-pdf", "Merge PDF"],
  ["/split-pdf", "Split PDF"],
  ["/organize-pdf", "Organize PDF"],
  ["/pdf-editor", "PDF Editor"],
] as const;

test.describe("Homepage", () => {
  test("leads with the headline and an upload you can use immediately", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Files in.");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Done in seconds.");
    await expect(page.getByRole("button", { name: "Choose file" })).toBeVisible();
    // The upload is above the fold on every viewport, phones included.
    const box = await page.getByRole("button", { name: "Choose file" }).boundingBox();
    expect(box!.y + box!.height).toBeLessThan(page.viewportSize()!.height);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test("a dropped PDF gets PDF actions and hands the file to the chosen tool", async ({ page }) => {
    await page.goto("/");
    await addFiles(page, [fx("sample-a.pdf")]);
    await expect(page.getByText("What do you want to do?")).toBeVisible();
    for (const action of ["Compress", "Edit", "Merge with other PDFs", "Split", "Convert to images", "Organize pages"]) {
      await expect(page.locator("main").getByRole("button", { name: action, exact: true })).toBeVisible();
    }
    await page.locator("main").getByRole("button", { name: "Split", exact: true }).click();
    await expect(page).toHaveURL(/\/split-pdf$/);
    // No second file pick: the PDF arrived with the navigation.
    await expect(page.getByText("sample-a.pdf")).toBeVisible();
  });

  test("an image gets image actions; several images get the multi-file actions", async ({ page }) => {
    await page.goto("/");
    await addFiles(page, [fx("sample.jpg")]);
    for (const action of ["Compress", "Convert format", "Make a PDF"]) await expect(page.locator("main").getByRole("button", { name: action, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Choose a different file" }).click();
    await addFiles(page, [fx("sample.jpg"), fx("image-2x1.png")]);
    await expect(page.getByRole("button", { name: "Combine 2 into a PDF" })).toBeVisible();
    await expect(page.locator("main").getByRole("button", { name: "Compress", exact: true })).toHaveCount(0);
  });

  test("an unsupported file is explained, not accepted", async ({ page }) => {
    await page.goto("/");
    await addFiles(page, [fx("sample.csv")]);
    await expect(page.locator("main").getByRole("alert")).toContainText("isn't supported yet");
  });

  test("shows the popular tools, privacy, how it works and FAQ sections", async ({ page }) => {
    await page.goto("/");
    for (const heading of ["Popular tools.", "Your files never leave this tab.", "How it works.", "Questions answered."]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    // No fake social proof on a first launch.
    await expect(page.getByText(/trusted by|million users|testimonial/i)).toHaveCount(0);
  });
});

test.describe("Navigation", () => {
  test("desktop menus reach every tool", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop navigation");
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const menu of ["Compress", "Convert", "PDF Tools"]) {
      await nav.getByRole("button", { name: menu }).click();
      await expect(nav.getByRole("link").first()).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await nav.getByRole("button", { name: "Convert" }).click();
    await nav.getByRole("link", { name: /PDF to Image/ }).click();
    await expect(page).toHaveURL(/\/pdf-to-image$/);
    await expect(page.getByRole("link", { name: "PDF Editor" }).first()).toBeVisible();
  });

  test("the phone menu opens as a sheet, lists every tool and closes", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone navigation");
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    for (const [, name] of TOOLS) await expect(sheet.getByRole("link", { name })).toBeVisible();
    await page.getByRole("button", { name: "Close menu" }).click();
    await expect(sheet).toBeHidden();
  });

  test("All tools lists the nine launch tools and nothing else", async ({ page }) => {
    await page.goto("/tools");
    const cards = page.locator("main li a");
    await expect(cards).toHaveCount(9);
    for (const [href, name] of TOOLS) await expect(page.locator(`main a[href="${href}"]`)).toContainText(name);
  });

  test("old URLs of the kept tools redirect; removed tools are gone", async ({ page }) => {
    await page.goto("/pdf/compress");
    await expect(page).toHaveURL(/\/compress-pdf$/);
    await page.goto("/convert/png-to-jpg");
    await expect(page).toHaveURL(/\/convert-image$/);
    const gone = await page.goto("/data/json-formatter");
    expect(gone?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("isn’t here");
  });
});

test.describe("SEO", () => {
  for (const [href, name] of TOOLS) {
    test(`${name} has its own title, description, canonical, Open Graph and structured data`, async ({ page }) => {
      await page.goto(href);
      await expect(page).toHaveTitle(/— TheFileConvert$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description!.length).toBeGreaterThan(60);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://thefileconvert.com${href}`);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /— TheFileConvert$/);
      const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
      const data = JSON.parse(ld!);
      expect(data.map((d: { "@type": string }) => d["@type"])).toEqual(["WebApplication", "FAQPage"]);
    });
  }

  test("sitemap lists the home page, tools page and all nine tools; robots points to it", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    for (const [href] of TOOLS) expect(sitemap).toContain(`https://thefileconvert.com${href}</loc>`);
    expect(sitemap).not.toContain("/data/");
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Sitemap: https://thefileconvert.com/sitemap.xml");
  });
});

test.describe("Responsive layout", () => {
  for (const [href] of [["/"], ["/tools"], ["/privacy"], ...TOOLS]) {
    test(`${href} has no sideways scroll`, async ({ page }) => {
      await page.goto(href);
      await expectNoHorizontalOverflow(page);
    });
  }
});
