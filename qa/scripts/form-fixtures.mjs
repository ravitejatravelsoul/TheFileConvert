// Builds the AcroForm fixtures for the PDF editor's form audit into qa/form-fixtures/ (synthetic: invented people and numbers).
//   node qa/scripts/form-fixtures.mjs
// Each file isolates one situation a real filled form can be in. See qa/form-fixtures/README.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, PDFName, PDFString, PDFBool, StandardFonts, TextAlignment, rgb } from "pdf-lib";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "form-fixtures");
fs.mkdirSync(OUT, { recursive: true });
const manifest = {};

async function start(size = [612, 792]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage(size);
  const fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  return { doc, page, form: doc.getForm(), fonts };
}

function label(ctx, text, x, y, size = 10) {
  ctx.page.drawText(text, { x, y, size, font: ctx.fonts.sans, color: rgb(0.1, 0.1, 0.1) });
}

function textField(ctx, name, value, { x, y, width = 250, height = 22, size = 12, align, multiline, font = "sans", color, bg, border = rgb(0.4, 0.4, 0.4), bw = 1 }) {
  const f = ctx.form.createTextField(name);
  if (multiline) f.enableMultiline();
  f.addToPage(ctx.page, { x, y, width, height, borderWidth: bw, borderColor: border, backgroundColor: bg, textColor: color ?? rgb(0, 0, 0), font: ctx.fonts[font] });
  f.setFontSize(size);
  if (align) f.setAlignment(align);
  if (value) f.setText(value);
  f.updateAppearances(ctx.fonts[font]);
  return f;
}

async function save(ctx, name, what) {
  fs.writeFileSync(path.join(OUT, name), await ctx.doc.save({ updateFieldAppearances: false }));
  manifest[name] = what;
}

// 01 — the reported case: "Given Name (First Name)" already holds "Raviteja"
{
  const ctx = await start();
  ctx.page.drawText("Application", { x: 72, y: 720, size: 18, font: ctx.fonts.sans });
  label(ctx, "Given Name (First Name)", 72, 690);
  textField(ctx, "given_name", "Raviteja", { x: 72, y: 662, width: 260, height: 22, size: 12 });
  label(ctx, "Family Name (Surname)", 72, 630);
  textField(ctx, "family_name", "", { x: 72, y: 602, width: 260, height: 22, size: 12 });
  await save(ctx, "FORM-01-given-name.pdf", "pre-filled text field (Raviteja, 12 pt, left) next to an empty one");
}

// 02 — font sizes, and auto-size
{
  const ctx = await start();
  let y = 720;
  for (const size of [8, 10, 12, 14, 18, 0]) {
    label(ctx, size ? `${size} pt` : "auto-size", 72, y + 6);
    const f = textField(ctx, `size_${size || "auto"}`, "Raviteja", { x: 160, y, width: 230, height: size === 18 ? 30 : 24, size });
    if (!size) f.acroField.setDefaultAppearance("/Helvetica 0 Tf 0 g"); // really auto: pdf-lib would write the size it chose
    y -= 46;
  }
  await save(ctx, "FORM-02-sizes.pdf", "the same value at 8, 10, 12, 14, 18 pt and auto-size (DA size 0)");
}

// 03 — alignment
{
  const ctx = await start();
  let y = 720;
  for (const [name, a] of [["left", TextAlignment.Left], ["center", TextAlignment.Center], ["right", TextAlignment.Right]]) {
    label(ctx, name, 72, y + 6);
    textField(ctx, `align_${name}`, "Raviteja", { x: 160, y, width: 230, height: 24, size: 12, align: a });
    y -= 46;
  }
  await save(ctx, "FORM-03-alignment.pdf", "left / centre / right aligned values (/Q 0, 1, 2)");
}

// 04 — multi-line
{
  const ctx = await start();
  label(ctx, "Comments", 72, 720);
  textField(ctx, "comments", "First line of the comment.\nA second paragraph that is long enough to wrap onto more than one line inside the box.", { x: 72, y: 600, width: 300, height: 110, size: 10, multiline: true });
  label(ctx, "Notes (auto-size)", 72, 570);
  const na = textField(ctx, "notes_auto", "Auto sized multi-line text that has to shrink to fit the box it is in, however long it is.", { x: 72, y: 470, width: 200, height: 90, size: 0, multiline: true });
  na.acroField.setDefaultAppearance("/Helvetica 0 Tf 0 g");
  await save(ctx, "FORM-04-multiline.pdf", "multi-line fields: fixed 10 pt and auto-size");
}

// 05 — choices already set
{
  const ctx = await start();
  label(ctx, "Subscribe", 72, 716);
  const c1 = ctx.form.createCheckBox("subscribe");
  c1.addToPage(ctx.page, { x: 200, y: 710, width: 16, height: 16, borderColor: rgb(0.3, 0.3, 0.3) });
  c1.check();
  label(ctx, "Newsletter (unchecked)", 72, 686);
  const c2 = ctx.form.createCheckBox("newsletter");
  c2.addToPage(ctx.page, { x: 200, y: 680, width: 16, height: 16, borderColor: rgb(0.3, 0.3, 0.3) });
  label(ctx, "Membership", 72, 650);
  const r = ctx.form.createRadioGroup("membership");
  ["Student", "Individual", "Family"].forEach((opt, i) => {
    r.addOptionToPage(opt, ctx.page, { x: 200 + i * 110, y: 644, width: 16, height: 16, borderColor: rgb(0.3, 0.3, 0.3) });
    label(ctx, opt, 222 + i * 110, 650);
  });
  r.select("Individual");
  label(ctx, "Country", 72, 610);
  const d = ctx.form.createDropdown("country");
  d.addOptions(["Utopia", "Freedonia", "Elbonia", "Ruritania"]);
  d.addToPage(ctx.page, { x: 200, y: 600, width: 170, height: 22, borderColor: rgb(0.4, 0.4, 0.4), font: ctx.fonts.sans });
  d.select("Elbonia");
  ctx.form.updateFieldAppearances(ctx.fonts.sans);
  await save(ctx, "FORM-05-choices.pdf", "checked + unchecked checkbox, a selected radio option, a selected dropdown");
}

// 06 — NeedAppearances: values in /V, no appearance streams
{
  const ctx = await start();
  label(ctx, "Given Name (First Name)", 72, 690);
  const f = textField(ctx, "given_name", "Raviteja", { x: 72, y: 662, width: 260, height: 22, size: 12 });
  for (const w of f.acroField.getWidgets()) w.dict.delete(PDFName.of("AP"));
  ctx.doc.catalog.lookup(PDFName.of("AcroForm")).set(PDFName.of("NeedAppearances"), PDFBool.True);
  await save(ctx, "FORM-06-needappearances.pdf", "/V = Raviteja, no /AP, /NeedAppearances true");
}

// 07 — stale appearance: /AP draws "Old Value", /V says Raviteja
{
  const ctx = await start();
  label(ctx, "Given Name (First Name)", 72, 690);
  const f = textField(ctx, "given_name", "Old Value", { x: 72, y: 662, width: 260, height: 22, size: 12 });
  f.acroField.dict.set(PDFName.of("V"), PDFString.of("Raviteja"));
  await save(ctx, "FORM-07-stale-appearance.pdf", "/AP says Old Value, /V says Raviteja");
}

// 08 — flattened: the value is page content and there is no field at all
{
  const ctx = await start();
  ctx.page.drawText("Given Name (First Name)", { x: 72, y: 690, size: 10, font: ctx.fonts.sans });
  ctx.page.drawRectangle({ x: 72, y: 662, width: 260, height: 22, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 1 });
  ctx.page.drawText("Raviteja", { x: 76, y: 668, size: 12, font: ctx.fonts.sans });
  await save(ctx, "FORM-08-flattened.pdf", "a flattened form: the value is ordinary page text, no AcroForm");
}

// 09 — a long form
{
  const ctx = await start();
  ctx.page.drawText("Registration", { x: 72, y: 740, size: 18, font: ctx.fonts.sans });
  const rows = [["Given Name", "given_name", "Raviteja"], ["Family Name", "family_name", "Vemulapelli"], ["Email", "email", "raviteja@example.test"], ["Phone", "phone", "555 0142"], ["Street", "street", "12 Willow Court"], ["City", "city", ""], ["Postcode", "postcode", "10101"]];
  let y = 700;
  for (const [l, n, v] of rows) {
    label(ctx, l, 72, y + 6);
    textField(ctx, n, v, { x: 180, y, width: 260, height: 22, size: 11 });
    y -= 34;
  }
  label(ctx, "Newsletter", 72, y + 4);
  const c = ctx.form.createCheckBox("newsletter");
  c.addToPage(ctx.page, { x: 180, y, width: 16, height: 16, borderColor: rgb(0.3, 0.3, 0.3) });
  c.check();
  y -= 34;
  label(ctx, "Plan", 72, y + 4);
  const r = ctx.form.createRadioGroup("plan");
  ["Basic", "Plus", "Pro"].forEach((opt, i) => {
    r.addOptionToPage(opt, ctx.page, { x: 180 + i * 90, y, width: 16, height: 16, borderColor: rgb(0.3, 0.3, 0.3) });
    label(ctx, opt, 202 + i * 90, y + 4);
  });
  r.select("Plus");
  y -= 34;
  label(ctx, "Country", 72, y + 4);
  const d = ctx.form.createDropdown("country");
  d.addOptions(["Utopia", "Freedonia", "Elbonia"]);
  d.addToPage(ctx.page, { x: 180, y, width: 170, height: 22, borderColor: rgb(0.4, 0.4, 0.4), font: ctx.fonts.sans });
  d.select("Utopia");
  y -= 40;
  label(ctx, "Comments", 72, y + 80);
  textField(ctx, "comments", "Looking forward to it.", { x: 180, y: y - 10, width: 300, height: 90, size: 10, multiline: true });
  ctx.form.updateFieldAppearances(ctx.fonts.sans);
  await save(ctx, "FORM-09-long.pdf", "13 fields: 8 text (one empty, one multi-line), checkbox, radio group, dropdown");
}

// 10 — fonts, colours, fills
{
  const ctx = await start();
  textField(ctx, "times_blue", "Raviteja", { x: 72, y: 690, width: 230, height: 26, size: 14, font: "serif", color: rgb(0.05, 0.2, 0.7), bg: rgb(0.93, 0.96, 1), border: rgb(0.05, 0.2, 0.7), bw: 2 });
  textField(ctx, "courier_gray", "Raviteja", { x: 72, y: 640, width: 230, height: 26, size: 12, font: "mono", color: rgb(0.3, 0.3, 0.3), bg: rgb(0.97, 0.97, 0.9) });
  const nb = textField(ctx, "no_border", "Raviteja", { x: 72, y: 590, width: 230, height: 26, size: 12, bw: 0 });
  // a real borderless field has no border colour at all (pdf-lib would otherwise draw a hairline for width 0)
  for (const w of nb.acroField.getWidgets()) w.dict.lookup(PDFName.of("MK")).delete(PDFName.of("BC"));
  nb.updateAppearances(ctx.fonts.sans);
  await save(ctx, "FORM-10-fonts-colours.pdf", "Times / Courier fields with text colour, fill and border widths");
}

// 11 — a page shown rotated
{
  const ctx = await start();
  label(ctx, "Given Name (First Name)", 72, 690);
  textField(ctx, "given_name", "Raviteja", { x: 72, y: 662, width: 260, height: 22, size: 12 });
  ctx.page.setRotation({ type: "degrees", angle: 90 });
  await save(ctx, "FORM-11-rotated-page.pdf", "pre-filled field on a page with /Rotate 90");
}

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`wrote ${Object.keys(manifest).length} form fixtures to ${OUT}`);
