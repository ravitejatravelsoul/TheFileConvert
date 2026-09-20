import { test, expect } from "@playwright/test";

test.describe("Data conversion workflow", () => {
  test("converts CSV input to JSON output", async ({ page }) => {
    await page.goto("/data/csv-to-json");

    const input = page.getByPlaceholder(/name,email/);
    await input.fill("name,age\nAda,30\nGrace,32");
    await page.getByRole("button", { name: "Convert to JSON" }).click();

    const output = page.getByPlaceholder("Your result will appear here.");
    await expect(output).toHaveValue(/"name": "Ada"/);
    await expect(output).toHaveValue(/"age": "32"/);
  });

  test("JSON formatter pretty-prints and reports invalid JSON", async ({ page }) => {
    await page.goto("/data/json-formatter");
    const input = page.getByPlaceholder('{"hello": "world"}');
    await input.fill('{"a":1,"b":2}');
    await page.getByRole("button", { name: "Format JSON" }).click();
    const output = page.getByPlaceholder("Your result will appear here.");
    await expect(output).toHaveValue('{\n  "a": 1,\n  "b": 2\n}');

    await input.fill("{not valid json");
    await page.getByRole("button", { name: "Format JSON" }).click();
    await expect(page.getByText(/isn't valid JSON/i)).toBeVisible();
  });

  test("word counter updates live as you type", async ({ page }) => {
    await page.goto("/data/word-counter");
    await page.getByPlaceholder(/Start typing/).fill("The quick brown fox jumps");
    await expect(page.getByText("5", { exact: true })).toBeVisible();
  });

  test("UUID generator produces well-formed UUIDs", async ({ page }) => {
    await page.goto("/data/uuid-generator");
    const code = page.locator("code").first();
    const value = await code.textContent();
    expect(value?.trim()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test("CSV to JSON handles quoted commas, escaped quotes, and embedded newlines", async ({ page }) => {
    await page.goto("/data/csv-to-json");
    const csv = [
      'name,role,bio',
      '"Doe, John",Engineer,"Loves ""clean code"" and coffee"',
      'Ada Lovelace,Mathematician,"Wrote the first algorithm.\nWorked with Babbage."',
    ].join("\r\n");
    await page.getByPlaceholder(/name,email/).fill(csv);
    await page.getByRole("button", { name: "Convert to JSON" }).click();

    const outputText = await page.getByPlaceholder("Your result will appear here.").inputValue();
    const parsed = JSON.parse(outputText);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("Doe, John");
    expect(parsed[0].bio).toBe('Loves "clean code" and coffee');
    expect(parsed[1].bio).toContain("\n");
  });
});

test.describe("Text and document converters: whitespace-only input counts as empty", () => {
  const converters: { route: string; button: string }[] = [
    { route: "/document/txt-to-pdf", button: "Convert to PDF" },
    { route: "/document/markdown-to-pdf", button: "Convert to PDF" },
    { route: "/document/txt-to-html", button: "Convert to HTML" },
    { route: "/document/markdown-to-html", button: "Convert to HTML" },
    { route: "/data/json-formatter", button: "Format JSON" },
    { route: "/data/csv-to-json", button: "Convert to JSON" },
    { route: "/data/json-to-csv", button: "Convert to CSV" },
    { route: "/data/xml-formatter", button: "Format XML" },
    { route: "/data/base64", button: "Encode" },
    { route: "/data/url-encode-decode", button: "Encode" },
    { route: "/data/case-converter", button: "Convert case" },
  ];

  for (const { route, button } of converters) {
    test(`${route}: spaces, tabs and blank lines show the empty-input message and produce nothing`, async ({ page }) => {
      await page.goto(route);
      await page.locator("textarea").first().fill("   \n\t  \n ");
      await page.getByRole("button", { name: button }).click();
      await expect(page.getByText("Paste or type some content first.")).toBeVisible();
      // No result was produced: no download offered, no output text.
      await expect(page.getByRole("button", { name: /^Download/ })).toHaveCount(0);
      const outputs = page.getByPlaceholder("Your result will appear here.");
      if (await outputs.count()) await expect(outputs.first()).toHaveValue("");
    });
  }

  test("real content still converts after an empty attempt", async ({ page }) => {
    await page.goto("/document/txt-to-pdf");
    await page.locator("textarea").first().fill("  ");
    await page.getByRole("button", { name: "Convert to PDF" }).click();
    await expect(page.getByText("Paste or type some content first.")).toBeVisible();
    await page.locator("textarea").first().fill("Hello");
    await page.getByRole("button", { name: "Convert to PDF" }).click();
    await expect(page.getByRole("button", { name: /^Download/ }).first()).toBeVisible();
  });
});
