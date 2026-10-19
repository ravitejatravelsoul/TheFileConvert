import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { exportPdf } from "./helpers/native";
import { HIDE_OVERLAYS, expectNoOverlayGhost, expectOpaqueWhileEditing, expectSameInk, field, form, openForm, settled } from "./helpers/forms";
import { clipOf, diffCount, innerClip, ink, shot } from "./helpers/pixels";

test.describe.configure({ timeout: 120_000 });
test.skip(({ isMobile }) => isMobile, "desktop pointer flow");

async function typeValue(page: import("@playwright/test").Page, name: string, value: string) {
  const f = field(page, name);
  await f.click();
  await page.keyboard.press("Control+A");
  if (value === "") await page.keyboard.press("Delete");
  else await page.keyboard.type(value);
  await page.keyboard.press("Tab"); // leaves the field: the edit is committed
  await settled(page, name);
}

test("REGRESSION — a pre-filled field (Raviteja) shows its value once: before editing, while editing, after editing", async ({ page }) => {
  await openForm(page, form("FORM-01-given-name.pdf"));
  // opening the editor changes nothing on the page
  const idle = await expectNoOverlayGhost(page, "given_name");
  const idleInk = ink(idle);
  expect(idleInk.empty).toBe(false);

  // clicking the field: one value, same size and place as the appearance it replaces
  await field(page, "given_name").click();
  await expect(field(page, "given_name")).toHaveAttribute("data-state", "editing");
  const editing = await expectOpaqueWhileEditing(page, "given_name");
  expectSameInk(idleInk, ink(editing), 2, "editing vs original appearance");

  // the real-user sequence: change one character, leave, re-enter, change it back
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await page.keyboard.press("Tab");
  await settled(page, "given_name");
  await expectNoOverlayGhost(page, "given_name");
  await field(page, "given_name").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Tab");
  await settled(page, "given_name");
  const back = await expectNoOverlayGhost(page, "given_name");
  expectSameInk(idleInk, ink(back), 2, "after changing back");
  const out = await exportPdf(page, "raviteja.pdf");
  expect((await PDFDocument.load(out)).getForm().getTextField("given_name").getText()).toBe("Raviteja");
  // reopen the exported file: one clean value, the size and place of the original
  const saved = test.info().outputPath("raviteja-reopened.pdf");
  fs.writeFileSync(saved, out);
  await openForm(page, saved);
  const reopened = await expectNoOverlayGhost(page, "given_name");
  expectSameInk(idleInk, ink(reopened), 2, "reopened export vs original");
});

test("replace, one character, shorter, longer, empty, restore, undo, redo — never doubled", async ({ page }) => {
  await openForm(page, form("FORM-01-given-name.pdf"));
  const clip = await clipOf(field(page, "given_name"), 0);
  const original = ink(await shot(page, clip, HIDE_OVERLAYS));
  const steps: [string, string][] = [["Ravi Teja", "replace"], ["Ravitej", "shorter"], ["Raviteja Vemulapelli", "longer"], ["", "empty"], ["Raviteja", "restore"]];
  for (const [value] of steps) {
    await typeValue(page, "given_name", value);
    await expectNoOverlayGhost(page, "given_name");
    if (value === "") {
      // nothing is left inside the box: no stray text from a previous value
      expect(ink(await shot(page, await innerClip(field(page, "given_name")), HIDE_OVERLAYS)).empty).toBe(true);
    }
  }
  const restored = ink(await shot(page, clip, HIDE_OVERLAYS));
  expectSameInk(original, restored, 2, "restored value looks like the original");
  // undo walks back through the values; redo forward
  await page.getByRole("button", { name: "Undo" }).click();
  await settled(page, "given_name");
  await expect(field(page, "given_name")).toHaveValue("");
  await page.getByRole("button", { name: "Undo" }).click();
  await settled(page, "given_name");
  await expect(field(page, "given_name")).toHaveValue("Raviteja Vemulapelli");
  await page.getByRole("button", { name: "Redo" }).click();
  await settled(page, "given_name");
  await expect(field(page, "given_name")).toHaveValue("");
  const text = await exportPdf(page, "sequence.pdf");
  expect((await PDFDocument.load(text)).getForm().getTextField("given_name").getText() ?? "").toBe("");
  expect(fs.statSync(form("FORM-01-given-name.pdf")).size).toBeGreaterThan(0);
});

for (const [file, names] of [
  ["FORM-02-sizes.pdf", ["size_8", "size_10", "size_12", "size_14", "size_18", "size_auto"]],
  ["FORM-03-alignment.pdf", ["align_left", "align_center", "align_right"]],
  ["FORM-10-fonts-colours.pdf", ["times_blue", "courier_gray", "no_border"]],
] as const) {
  test(`${file}: every field looks the same idle, while editing, and after editing — size, alignment, font, colour`, async ({ page }) => {
    await openForm(page, form(file));
    for (const name of names) {
      const clip = await clipOf(field(page, name), 0);
      const idle = ink(await shot(page, clip, HIDE_OVERLAYS));
      await field(page, name).click();
      await expect(field(page, name)).toHaveAttribute("data-state", "editing");
      const editing = ink(await expectOpaqueWhileEditing(page, name));
      expectSameInk(idle, editing, 2, `${name} editing vs original`);
      // edit: add a character and back again, so the appearance is the one we write
      await page.keyboard.press("End");
      await page.keyboard.type("a");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Tab");
      await page.mouse.move(2, 2);
      await settled(page, name);
      await expectNoOverlayGhost(page, name);
      // value is unchanged, so the file's own appearance is still what is drawn
      const after = ink(await shot(page, clip, HIDE_OVERLAYS));
      expectSameInk(idle, after, 0, `${name} after a no-op edit`);
      // really change it: the appearance we write matches the edit box
      await field(page, name).click();
      await page.keyboard.press("Control+A");
      await page.keyboard.type("Raviteja V");
      const live = ink(await expectOpaqueWhileEditing(page, name));
      await page.keyboard.press("Tab");
      await page.mouse.move(2, 2);
      await settled(page, name);
      await expectNoOverlayGhost(page, name);
      const written = ink(await shot(page, clip, HIDE_OVERLAYS));
      expectSameInk(live, written, 2, `${name} edit box vs written appearance`);
    }
  });
}

test("FORM-04: multi-line fields — wrapping, size and layout match idle, editing and written", async ({ page }) => {
  await openForm(page, form("FORM-04-multiline.pdf"));
  for (const name of ["comments", "notes_auto"]) {
    const clip = await clipOf(field(page, name), 0);
    const idle = ink(await shot(page, clip, HIDE_OVERLAYS));
    await field(page, name).click();
    await expect(field(page, name)).toHaveAttribute("data-state", "editing");
    expectSameInk(idle, ink(await expectOpaqueWhileEditing(page, name)), 3, `${name} editing vs original`);
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" More words added at the end.");
    const live = ink(await expectOpaqueWhileEditing(page, name));
    await page.keyboard.press("Tab");
    await page.mouse.move(2, 2);
    await settled(page, name);
    await expectNoOverlayGhost(page, name);
    expectSameInk(live, ink(await shot(page, clip, HIDE_OVERLAYS)), 3, `${name} edit box vs written`);
  }
});

test("FORM-05: checkbox, radio and dropdown — one state shown, toggling is exact, undo restores", async ({ page }) => {
  await openForm(page, form("FORM-05-choices.pdf"));
  const inkOf = async (name: string, option?: string) => ink(await shot(page, await innerClip(field(page, name, option), 2), HIDE_OVERLAYS));
  const checkedOriginal = await inkOf("subscribe");
  const uncheckedOriginal = await inkOf("newsletter");
  expect(checkedOriginal.count).toBeGreaterThan(uncheckedOriginal.count + 5);
  await expectNoOverlayGhost(page, "subscribe");
  await field(page, "subscribe").click();
  await settled(page, "subscribe");
  await expectNoOverlayGhost(page, "subscribe");
  expect((await inkOf("subscribe")).count).toBe(uncheckedOriginal.count); // unchecked now: no mark, no leftover
  await field(page, "subscribe").click();
  await settled(page, "subscribe");
  expect((await inkOf("subscribe")).count).toBe(checkedOriginal.count); // and back: one mark, the file's own
  // radio: only the selected option is marked
  const selectedOriginal = await inkOf("membership", "Individual");
  const otherOriginal = await inkOf("membership", "Student");
  expect(selectedOriginal.count).toBeGreaterThan(otherOriginal.count + 5);
  await field(page, "membership", "Family").click();
  await settled(page, "membership", "Family");
  expect((await inkOf("membership", "Family")).count).toBe(selectedOriginal.count);
  expect((await inkOf("membership", "Individual")).count).toBe(otherOriginal.count);
  expect((await inkOf("membership", "Student")).count).toBe(otherOriginal.count);
  // dropdown
  await expectNoOverlayGhost(page, "country");
  await field(page, "country").selectOption("Utopia");
  await settled(page, "country");
  await expectNoOverlayGhost(page, "country");
  const out = await exportPdf(page, "choices.pdf");
  const f = (await PDFDocument.load(out)).getForm();
  expect(f.getCheckBox("subscribe").isChecked()).toBe(true);
  expect(f.getRadioGroup("membership").getSelected()).toBe("Family");
  expect(f.getDropdown("country").getSelected()).toEqual(["Utopia"]);
  await page.getByRole("button", { name: "Undo" }).click();
  await settled(page, "country");
  await expect(field(page, "country")).toHaveValue("Elbonia");
});

for (const [file, what] of [["FORM-06-needappearances.pdf", "no appearance + /NeedAppearances"], ["FORM-07-stale-appearance.pdf", "an appearance that shows an old value"]] as const) {
  test(`${file}: ${what} — the field shows /V once, laid out like any other`, async ({ page }) => {
    await openForm(page, form("FORM-01-given-name.pdf"));
    const reference = ink(await shot(page, await clipOf(field(page, "given_name"), 0), HIDE_OVERLAYS));
    await openForm(page, form(file));
    await settled(page, "given_name");
    const idle = await expectNoOverlayGhost(page, "given_name");
    expectSameInk(reference, ink(idle), 2, `${file} drawn from /V`);
    await field(page, "given_name").click();
    expectSameInk(reference, ink(await expectOpaqueWhileEditing(page, "given_name")), 2, `${file} editing`);
    await page.keyboard.press("Tab");
    const out = await exportPdf(page, "regen.pdf");
    expect((await PDFDocument.load(out)).getForm().getTextField("given_name").getText()).toBe("Raviteja");
  });
}

test("FORM-08: a flattened form is page text, not a field — one editable representation", async ({ page }) => {
  await openForm(page, form("FORM-08-flattened.pdf"), false);
  await expect(page.locator('[data-testid="form-field"]')).toHaveCount(0);
  const block = page.locator('[data-testid="native-block"][data-text="Raviteja"]');
  await expect(block).toHaveCount(1);
  await block.dblclick();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Ravi Teja");
  await page.getByRole("button", { name: "Apply this text edit" }).click();
  const out = await exportPdf(page, "flat.pdf");
  const text = (await import("./helpers/native")).pdfText;
  const t = await text(out);
  expect(t).toContain("Ravi Teja");
  expect(t).not.toContain("Raviteja");
});

test("FORM-09: a long form — ten-plus fields of every kind, edited with the keyboard (Tab) — no duplicates anywhere; export is right", async ({ page }) => {
  await openForm(page, form("FORM-09-long.pdf"));
  expect(await page.locator('[data-testid="form-field"]').count()).toBeGreaterThanOrEqual(13);
  const surface = page.locator('[data-testid="page-surface"]').first();
  const pageClip = await clipOf(surface, 0);
  const wholePage = async () => {
    await page.mouse.move(1, 1);
    const a = await shot(page, pageClip);
    const b = await shot(page, pageClip, HIDE_OVERLAYS);
    return diffCount(a, b, 110);
  };
  expect(await wholePage(), "opening the form changes no pixel").toBe(0);

  const active = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-field-name") ?? "");
  await field(page, "given_name").click();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await page.keyboard.press("Tab");
  expect(await active()).toBe("family_name");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Vemulapelli-Rao");
  await page.keyboard.press("Tab");
  expect(await active()).toBe("email");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("raviteja@example.org");
  await page.keyboard.press("Tab"); // → phone, left as it is
  await page.keyboard.press("Tab"); // → street, left as it is
  await page.keyboard.press("Tab");
  expect(await active()).toBe("city");
  await page.keyboard.type("Utopia City");
  await page.keyboard.press("Tab");
  await field(page, "newsletter").click();
  await field(page, "plan", "Pro").click();
  await field(page, "country").selectOption("Freedonia");
  await field(page, "comments").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Edited comment\nsecond line");
  await page.keyboard.press("Tab");
  await page.mouse.move(1, 1);
  await page.waitForTimeout(1500);
  for (const n of ["given_name", "family_name", "email", "city", "newsletter", "country", "comments"]) await settled(page, n);
  expect(await wholePage(), "after editing, nothing is drawn twice over the page picture").toBe(0);

  const out = await exportPdf(page, "long.pdf");
  fs.mkdirSync("qa/fidelity/_work/form-out", { recursive: true });
  fs.writeFileSync("qa/fidelity/_work/form-out/FORM-09-long.edited.pdf", out);
  const f = (await PDFDocument.load(out)).getForm();
  expect(f.getTextField("given_name").getText()).toBe("Raviteja" + "x");
  expect(f.getTextField("family_name").getText()).toBe("Vemulapelli-Rao");
  expect(f.getTextField("email").getText()).toBe("raviteja@example.org");
  expect(f.getTextField("phone").getText()).toBe("555 0142");
  expect(f.getTextField("city").getText()).toBe("Utopia City");
  expect(f.getCheckBox("newsletter").isChecked()).toBe(false);
  expect(f.getRadioGroup("plan").getSelected()).toBe("Pro");
  expect(f.getDropdown("country").getSelected()).toEqual(["Freedonia"]);
  expect(f.getTextField("comments").getText()).toBe("Edited comment\nsecond line");
});

test.describe("field geometry: the edit box sits exactly on the field at every zoom, scrolled, on a rotated page", () => {
  for (const file of ["FORM-01-given-name.pdf", "FORM-11-rotated-page.pdf"]) {
    test(`${file}`, async ({ page }) => {
      await openForm(page, form(file));
      const check = async (label: string) => {
        await page.mouse.move(1, 1);
        const el = field(page, "given_name");
        await el.scrollIntoViewIfNeeded();
        const clip = await clipOf(el, 0);
        // a light threshold: at small zooms the hairline border is pale
        const idle = ink(await shot(page, clip, HIDE_OVERLAYS), 225);
        await el.click();
        await expect(el).toHaveAttribute("data-state", "editing");
        const editing = ink(await expectOpaqueWhileEditing(page, "given_name"), 225);
        expectSameInk(idle, editing, 2, `${file} ${label}`);
        await page.keyboard.press("Escape");
        await settled(page, "given_name");
      };
      await check("100%");
      for (const [button, label] of [["Zoom in", "zoom in 1"], ["Zoom in", "zoom in 2"], ["Zoom in", "zoom in 3"], ["Zoom out", "zoom out"], ["Fit width", "fit width"], ["Fit page", "fit page"]] as const) {
        await page.getByRole("button", { name: button, exact: true }).click();
        await page.waitForTimeout(700);
        await check(label);
      }
      // scrolled: the page scrolled under the pointer, the box still on its field
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.waitForTimeout(700);
      await page.locator(".canvas-bg").first().evaluate((el) => el.scrollBy(40, 60));
      await page.waitForTimeout(300);
      await check("scrolled");
      if (file.startsWith("FORM-01")) {
        await page.getByRole("button", { name: "Actual size (100%)" }).click();
        await page.getByRole("button", { name: "Go to page 1" }).hover();
        await page.getByRole("button", { name: "Rotate page 1 clockwise" }).click();
        await page.waitForTimeout(900);
        await check("rotated in the editor");
      }
    });
  }
});

test.describe("HiDPI", () => {
  test.use({ deviceScaleFactor: 2 });
  test("the edit box matches the field on a 2x display", async ({ page }) => {
    await openForm(page, form("FORM-02-sizes.pdf"));
    for (const name of ["size_8", "size_12", "size_auto"]) {
      const clip = await clipOf(field(page, name), 0);
      const idle = ink(await shot(page, clip, HIDE_OVERLAYS));
      await field(page, name).click();
      const editing = ink(await expectOpaqueWhileEditing(page, name));
      expectSameInk(idle, editing, 4, `${name} @2x`); // 2 CSS px, in device pixels
      await page.keyboard.press("Escape");
    }
  });
});
