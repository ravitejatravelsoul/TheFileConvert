import JSZip from "jszip";
import type { Block, PageLayout, Run } from "./layout";

/**
 * Writes a real Office Open XML (.docx) document: styles (Normal, Heading 1–3, List Paragraph), list
 * numbering, tables, inline pictures and one section per PDF page, so each PDF page starts a new Word
 * page with the same size and orientation.
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

function runXml(r: Run, bodySize: number): string {
  const props: string[] = [];
  if (r.bold) props.push("<w:b/><w:bCs/>");
  if (r.italic) props.push("<w:i/><w:iCs/>");
  const half = Math.max(2, Math.round(r.size * 2));
  if (Math.abs(half - Math.round(bodySize * 2)) >= 1) props.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  // Tabs (cell gaps on one line) are real tab characters in Word.
  const parts = normalizeText(r.text).split("\t");
  return parts
    .map((t, i) => `${i > 0 ? `<w:r>${rPr}<w:tab/></w:r>` : ""}${t ? `<w:r>${rPr}<w:t xml:space="preserve">${xmlText(t)}</w:t></w:r>` : ""}`)
    .join("");
}

function paragraphXml(pPr: string, runs: Run[], bodySize: number): string {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs.map((r) => runXml(r, bodySize)).join("")}</w:p>`;
}

interface Media {
  name: string;
  rId: string;
  bytes: Uint8Array;
  mime: string;
}

export interface DocxOptions {
  title: string;
  bodySize: number;
}

export async function buildDocx(pages: PageLayout[], options: DocxOptions): Promise<Uint8Array> {
  const media: Media[] = [];
  const orderedLists = new Map<number, { numId: number; start: number }>();
  const BULLET_NUM = 1;
  let nextNumId = 2;
  let drawingId = 1;
  const body: string[] = [];
  const bodySize = options.bodySize;

  const blockXml = (b: Block): string => {
    switch (b.kind) {
      case "paragraph": {
        const pPr = [b.style !== "normal" ? `<w:pStyle w:val="Heading${b.style.slice(1)}"/>` : "", b.align !== "left" ? `<w:jc w:val="${b.align === "center" ? "center" : "right"}"/>` : ""].join("");
        return paragraphXml(pPr, b.runs, bodySize);
      }
      case "list": {
        let numId = BULLET_NUM;
        if (b.ordered) {
          let entry = orderedLists.get(b.listKey);
          if (!entry) {
            entry = { numId: nextNumId++, start: b.start };
            orderedLists.set(b.listKey, entry);
          }
          numId = entry.numId;
        }
        return paragraphXml(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`, b.runs, bodySize);
      }
      case "table": {
        const border = b.bordered ? 'w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"' : 'w:val="nil"';
        const borders = `<w:tblBorders><w:top ${border}/><w:left ${border}/><w:bottom ${border}/><w:right ${border}/><w:insideH ${border}/><w:insideV ${border}/></w:tblBorders>`;
        const grid = b.columns.map((c) => `<w:gridCol w:w="${twips(c)}"/>`).join("");
        const rows = b.rows
          .map(
            (row) =>
              `<w:tr>${row
                .map((cell, k) => `<w:tc><w:tcPr><w:tcW w:w="${twips(b.columns[k])}" w:type="dxa"/></w:tcPr>${paragraphXml('<w:spacing w:before="40" w:after="40"/>', cell, bodySize)}</w:tc>`)
                .join("")}</w:tr>`
          )
          .join("");
        return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
      }
      case "image": {
        const n = media.length + 1;
        const ext = b.image.mime === "image/png" ? "png" : "jpeg";
        const m: Media = { name: `image${n}.${ext}`, rId: `rIdImg${n}`, bytes: b.image.bytes, mime: b.image.mime };
        media.push(m);
        const id = drawingId++;
        const cx = emu(b.width);
        const cy = emu(b.height);
        return `<w:p><w:pPr><w:spacing w:before="120" w:after="120"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${m.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${m.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
      }
    }
  };

  const sectPr = (p: PageLayout, last: boolean) => {
    const landscape = p.width > p.height;
    const pg = `<w:pgSz w:w="${twips(p.width)}" w:h="${twips(p.height)}"${landscape ? ' w:orient="landscape"' : ""}/>`;
    const mar = `<w:pgMar w:top="${twips(p.margins.top)}" w:right="${twips(p.margins.right)}" w:bottom="${twips(p.margins.bottom)}" w:left="${twips(p.margins.left)}" w:header="360" w:footer="360" w:gutter="0"/>`;
    return `<w:sectPr>${last ? "" : '<w:type w:val="nextPage"/>'}${pg}${mar}</w:sectPr>`;
  };

  pages.forEach((p, i) => {
    for (const b of p.blocks) body.push(blockXml(b));
    if (p.blocks.length === 0) body.push("<w:p/>");
    const last = i === pages.length - 1;
    // Each PDF page is its own section: a page break with that page's size and orientation. The
    // section-ending paragraph is kept tiny so it doesn't add a visible blank line.
    if (!last) body.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${sectPr(p, false)}</w:pPr></w:p>`);
  });
  const lastPage = pages[pages.length - 1] ?? { width: 612, height: 792, margins: { left: 72, right: 72, top: 72, bottom: 72 }, blocks: [] };
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W_NS}><w:body>${body.join("")}${sectPr(lastPage, true)}</w:body></w:document>`;

  const half = Math.round(bodySize * 2);
  const heading = (n: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n === 1 ? 240 : 200}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, Math.round(half * 1.8))}${heading(2, Math.round(half * 1.45))}${heading(3, Math.round(half * 1.15))}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;

  const lvl = (fmt: string, text: string, font?: string) =>
    `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr>` : ""}</w:lvl>`;
  const nums = [`<w:num w:numId="${BULLET_NUM}"><w:abstractNumId w:val="0"/></w:num>`];
  for (const { numId, start } of orderedLists.values()) nums.push(`<w:num w:numId="${numId}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`);
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${lvl("bullet", "•", "Arial")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${lvl("decimal", "%1.")}</w:abstractNum>${nums.join("")}</w:numbering>`;

  const docRels = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
    '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    ...media.map((m) => `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`),
  ];
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const zip = new JSZip();
  // Parts only, no folder entries — the same shape Word itself writes.
  const put = (name: string, data: string | Uint8Array) => zip.file(name, data, { createFolders: false });
  put(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
  );
  put(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
  );
  put(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(options.title)}</dc:title><dc:creator>TheFileConvert</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
  );
  put(
    "docProps/app.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>TheFileConvert</Application><Pages>${pages.length}</Pages></Properties>`
  );
  put("word/document.xml", documentXml);
  put("word/styles.xml", stylesXml);
  put("word/numbering.xml", numberingXml);
  put("word/settings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
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
