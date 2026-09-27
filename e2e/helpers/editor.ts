import type { Locator, Page } from "@playwright/test";

/** Tools that live in a dock menu rather than as their own dock button. */
const MENU_OF: Record<string, "Shapes" | "More"> = {
  Rectangle: "Shapes",
  Ellipse: "Shapes",
  Line: "Shapes",
  Arrow: "Shapes",
  Strike: "More",
  Strikethrough: "More",
  Crop: "More",
};
const RENAMED: Record<string, string> = { Strike: "Strikethrough", Sign: "Signature" };

/** Arms an editor tool by the name a user sees, opening the Shapes/More menu when needed. */
export async function pickTool(page: Page, name: string) {
  const label = RENAMED[name] ?? name;
  const menu = MENU_OF[name];
  if (menu) {
    await page.getByRole("button", { name: menu, exact: true }).click();
    await page.getByRole("menuitemradio", { name: label, exact: true }).click();
  } else {
    await page.getByRole("button", { name: label, exact: true }).click();
  }
}

/** The dock control whose aria-pressed shows whether `name` is armed (the menu button for menu tools). */
export function toolButton(page: Page, name: string): Locator {
  const menu = MENU_OF[name];
  return page.getByRole("button", { name: menu ?? RENAMED[name] ?? name, exact: true });
}
