import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFName, PDFNumber, PDFString, rgb, type PDFFont, type PDFImage, type PDFPage, type PDFRef } from "pdf-lib";
import type { FaceKey, FontSet } from "./fonts";
import type { Op, PageOut } from "./layout";
import type { Media } from "./model";

/** Turns a picture pdf-lib can't embed (GIF, BMP, TIFF, WebP) into PNG bytes, or null if it can't. */
export type ImageDecoder = (media: Media) => Promise<Uint8Array | null>;

export interface RenderResult {
  bytes: Uint8Array;
  pictures: number;
  /** Pictures in a format that couldn't be drawn (shown as an empty frame). */
  unsupportedPictures: number;
}

function color(hex: string | null | undefined) {
  const h = hex && /^[0-9a-f]{6}$/i.test(hex) ? hex : "000000";
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

export async function renderPdf(
  pages: PageOut[],
  fonts: FontSet,
  media: Map<string, Media>,
  options: { title: string; decodeImage?: ImageDecoder; onPage?: (index: number, total: number) => void },
): Promise<RenderResult> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(options.title, { showInWindowTitleBar: true });
  pdf.setProducer("TheFileConvert");
  pdf.setCreator("TheFileConvert — Word to PDF");
  const now = new Date();
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);

  const embedded = new Map<FaceKey, PDFFont>();
  const fontFor = async (key: FaceKey) => {
    let f = embedded.get(key);
    if (!f) {
      const face = fonts.faces.get(key) ?? fonts.faces.get("carlito-r")!;
      f = await pdf.embedFont(face.bytes, { subset: true });
      embedded.set(key, f);
    }
    return f;
  };

  const images = new Map<string, PDFImage | null>();
  let pictures = 0;
  const unsupported = new Set<string>();
  const imageFor = async (path: string) => {
    if (images.has(path)) return images.get(path)!;
    const m = media.get(path);
    let img: PDFImage | null = null;
    if (m) {
      try {
        if (m.type === "png") img = await pdf.embedPng(m.bytes);
        else if (m.type === "jpeg") img = await pdf.embedJpg(m.bytes);
        else if (options.decodeImage) {
          const png = await options.decodeImage(m);
          if (png) img = await pdf.embedPng(png);
        }
      } catch {
        // A picture that won't decode is replaced by an empty frame; it must not break the document.
        img = null;
      }
    }
    if (!img) unsupported.add(path);
    images.set(path, img);
    return img;
  };

  const outline: { level: number; title: string; page: PDFRef; top: number }[] = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const po = pages[pi];
    options.onPage?.(pi + 1, pages.length);
    const page = pdf.addPage([po.width, po.height]);
    for (const op of [...po.under, ...po.ops]) await drawOp(page, op, po.height);
    for (const o of po.outline) if (o.title) outline.push({ level: o.level, title: o.title, page: page.ref, top: po.height - o.y });
  }

  async function drawOp(page: PDFPage, op: Op, H: number) {
    switch (op.t) {
      case "text": {
        let x = op.x;
        for (const seg of fonts.segments(op.text, op.style)) {
          const font = await fontFor(seg.face);
          page.drawText(seg.text, { x, y: H - op.y, size: op.style.size, font, color: color(op.color) });
          x += seg.width;
        }
        break;
      }
      case "rect":
        if (op.w > 0 && op.h > 0) page.drawRectangle({ x: op.x, y: H - op.y - op.h, width: op.w, height: op.h, color: color(op.fill) });
        break;
      case "line":
        page.drawLine({ start: { x: op.x1, y: H - op.y1 }, end: { x: op.x2, y: H - op.y2 }, thickness: op.width, color: color(op.color), dashArray: op.dashed ? [3, 2] : undefined });
        break;
      case "image": {
        const img = await imageFor(op.media);
        if (img) {
          page.drawImage(img, { x: op.x, y: H - op.y - op.h, width: op.w, height: op.h });
          pictures++;
        } else page.drawRectangle({ x: op.x, y: H - op.y - op.h, width: op.w, height: op.h, borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.75 });
        break;
      }
      case "link": {
        if (!/^(https?:|mailto:|ftp:)/i.test(op.url)) break;
        const annot = pdf.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [op.x, H - op.y - op.h, op.x + op.w, H - op.y],
          Border: [0, 0, 0],
          A: { Type: "Action", S: "URI", URI: PDFString.of(op.url) },
        });
        page.node.addAnnot(pdf.context.register(annot));
        break;
      }
    }
  }

  if (outline.length) addOutline(pdf, outline);
  const bytes = await pdf.save({ useObjectStreams: true });
  return { bytes, pictures, unsupportedPictures: unsupported.size };
}

/** Headings become PDF bookmarks, nested by level — as Word does when it saves a PDF. */
function addOutline(pdf: PDFDocument, entries: { level: number; title: string; page: PDFRef; top: number }[]) {
  const ctx = pdf.context;
  interface Node {
    ref: PDFRef;
    title: string;
    page: PDFRef;
    top: number;
    level: number;
    children: Node[];
  }
  const root: Node = { ref: ctx.nextRef(), title: "", page: entries[0].page, top: 0, level: 0, children: [] };
  const stack: Node[] = [root];
  for (const e of entries) {
    const node: Node = { ref: ctx.nextRef(), title: e.title.slice(0, 200), page: e.page, top: e.top, level: e.level, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= e.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  const count = (n: Node): number => n.children.reduce((s, c) => s + 1 + count(c), 0);
  const write = (n: Node, parent: Node) => {
    const siblings = parent.children;
    const i = siblings.indexOf(n);
    const dict = ctx.obj({
      Title: PDFString.of(n.title),
      Parent: parent.ref,
      Dest: [n.page, PDFName.of("XYZ"), PDFNumber.of(0), PDFNumber.of(Math.round(n.top + 6)), PDFNumber.of(0)],
    });
    if (i > 0) dict.set(PDFName.of("Prev"), siblings[i - 1].ref);
    if (i < siblings.length - 1) dict.set(PDFName.of("Next"), siblings[i + 1].ref);
    if (n.children.length) {
      dict.set(PDFName.of("First"), n.children[0].ref);
      dict.set(PDFName.of("Last"), n.children[n.children.length - 1].ref);
      dict.set(PDFName.of("Count"), PDFNumber.of(-count(n)));
    }
    ctx.assign(n.ref, dict);
    for (const c of n.children) write(c, n);
  };
  for (const c of root.children) write(c, root);
  const rootDict = ctx.obj({ Type: "Outlines", First: root.children[0].ref, Last: root.children[root.children.length - 1].ref, Count: PDFNumber.of(count(root)) });
  ctx.assign(root.ref, rootDict);
  pdf.catalog.set(PDFName.of("Outlines"), root.ref);
}
