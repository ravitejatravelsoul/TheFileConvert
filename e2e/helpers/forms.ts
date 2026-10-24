import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { clipOf, diffCount, ink, shot } from "./pixels";
import { openEditor } from "./native";

export const FORMS = path.join(__dirname, "..", "..", "qa", "form-fixtures");
export const form = (n: string) => path.join(FORMS, n);

export const field = (page: Page, name: string, option?: string) =>
  page.locator(`[data-testid="form-field"][data-field-name="${name}"]${option ? `[data-option="${option}"]` : ""}`);

export const HIDE_OVERLAYS = '[data-testid="form-field"]{visibility:hidden !important}';
export const HIDE_CANVAS = '[data-testid="page-surface"] canvas{visibility:hidden !important}';

export async function openForm(page: Page, file: string, hasFields = true) {
  await openEditor(page, file);
  if (hasFields) await expect(page.locator('[data-testid="form-field"]').first()).toBeAttached({ timeout: 20_000 });
  await page.waitForTimeout(700);
}

/** The field is drawn from its current value and nothing is pending. */
export async function settled(page: Page, name: string, option?: string) {
  await expect(field(page, name, option)).toHaveAttribute("data-state", "idle", { timeout: 15_000 });
  await page.waitForTimeout(250);
}

/** Nothing sits on top of the page picture that isn't the picture itself: showing the overlays changes no pixel. */
export async function expectNoOverlayGhost(page: Page, name: string, option?: string) {
  const clip = await clipOf(field(page, name, option), 0);
  const withOverlays = await shot(page, clip);
  const canvasOnly = await shot(page, clip, HIDE_OVERLAYS);
  expect(diffCount(withOverlays, canvasOnly), `${name}: overlay changes pixels over the page picture`).toBe(0);
  return canvasOnly;
}

/** While editing, the box is the only thing there: hiding the page picture changes no pixel (nothing underneath shows through). */
export async function expectOpaqueWhileEditing(page: Page, name: string) {
  await page.waitForTimeout(300);
  const clip = await clipOf(field(page, name), 0);
  const all = await shot(page, clip);
  const boxOnly = await shot(page, clip, HIDE_CANVAS);
  expect(diffCount(all, boxOnly, 110), `${name}: the original appearance shows through the edit box`).toBe(0);
  return all;
}

/** The edit box has the same look as the appearance it replaces: same ink extent (size, position, alignment) within `tolPx`. */
export function expectSameInk(a: ReturnType<typeof ink>, b: ReturnType<typeof ink>, tolPx: number, label: string) {
  expect(a.empty || b.empty, `${label}: no ink`).toBe(false);
  for (const k of ["x0", "y0", "x1", "y1"] as const) expect(Math.abs(a[k] - b[k]), `${label}: ${k} differs (${a[k]} vs ${b[k]})`).toBeLessThanOrEqual(tolPx);
}
