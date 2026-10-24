import path from "node:path";
import fs from "node:fs";
import { expect, type Download, type Locator, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

export const FIXTURES = path.join(__dirname, "..", "fixtures");
export const fx = (...parts: string[]) => path.join(FIXTURES, ...parts);

/** Adds files through a tool's own file input (what its visible "Choose …" button opens). */
export async function addFiles(page: Page, files: string[] | { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByTestId("file-input").first().setInputFiles(files);
}

/** Clicks a download button and returns the downloaded bytes. */
export async function downloadFrom(page: Page, button: Locator): Promise<{ download: Download; bytes: Buffer }> {
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const file = await download.path();
  return { download, bytes: fs.readFileSync(file) };
}

export async function pdfPageCount(bytes: Buffer): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

/** Fails if the page scrolls sideways. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Collects uncaught page errors for a test. */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}
