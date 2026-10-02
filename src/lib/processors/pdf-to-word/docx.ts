import JSZip from "jszip";
import type { Block, CellParagraph, FloatingImage, PageLayout, ParaFormat, Run } from "./layout";

/**
 * Writes a real Office Open XML (.docx) document from the page layouts: styles (Normal, Heading 1–3,
 * List Paragraph), list numbering, tables, pictures (in the flow or pinned to the page), headers and
 * footers with page-number fields, two-column sections, and one section per PDF page so each PDF page
 * starts a new Word page with the same size, orientation and margins. Every paragraph carries the
 * measured look of the original — font, size, colour, spacing, indents, tabs — so the document looks
 * like the PDF, while staying ordinary editable Word text.
 */

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/** XML-escapes text and drops the few code points XML 1.0 can't carry (control characters, unpaired
 * surrogates). Every other character — accents, currency, smart quotes, check marks, CJK — is kept. */
export function xmlText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Typographic ligatures (ﬁ, ﬂ …) become their letters, so words stay searchable and spell-checkable. */
function normalizeText(s: string): string {
  return s.replace(/[\uFB00-\uFB06]/g, (c) => c.normalize("NFKC")).normalize("NFC");
}

const twips = (pt: number) => Math.round(pt * 20);
const emu = (pt: number) => Math.round(pt * 12700);

interface Media {
  name: string;
  rId: string;
  bytes: Uint8Array;
  mime: string;
}

export interface DocxOptions {
  title: string;
  bodySize: number;
  /** The document's main font (Word name); runs in other fonts name theirs. */
  bodyFont?: string;
}

export async function buildDocx(pages: PageLayout[], options: DocxOptions): Promise<Uint8Array> {
  const media: Media[] = [];
  const bodySize = options.bodySize;
  const bodyFont = options.bodyFont || "Arial";
  let drawingId = 1;

  // ------------------------------------------------------------------ runs and paragraphs
  const rPr = (r: Omit<Run, "text">) => {
    const p: string[] = [];
    if (r.font && r.font !== bodyFont) p.push(`<w:rFonts w:ascii="${xmlText(r.font)}" w:hAnsi="${xmlText(r.font)}" w:cs="${xmlText(r.font)}" w:eastAsia="${xmlText(r.font)}"/>`);
    if (r.bold) p.push("<w:b/><w:bCs/>");
    if (r.italic) p.push("<w:i/><w:iCs/>");
    if (r.strike) p.push("<w:strike/>");
    if (r.color) p.push(`<w:color w:val="${r.color.toUpperCase()}"/>`);
    const half = Math.max(2, Math.round(r.size * 2));
    if (half !== Math.round(bodySize * 2)) p.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);
    if (r.underline) p.push('<w:u w:val="single"/>');
    return p.length ? `<w:rPr>${p.join("")}</w:rPr>` : "";
  };
  const runXml = (r: Run): string => {
    const props = rPr(r);
    if (r.field) {
      // A live PAGE / NUMPAGES field with the original number as its cached result.
      return `<w:r>${props}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${props}<w:instrText xml:space="preserve"> ${r.field} </w:instrText></w:r><w:r>${props}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${props}<w:t>${xmlText(r.text)}</w:t></w:r><w:r>${props}<w:fldChar w:fldCharType="end"/></w:r>`;
    }
    // Tabs (cell gaps on one line) are real tab characters in Word.
    const parts = normalizeText(r.text).split("\t");
    return parts.map((t, i) => `${i > 0 ? `<w:r>${props}<w:tab/></w:r>` : ""}${t ? `<w:r>${props}<w:t xml:space="preserve">${xmlText(t)}</w:t></w:r>` : ""}`).join("");
  };
  const jc = (a: string) => (a === "center" ? "center" : a === "right" ? "right" : a === "justify" ? "both" : "left");
  const pPrXml = (fmt: ParaFormat, extra = "") => {
    // Children in the order the schema requires (Word rejects out-of-order properties).
    const p: string[] = [extra];
    if (fmt.borderBottom) {
      const b = fmt.borderBottom;
      p.push(`<w:pBdr><w:bottom w:val="single" w:sz="${Math.max(2, Math.min(96, Math.round(b.thickness * 8)))}" w:space="${Math.max(0, Math.min(31, Math.round(b.space)))}" w:color="${b.color.toUpperCase()}"/></w:pBdr>`);
    }
    if (fmt.shading) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${fmt.shading.toUpperCase()}"/>`);
    if (fmt.tabs.length) p.push(`<w:tabs>${fmt.tabs.map((t) => `<w:tab w:val="${t.align}"${t.leader ? ` w:leader="${t.leader}"` : ""} w:pos="${twips(t.pos)}"/>`).join("")}</w:tabs>`);
    const line = fmt.line ? ` w:line="${twips(fmt.line)}" w:lineRule="exact"` : ' w:line="240" w:lineRule="auto"';
    p.push(`<w:spacing w:before="${twips(fmt.spaceBefore)}" w:after="0"${line}/>`);
    const first = fmt.indFirst < 0 ? ` w:hanging="${twips(-fmt.indFirst)}"` : fmt.indFirst > 0 ? ` w:firstLine="${twips(fmt.indFirst)}"` : "";
    if (fmt.indLeft || fmt.indRight || fmt.indFirst) p.push(`<w:ind w:left="${twips(fmt.indLeft)}" w:right="${twips(fmt.indRight)}"${first}/>`);
    p.push(`<w:jc w:val="${jc(fmt.align)}"/>`);
    return `<w:pPr>${p.join("")}</w:pPr>`;
  };

  // ------------------------------------------------------------------ lists
  // One abstract list per marker ("•", "▪", decimal…), one list instance per run of items.
  const abstracts = new Map<string, { id: number; label: Run }>();
  const lists = new Map<number, { numId: number; abs: number; start: number }>();
  let nextNumId = 1;
  const numIdFor = (b: Extract<Block, { kind: "list" }>) => {
    const key = b.ordered ? "decimal" : b.bullet;
    let abs = abstracts.get(key);
    if (!abs) abstracts.set(key, (abs = { id: abstracts.size, label: b.label }));
    let l = lists.get(b.listKey);
    if (!l) lists.set(b.listKey, (l = { numId: nextNumId++, abs: abs.id, start: b.start }));
    return l.numId;
  };

  // ------------------------------------------------------------------ pictures
  const addMedia = (im: { bytes: Uint8Array; mime: string }) => {
    const n = media.length + 1;
    const ext = im.mime === "image/png" ? "png" : "jpeg";
    const m: Media = { name: `image${n}.${ext}`, rId: `rIdImg${n}`, bytes: im.bytes, mime: im.mime };
    media.push(m);
    return m;
  };
  const graphic = (m: Media, id: number, cx: number, cy: number) =>
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${m.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${m.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  const inlineImage = (im: { bytes: Uint8Array; mime: string }, w: number, h: number) => {
    const m = addMedia(im);
    const id = drawingId++;
    const cx = emu(w);
    const cy = emu(h);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>${graphic(m, id, cx, cy)}</wp:inline></w:drawing></w:r>`;
  };
  const anchoredImage = (f: FloatingImage) => {
    const m = addMedia(f.image);
    const id = drawingId++;
    const cx = emu(f.width);
    const cy = emu(f.height);
    return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(f.x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${emu(f.y)}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>${graphic(m, id, cx, cy)}</wp:anchor></w:drawing></w:r>`;
  };

  // ------------------------------------------------------------------ blocks
  const cellParagraph = (p: CellParagraph) => {
    const line = p.line ? `w:line="${twips(p.line)}" w:lineRule="exact"` : 'w:line="240" w:lineRule="auto"';
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" ${line}/><w:jc w:val="${jc(p.align)}"/></w:pPr>${p.runs.map(runXml).join("")}</w:p>`;
  };
  const spacer = (pt: number) => (pt >= 1 ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${twips(pt)}" w:lineRule="exact"/></w:pPr></w:p>` : "");

  const blockXml = (b: Block, lead = ""): string => {
    switch (b.kind) {
      case "paragraph": {
        const style = b.style !== "normal" ? `<w:pStyle w:val="Heading${b.style.slice(1)}"/>` : "";
        return `<w:p>${pPrXml(b.fmt, style)}${lead}${b.runs.map(runXml).join("")}</w:p>`;
      }
      case "list": {
        const numId = numIdFor(b);
        return `<w:p>${pPrXml(b.fmt, `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`)}${lead}${b.runs.map(runXml).join("")}</w:p>`;
      }
      case "image":
        return `<w:p>${pPrXml(b.fmt)}${lead}${inlineImage(b.image, b.width, b.height)}</w:p>`;
      case "table": {
        const border = b.border ? `w:val="single" w:sz="${Math.max(2, Math.min(96, Math.round(b.border.thickness * 8)))}" w:space="0" w:color="${b.border.color.toUpperCase()}"` : 'w:val="nil"';
        const borders = `<w:tblBorders><w:top ${border}/><w:left ${border}/><w:bottom ${border}/><w:right ${border}/><w:insideH ${border}/><w:insideV ${border}/></w:tblBorders>`;
        const grid = b.columns.map((c) => `<w:gridCol w:w="${twips(c)}"/>`).join("");
        const total = b.columns.reduce((s, c) => s + c, 0);
        const rows = b.rows
          .map((row) => {
            let col = 0;
            const cells = row.cells
              .map((cell) => {
                const w = b.columns.slice(col, col + cell.span).reduce((s, c) => s + c, 0);
                col += cell.span;
                const tcPr = [`<w:tcW w:w="${twips(w)}" w:type="dxa"/>`, cell.span > 1 ? `<w:gridSpan w:val="${cell.span}"/>` : "", cell.vMerge === "restart" ? '<w:vMerge w:val="restart"/>' : cell.vMerge === "continue" ? "<w:vMerge/>" : "", cell.shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.shading.toUpperCase()}"/>` : ""].join("");
                return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${cell.paragraphs.map(cellParagraph).join("")}</w:tc>`;
              })
              .join("");
            return `<w:tr><w:trPr><w:trHeight w:val="${twips(row.height)}" w:hRule="atLeast"/></w:trPr>${cells}</w:tr>`;
          })
          .join("");
        const mar = `<w:tblCellMar><w:top w:w="${twips(b.cellMargin.top)}" w:type="dxa"/><w:left w:w="${twips(b.cellMargin.left)}" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="${twips(b.cellMargin.right)}" w:type="dxa"/></w:tblCellMar>`;
        const floatPr = b.float ? `<w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="${twips(b.float.x)}" w:tblpY="${twips(b.float.y)}"/><w:tblOverlap w:val="overlap"/>` : "";
        const table = `<w:tbl><w:tblPr>${floatPr}<w:tblW w:w="${twips(total)}" w:type="dxa"/>${b.float ? "" : `<w:tblInd w:w="${twips(b.indent)}" w:type="dxa"/>`}${borders}<w:tblLayout w:type="fixed"/>${mar}<w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
        // Space above a table: Word has no "space before" for tables, so a tiny spacer paragraph holds it.
        if (b.float) return `${lead ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>${lead}</w:p>` : ""}${table}`;
        return `${spacer(b.spaceBefore)}${lead ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>${lead}</w:p>` : ""}${table}`;
      }
      case "columns":
        return ""; // written by the page loop (it needs its own section)
    }
  };

  // ------------------------------------------------------------------ headers / footers
  const parts: { name: string; rId: string; type: "header" | "footer"; xml: string }[] = [];
  const bandPart = (type: "header" | "footer", paragraphs: CellParagraph[] | null) => {
    if (!paragraphs?.length) return null;
    const body = paragraphs.map(cellParagraph).join("");
    const tag = type === "header" ? "hdr" : "ftr";
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} ${W_NS}>${body}</w:${tag}>`;
    const existing = parts.find((p) => p.type === type && p.xml === xml);
    if (existing) return existing.rId;
    const n = parts.filter((p) => p.type === type).length + 1;
    const part = { name: `${type}${n}.xml`, rId: `rId${type === "header" ? "Hdr" : "Ftr"}${n}`, type, xml };
    parts.push(part);
    return part.rId;
  };

  // ------------------------------------------------------------------ pages → sections
  const body: string[] = [];
  const sectPr = (p: PageLayout, opts: { continuous: boolean; cols?: { count: number; gap: number }; header: string | null; footer: string | null }) => {
    const landscape = p.width > p.height;
    const pg = `<w:pgSz w:w="${twips(p.width)}" w:h="${twips(p.height)}"${landscape ? ' w:orient="landscape"' : ""}/>`;
    const mar = `<w:pgMar w:top="${twips(p.margins.top)}" w:right="${twips(p.margins.right)}" w:bottom="${twips(p.margins.bottom)}" w:left="${twips(p.margins.left)}" w:header="${twips(p.headerDistance)}" w:footer="${twips(p.footerDistance)}" w:gutter="0"/>`;
    const refs = `${opts.header ? `<w:headerReference w:type="default" r:id="${opts.header}"/>` : ""}${opts.footer ? `<w:footerReference w:type="default" r:id="${opts.footer}"/>` : ""}`;
    const cols = opts.cols ? `<w:cols w:num="${opts.cols.count}" w:space="${twips(opts.cols.gap)}"/>` : '<w:cols w:space="720"/>';
    return `<w:sectPr>${refs}<w:type w:val="${opts.continuous ? "continuous" : "nextPage"}"/>${pg}${mar}${cols}</w:sectPr>`;
  };
  const sectionEnd = (xml: string) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${xml}</w:pPr></w:p>`;

  let finalSect = "";
  pages.forEach((p, i) => {
    const header = bandPart("header", p.header);
    const footer = bandPart("footer", p.footer);
    // Pictures pinned to the page ride on the page's first paragraph.
    let pinned = p.floating.map(anchoredImage).join("");
    const lead = () => {
      const x = pinned;
      pinned = "";
      return x;
    };
    // Split the page into single-column and two-column stretches; each becomes a section.
    const segments: { cols: { count: number; gap: number } | null; blocks: Block[]; left?: Block[]; right?: Block[]; spaceBefore?: number }[] = [];
    for (const b of p.blocks) {
      if (b.kind === "columns") segments.push({ cols: { count: 2, gap: b.gap }, blocks: [], left: b.left, right: b.right, spaceBefore: b.spaceBefore });
      else {
        const last = segments[segments.length - 1];
        if (last && !last.cols) last.blocks.push(b);
        else segments.push({ cols: null, blocks: [b] });
      }
    }
    if (!segments.length) segments.push({ cols: null, blocks: [] });
    segments.forEach((seg, k) => {
      const out: string[] = [];
      if (seg.cols) {
        if ((seg.spaceBefore ?? 0) > 0) out.push(spacer(seg.spaceBefore!));
        (seg.left ?? []).forEach((b) => out.push(blockXml(b, lead())));
        const right = seg.right ?? [];
        right.forEach((b, j) => {
          const brk = j === 0 ? '<w:r><w:br w:type="column"/></w:r>' : "";
          if (brk && b.kind === "table") out.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>${brk}</w:p>${blockXml(b)}`);
          else out.push(blockXml(b, brk));
        });
      } else seg.blocks.forEach((b) => out.push(blockXml(b, lead())));
      if (pinned) out.unshift(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>${lead()}</w:p>`);
      if (!out.length) out.push("<w:p/>");
      body.push(...out);
      const lastSegment = k === segments.length - 1;
      const xml = sectPr(p, { continuous: k > 0, cols: seg.cols ?? undefined, header, footer });
      if (lastSegment && i === pages.length - 1) finalSect = xml;
      else body.push(sectionEnd(xml));
    });
  });
  if (!finalSect) finalSect = sectPr(pages[0] ?? { width: 612, height: 792, margins: { left: 72, right: 72, top: 72, bottom: 72 }, blocks: [], floating: [], header: null, footer: null, headerDistance: 36, footerDistance: 36 }, { continuous: false, header: null, footer: null });
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W_NS}><w:body>${body.join("")}${finalSect}</w:body></w:document>`;

  // ------------------------------------------------------------------ styles and numbering
  const half = Math.round(bodySize * 2);
  const font = xmlText(bodyFont);
  const heading = (n: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:outlineLvl w:val="${n - 1}"/></w:pPr></w:style>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1)}${heading(2)}${heading(3)}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;

  const abstractXml = [...abstracts.entries()]
    .map(([key, { id, label }]) => {
      const fmt = key === "decimal" ? "decimal" : "bullet";
      const text = key === "decimal" ? "%1." : xmlText(key);
      return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${rPr({ ...label, bold: label.bold, italic: false, underline: false, strike: false })}</w:lvl></w:abstractNum>`;
    })
    .join("");
  const numXml = [...lists.values()].map(({ numId, abs, start }) => `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abs}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`).join("");
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abstractXml}${numXml}</w:numbering>`;

  const docRels = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
    '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    ...media.map((m) => `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`),
    ...parts.map((p) => `<Relationship Id="${p.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${p.type}" Target="${p.name}"/>`),
  ];
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const zip = new JSZip();
  // Parts only, no folder entries — the same shape Word itself writes.
  const put = (name: string, data: string | Uint8Array) => zip.file(name, data, { createFolders: false });
  const overrides = parts.map((p) => `<Override PartName="/word/${p.name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${p.type}+xml"/>`).join("");
  put(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${overrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  );
  put(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  put(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(options.title)}</dc:title><dc:creator>TheFileConvert</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  put("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>TheFileConvert</Application><Pages>${pages.length}</Pages></Properties>`);
  put("word/document.xml", documentXml);
  put("word/styles.xml", stylesXml);
  put("word/numbering.xml", numberingXml);
  put("word/settings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
  for (const p of parts) put(`word/${p.name}`, p.xml);
  put("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels.join("")}</Relationships>`);
  for (const m of media) put(`word/media/${m.name}`, m.bytes);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

/**
 * Re-opens a finished .docx before anyone can download it: the package must unzip, carry every required
 * part, every XML part must parse, and every relationship must point at a part that exists.
 * Returns a list of problems (empty = valid).
 */
export async function verifyDocx(bytes: Uint8Array): Promise<string[]> {
  const problems: string[] = [];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return ["not a ZIP package"];
  }
  for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"]) {
    if (!zip.file(part)) problems.push(`missing ${part}`);
  }
  const parser = new DOMParser();
  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    const dom = parser.parseFromString(xml, "application/xml");
    if (dom.getElementsByTagName("parsererror").length) {
      problems.push(`${name} is not well-formed XML`);
      continue;
    }
    if (name.endsWith(".rels")) {
      const base = name.replace(/_rels\/[^/]*\.rels$/, "");
      for (const rel of Array.from(dom.getElementsByTagName("Relationship"))) {
        if (rel.getAttribute("TargetMode") === "External") continue;
        const target = (base + (rel.getAttribute("Target") ?? "")).replace(/^\//, "");
        if (!zip.file(target)) problems.push(`${name} points at missing ${target}`);
      }
    }
  }
  return problems;
}
