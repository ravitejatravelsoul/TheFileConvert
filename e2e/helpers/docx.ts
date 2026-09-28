import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { expect, type Page } from "@playwright/test";
import { downloadFrom } from "./tool";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export interface DocxSummary {
  paragraphs: { style: string | null; text: string; list: string | null; bold: string[] }[];
  tables: string[][][];
  pictures: number;
  sections: number;
  media: Uint8Array[];
  text: string;
}

/**
 * Opens a .docx the way Word does, independently of the app: the ZIP must hold the required parts,
 * every XML part must be well-formed, every relationship must point at a part that exists. Then reads
 * the body into paragraphs (style, list format, bold runs), tables, pictures and sections.
 */
export async function readDocx(bytes: Buffer | Uint8Array): Promise<DocxSummary> {
  const zip = await JSZip.loadAsync(bytes);
  for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels"]) expect(zip.file(part), part).toBeTruthy();
  const { DOMParser } = new JSDOM().window as { DOMParser: typeof globalThis.DOMParser };
  const parse = async (name: string) => {
    const dom = new DOMParser().parseFromString(await zip.file(name)!.async("string"), "application/xml");
    expect(dom.getElementsByTagName("parsererror").length, `${name} is well-formed`).toBe(0);
    return dom;
  };
  for (const name of Object.keys(zip.files).filter((n) => /\.(xml|rels)$/.test(n))) {
    const dom = await parse(name);
    if (name.endsWith(".rels")) {
      const base = name.replace(/_rels\/[^/]*\.rels$/, "");
      for (const rel of Array.from(dom.getElementsByTagName("Relationship"))) expect(zip.file(base + rel.getAttribute("Target")), `${name} → ${rel.getAttribute("Target")}`).toBeTruthy();
    }
  }
  const numbering = zip.file("word/numbering.xml") ? await parse("word/numbering.xml") : null;
  const fmt = new Map<string, string>();
  if (numbering) {
    const abs = new Map(Array.from(numbering.getElementsByTagNameNS(W, "abstractNum")).map((a) => [a.getAttributeNS(W, "abstractNumId")!, a.getElementsByTagNameNS(W, "numFmt")[0]?.getAttributeNS(W, "val") ?? ""]));
    for (const n of Array.from(numbering.getElementsByTagNameNS(W, "num"))) fmt.set(n.getAttributeNS(W, "numId")!, abs.get(n.getElementsByTagNameNS(W, "abstractNumId")[0].getAttributeNS(W, "val")!) ?? "");
  }
  const doc = await parse("word/document.xml");
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  const textOf = (el: Element) => Array.from(el.getElementsByTagNameNS(W, "t")).map((t) => t.textContent).join("");
  const paragraphs: DocxSummary["paragraphs"] = [];
  const tables: string[][][] = [];
  const order: string[] = [];
  for (const el of Array.from(body.children)) {
    if (el.localName === "p") {
      const text = textOf(el);
      const numId = el.getElementsByTagNameNS(W, "numId")[0]?.getAttributeNS(W, "val");
      if (!text.trim() && !numId) continue;
      const bold = Array.from(el.getElementsByTagNameNS(W, "r"))
        .filter((r) => r.getElementsByTagNameNS(W, "b").length)
        .map(textOf);
      paragraphs.push({ style: el.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") ?? null, text, list: numId ? (fmt.get(numId) ?? "?") : null, bold });
      order.push(text);
    } else if (el.localName === "tbl") {
      const rows = Array.from(el.getElementsByTagNameNS(W, "tr")).map((tr) => Array.from(tr.getElementsByTagNameNS(W, "tc")).map(textOf));
      tables.push(rows);
      order.push(...rows.map((r) => r.join("\t")));
    }
  }
  const media: Uint8Array[] = [];
  for (const name of Object.keys(zip.files).filter((n) => n.startsWith("word/media/") && !zip.files[n].dir)) media.push(await zip.file(name)!.async("uint8array"));
  return {
    paragraphs,
    tables,
    pictures: doc.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "inline").length,
    sections: doc.getElementsByTagNameNS(W, "sectPr").length,
    media,
    text: order.join("\n"),
  };
}

/** Upload → Convert to Word → download, through the real page. */
export async function convertToWord(page: Page, pdf: string, timeout = 60_000): Promise<{ bytes: Buffer; name: string }> {
  await page.goto("/pdf-to-word");
  await page.getByTestId("file-input").first().setInputFiles(pdf);
  await page.getByRole("button", { name: "Convert to Word" }).click({ timeout: 30_000 });
  await expect(page.getByTestId("result").getByRole("status")).toHaveText("Your Word document is ready", { timeout });
  const { download, bytes } = await downloadFrom(page, page.getByRole("button", { name: "Download .docx" }));
  return { bytes, name: download.suggestedFilename() };
}
