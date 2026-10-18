import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { EDITOR_FIXTURES, editText, expectTextChanged, exportPdf, goToPage, openEditor, saveForValidator, type TypedEdit } from "./helpers/native";

/**
 * Native text editing through the real UI, across every native fixture and every kind of edit: double-click, move the caret with
 * the keyboard, type, Done, Export — then the exported file is read back (pdf.js here; qpdf / MuPDF / poppler and a pixel diff in
 * qa/validate/editorcheck.py over the saved outputs).
 */
test.skip(({ isMobile }) => isMobile, "desktop keyboard flow; the phone layout has its own spec");
test.describe.configure({ timeout: 120_000 });

interface Case {
  tag: string;
  fixture: string;
  page?: number;
  edit: TypedEdit;
  from: string;
  to: string;
}

const manifest = JSON.parse(fs.readFileSync(path.join(EDITOR_FIXTURES, "manifest.json"), "utf-8")) as Record<string, { targets: [string, string][] }>;

const spelling: Case[] = Object.entries(manifest).flatMap(([fixture, m]) =>
  m.targets.map(([from, to]) => ({ tag: `fix-${from}`, fixture, edit: { has: from, find: from, replace: to }, from, to })),
);

const scenarios: Case[] = [
  { tag: "same-length", fixture: "EDITOR-01-simple-text.pdf", edit: { has: "teh chair", find: "teh", replace: "the" }, from: "teh", to: "the" },
  { tag: "shorter", fixture: "EDITOR-01-simple-text.pdf", edit: { has: "recieve", find: "recieve", replace: "get" }, from: "recieve", to: "get" },
  { tag: "longer", fixture: "EDITOR-01-simple-text.pdf", edit: { has: "recieve", find: "recieve", replace: "receive in writing" }, from: "recieve", to: "receive in writing" },
  { tag: "single-char-insert", fixture: "EDITOR-01-simple-text.pdf", edit: { has: "adress", before: "ad", insert: "d" }, from: "adress", to: "address" },
  { tag: "single-char-replace", fixture: "EDITOR-01-simple-text.pdf", edit: { has: "definately", near: "definately", find: "a", replace: "i" }, from: "definately", to: "definitely" },
  { tag: "single-char-delete", fixture: "EDITOR-01-simple-text.pdf", edit: { has: "teh chair", near: "teh chair", find: "h", replace: "" }, from: "teh chair", to: "te chair" },
  { tag: "whole-word", fixture: "EDITOR-03-business-letter.pdf", edit: { has: "The committee will recieve", find: "committee", replace: "board" }, from: "committee", to: "board" },
  { tag: "multiple-words", fixture: "EDITOR-03-business-letter.pdf", edit: { has: "The committee will recieve", find: "committee will recieve your suggestions", replace: "board will receive all suggestions" }, from: "committee will recieve your suggestions", to: "board will receive all suggestions" },
  { tag: "line-end", fixture: "EDITOR-01-simple-text.pdf", edit: { has: "recieve", find: "asked", replace: "requested" }, from: "asked", to: "requested" },
  { tag: "bold", fixture: "EDITOR-06-mixed-fonts.pdf", edit: { has: "Arial — The quick", find: "Bold", replace: "Strong" }, from: "Bold", to: "Strong" },
  { tag: "italic", fixture: "EDITOR-06-mixed-fonts.pdf", edit: { has: "Arial — The quick", find: "Italic", replace: "Slanted" }, from: "Italic", to: "Slanted" },
  { tag: "colored", fixture: "EDITOR-06-mixed-fonts.pdf", edit: { has: "Red paragraph", find: "wich", replace: "which" }, from: "wich", to: "which" },
  { tag: "large-heading", fixture: "EDITOR-01-simple-text.pdf", edit: { has: "Quarterly Update", before: "Quarterly Update", insert: "s" }, from: "Quarterly Update", to: "Quarterly Updates" },
  { tag: "small-body", fixture: "EDITOR-06-mixed-fonts.pdf", edit: { has: "Small print", find: "teh", replace: "the" }, from: "teh", to: "the" },
  { tag: "rotated-p2", fixture: "EDITOR-09-rotated-pages.pdf", page: 2, edit: { has: "recieve", find: "recieve", replace: "receive" }, from: "recieve", to: "receive" },
  { tag: "rotated-p3", fixture: "EDITOR-09-rotated-pages.pdf", page: 3, edit: { has: "recieve", find: "recieve", replace: "receive" }, from: "recieve", to: "receive" },
  { tag: "rotated-p4", fixture: "EDITOR-09-rotated-pages.pdf", page: 4, edit: { has: "recieve", find: "recieve", replace: "receive" }, from: "recieve", to: "receive" },
  { tag: "special-accent", fixture: "EDITOR-15-special-characters.pdf", edit: { has: "Café", find: "recieve", replace: "receive" }, from: "recieve", to: "receive" },
  { tag: "special-currency", fixture: "EDITOR-15-special-characters.pdf", edit: { has: "€120.50", find: "€120.50", replace: "€125.50" }, from: "€120.50", to: "€125.50" },
  { tag: "later-page", fixture: "EDITOR-11-long-document-25-pages.pdf", page: 12, edit: { has: "recieve", find: "recieve", replace: "receive" }, from: "recieve", to: "receive" },
  { tag: "form-page-text", fixture: "EDITOR-05-form-acroform.pdf", edit: { has: "recieve this form", find: "recieve", replace: "receive" }, from: "recieve", to: "receive" },
];

for (const c of [...spelling, ...scenarios]) {
  test(`${c.fixture} · ${c.tag}${c.page ? ` · page ${c.page}` : ""}: ${c.from} → ${c.to}`, async ({ page }) => {
    const origPath = path.join(EDITOR_FIXTURES, c.fixture);
    const orig = fs.readFileSync(origPath);
    await openEditor(page, origPath);
    const pageNo = c.page ?? 1;
    await goToPage(page, pageNo);
    const { bbox } = await editText(page, c.edit);
    const out = await exportPdf(page, "out.pdf");
    await expectTextChanged(orig, out, pageNo, c.from, c.to);
    saveForValidator(`${c.fixture.replace(/\.pdf$/, "")}__${c.tag}${c.page ? `-p${c.page}` : ""}`, orig, out, { from: c.from, to: c.to, page: pageNo, bbox });
  });
}
