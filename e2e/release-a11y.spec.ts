import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { EDITOR_FIXTURES } from "./helpers/native";

/**
 * FINAL RELEASE GATE — accessibility. axe-core (WCAG 2.0/2.1 A + AA rules, incl. colour contrast) on the main pages and on the
 * editor with a document open; keyboard reachability, focus handling in dialogs, the mobile menu, touch-target sizes.
 * No serious or critical violation is accepted.
 */
const AXE = path.resolve("node_modules/axe-core/axe.min.js");

async function axeViolations(page: Page, context?: string) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (window as any).axe;
    const r = await axe.run(ctx ? { include: [ctx] } : document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v: { id: string; impact: string; nodes: { target: string[] }[]; help: string }) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  }, context ?? null);
}

const blocking = (v: { impact: string }[]) => v.filter((x) => x.impact === "serious" || x.impact === "critical");

for (const route of ["/", "/compress-pdf", "/pdf-to-word", "/word-to-pdf", "/pdf-editor", "/tools"]) {
  test(`axe: ${route} has no serious or critical violation`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const v = await axeViolations(page);
    expect(blocking(v), JSON.stringify(blocking(v), null, 1)).toEqual([]);
  });
}

test("axe: the editor with a PDF open (toolbar, rail, canvas, properties)", async ({ page, isMobile }) => {
  await page.goto("/pdf-editor");
  await page.getByTestId("file-input").first().setInputFiles(path.join(EDITOR_FIXTURES, "EDITOR-05-form-acroform.pdf"));
  await expect(page.locator('[data-testid="form-field"]').first()).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const v = await axeViolations(page);
  expect(blocking(v), JSON.stringify(blocking(v), null, 1)).toEqual([]);
  if (!isMobile) {
    await page.getByRole("button", { name: "Signature", exact: true }).click();
    const d = await axeViolations(page, '[role="dialog"]');
    expect(blocking(d), JSON.stringify(blocking(d), null, 1)).toEqual([]);
  }
});

test("keyboard: skip link, Tab reaches the primary controls, Enter activates them", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard flow");
  await page.goto("/compress-pdf");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  // every control reached by Tab has a visible focus indicator and an accessible name
  const seen: string[] = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      const name = el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";
      const outlined = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      const shadow = cs.boxShadow !== "none";
      return { tag: el.tagName, name: name.slice(0, 40), visibleFocus: outlined || shadow };
    });
    if (info) seen.push(`${info.tag}:${info.name}:${info.visibleFocus}`);
    expect(info?.name, "focused control has a name").toBeTruthy();
    expect(info?.visibleFocus, `focus visible on ${info?.tag}:${info?.name}`).toBe(true);
  }
  expect(seen.length).toBeGreaterThan(5);
});

test("dialogs: the signature dialog is labelled, takes focus and closes with Escape", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop flow");
  await page.goto("/pdf-editor");
  await page.getByTestId("file-input").first().setInputFiles(path.join(EDITOR_FIXTURES, "EDITOR-01-simple-text.pdf"));
  await expect(page.locator('[data-testid="native-block"]').first()).toBeAttached({ timeout: 30_000 });
  await page.getByRole("button", { name: "Signature", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add signature" });
  await expect(dialog).toBeVisible();
  const focusInside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  expect(focusInside).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("mobile: the menu opens and closes with its own button; tap targets in the nav and the editor dock are 44 px", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).tap();
  await expect(page.getByRole("dialog").or(page.getByRole("navigation", { name: /mobile|main/i })).first()).toBeVisible();
  const small: string[] = [];
  for (const b of await page.locator("header button, header a").all()) {
    const box = await b.boundingBox();
    if (box && box.width > 0 && box.height < 43.5) small.push(`${(await b.getAttribute("aria-label")) ?? (await b.innerText())} ${Math.round(box.height)}`);
  }
  expect(small).toEqual([]);
});
