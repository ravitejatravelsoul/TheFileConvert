// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildWorkingPage, boxTransform, type NativeEdit } from "./native";

const STD_FONTS = path.resolve("node_modules/pdfjs-dist/standard_fonts").split(path.sep).join("/") + "/";
const loader = async (key: string) => new Uint8Array(fs.readFileSync(path.resolve("public/fonts/word", `${key}.ttf`)));
const fileOf = (name: string) => new File([fs.readFileSync(path.resolve("qa/editor-fixtures", name))], name, { type: "application/pdf" });

async function textOf(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, standardFontDataUrl: STD_FONTS }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  return tc.items.map((i) => ("str" in i ? i.str : "")).join(" ").replace(/\s+/g, " ");
}

describe("the working page", () => {
  it("an untouched page is analysed into blocks with ids, text, styles and boxes", async () => {
    const r = await buildWorkingPage(fileOf("EDITOR-01-simple-text.pdf"), "f1", 0, [], loader as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.page.analysis.blocks.find((x) => x.text.startsWith("The committee will recieve"))!;
    expect(b.editable).toBe(true);
    expect(b.softWrapped).toBe(true);
    expect(b.segments.map((s) => s.text).join("")).toBe(b.text);
    expect(b.segments[0].fontClass).toBe("sans");
    expect(r.page.analysis.scanned).toBe(false);
  });

  it("edits build on each other, each addressed against the page as it was, and undo is a cache hit", async () => {
    const f = fileOf("EDITOR-01-simple-text.pdf");
    const first = await buildWorkingPage(f, "f2", 0, [], loader as never);
    if (!first.ok) throw new Error("no page");
    const b1 = first.page.analysis.blocks.find((x) => x.text.includes("recieve"))!;
    const e1: NativeEdit = { kind: "text", block: b1.id, newText: b1.text.replace("recieve", "receive") };
    const r1 = await buildWorkingPage(f, "f2", 0, [e1], loader as never);
    if (!r1.ok) throw new Error(r1.reason);
    expect(await textOf(r1.page.bytes)).toContain("receive");

    const b2 = r1.page.analysis.blocks.find((x) => x.text.includes("A seperate budget"))!;
    const e2: NativeEdit = { kind: "text", block: b2.id, newText: b2.text.replace("seperate", "separate") };
    const r2 = await buildWorkingPage(f, "f2", 0, [e1, e2], loader as never);
    if (!r2.ok) throw new Error(r2.reason);
    const t2 = await textOf(r2.page.bytes);
    expect(t2).toContain("receive");
    expect(t2).toContain("separate");
    expect(t2).not.toContain("recieve");
    expect(t2).not.toContain("seperate");

    // undo: back to one edit — served from the cache, identical bytes
    const undone = await buildWorkingPage(f, "f2", 0, [e1], loader as never);
    if (!undone.ok) throw new Error("undo failed");
    expect(Buffer.from(undone.page.bytes).equals(Buffer.from(r1.page.bytes))).toBe(true);
  });

  it("an edit whose target is gone is reported, not applied", async () => {
    const f = fileOf("EDITOR-01-simple-text.pdf");
    const r = await buildWorkingPage(f, "f3", 0, [{ kind: "text", block: "page#99999:0", newText: "x" }], loader as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.index).toBe(0);
  });

  it("an image can be moved, and the new analysis says where it is now", async () => {
    const f = fileOf("EDITOR-08-images.pdf");
    const first = await buildWorkingPage(f, "f4", 0, [], loader as never);
    if (!first.ok) throw new Error("no page");
    expect(first.page.analysis.images.length).toBe(2);
    const im = first.page.analysis.images[0];
    const newBox = { x: im.bbox.x + 40, y: im.bbox.y - 30, width: im.bbox.width, height: im.bbox.height };
    const edit: NativeEdit = { kind: "image", id: im.id, action: { type: "transform", matrix: boxTransform(im.bbox, newBox) } };
    const r = await buildWorkingPage(f, "f4", 0, [edit], loader as never);
    if (!r.ok) throw new Error(r.reason);
    const moved = r.page.analysis.images.find((x) => Math.abs(x.bbox.x - newBox.x) < 0.1 && Math.abs(x.bbox.y - newBox.y) < 0.1);
    expect(moved).toBeTruthy();
    expect(r.page.analysis.images.length).toBe(2);
  });

  it("a scan is recognised as a scan", async () => {
    const r = await buildWorkingPage(fileOf("EDITOR-12-scanned-form.pdf"), "f5", 0, [], loader as never);
    if (!r.ok) throw new Error("no page");
    expect(r.page.analysis.scanned).toBe(true);
    expect(r.page.analysis.blocks.length).toBe(0);
  });
});
