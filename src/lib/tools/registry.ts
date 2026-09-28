/**
 * The first-launch tool set. Every route, nav entry, homepage card, sitemap row and smart-entry
 * suggestion reads from this list, so a tool can't appear in one place and be missing from another.
 */

export type ToolCategory = "compress" | "convert" | "edit" | "organize";

export type ToolId =
  | "compress-pdf"
  | "compress-image"
  | "convert-image"
  | "pdf-to-image"
  | "pdf-to-word"
  | "word-to-pdf"
  | "image-to-pdf"
  | "merge-pdf"
  | "split-pdf"
  | "organize-pdf"
  | "pdf-editor";

export interface ToolFaq {
  q: string;
  a: string;
}

export interface Tool {
  id: ToolId;
  href: `/${ToolId}`;
  name: string;
  /** One line for cards and menus. */
  short: string;
  /** Page <title> (the layout appends the brand). */
  seoTitle: string;
  seoDescription: string;
  category: ToolCategory;
  /** What the drop zone asks for. */
  inputNoun: string;
  accept: string;
  acceptedExtensions: string[];
  acceptedMimeTypes: string[];
  multiple: boolean;
  maxRecommendedSizeMb: number;
  faq: ToolFaq[];
}

const PDF_EXT = ["pdf"];
const PDF_MIME = ["application/pdf"];
const RASTER_EXT = ["jpg", "jpeg", "png", "webp"];
const RASTER_MIME = ["image/jpeg", "image/png", "image/webp"];
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const TOOLS: Tool[] = [
  {
    id: "compress-pdf",
    href: "/compress-pdf",
    name: "Compress PDF",
    short: "Pick a target size — 500 KB, 1 MB, 2 MB — and get a PDF under it.",
    seoTitle: "Compress PDF to a target size",
    seoDescription:
      "Make a PDF smaller than 500 KB, 1 MB or any size you choose. Runs in your browser — the file never leaves your device.",
    category: "compress",
    inputNoun: "PDF",
    accept: ".pdf,application/pdf",
    acceptedExtensions: PDF_EXT,
    acceptedMimeTypes: PDF_MIME,
    multiple: false,
    maxRecommendedSizeMb: 200,
    faq: [
      {
        q: "How do I get a PDF under a specific size?",
        a: "Choose a target such as 1 MB or type your own. TheFileConvert first tries a lossless clean-up, then steps down image quality only as far as needed, and stops at the first result that fits.",
      },
      {
        q: "What if my PDF can't get that small?",
        a: "You'll see the closest size we could reach without making the pages unreadable, with the exact number of bytes. We never label a result as reaching your target when it didn't.",
      },
      {
        q: "Will text stay sharp?",
        a: "Text and vector graphics are kept as they are. Only embedded images (scans and photos) are re-encoded, so a text-only PDF has little room to shrink.",
      },
      {
        q: "Is my PDF uploaded?",
        a: "No. Compression runs inside this browser tab. The file is never sent to a server.",
      },
    ],
  },
  {
    id: "compress-image",
    href: "/compress-image",
    name: "Compress Image",
    short: "Shrink a JPG, PNG or WebP to 100 KB, 500 KB or any size you need.",
    seoTitle: "Compress an image to a target size",
    seoDescription:
      "Reduce a JPG, PNG or WebP to under 100 KB, 250 KB, 1 MB or your own limit — no quality slider, no upload.",
    category: "compress",
    inputNoun: "image",
    accept: ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
    acceptedExtensions: RASTER_EXT,
    acceptedMimeTypes: RASTER_MIME,
    multiple: false,
    maxRecommendedSizeMb: 60,
    faq: [
      {
        q: "Why is there no quality slider?",
        a: "Most people know the size they need, not the quality number that gets them there. You pick the size; TheFileConvert tries the highest quality first and only reduces dimensions if quality alone can't reach it.",
      },
      {
        q: "Why did my PNG become a WebP?",
        a: "PNG is lossless, so it can't be squeezed much. WebP keeps transparency and reaches far smaller sizes, so it's used when a PNG needs to shrink. You'll always see when the format changes.",
      },
      {
        q: "Is my image uploaded?",
        a: "No. The image is processed in this browser tab and never leaves your device.",
      },
    ],
  },
  {
    id: "pdf-to-word",
    href: "/pdf-to-word",
    name: "PDF to Word",
    short: "Turn a PDF into an editable Word document (.docx) — scans included.",
    seoTitle: "PDF to Word (DOCX) converter",
    seoDescription:
      "Convert a PDF into an editable Word .docx in your browser. Text, headings, lists and pictures come across; scanned pages are read with on-device OCR. No upload.",
    category: "convert",
    inputNoun: "PDF",
    accept: ".pdf,application/pdf",
    acceptedExtensions: PDF_EXT,
    acceptedMimeTypes: PDF_MIME,
    multiple: false,
    maxRecommendedSizeMb: 100,
    faq: [
      {
        q: "Will the Word file look exactly like the PDF?",
        a: "Close, but not identical. We keep the text, headings, paragraphs, lists, simple tables and pictures in reading order, and start each PDF page on a new Word page. Complex layouts may need small formatting touch-ups.",
      },
      {
        q: "What about scanned PDFs?",
        a: "Scanned pages are recognised with OCR on your device, so the text in the Word document is editable. Check names, dates and numbers against the original — OCR can misread poor scans.",
      },
      {
        q: "Is my PDF uploaded?",
        a: "No. Reading the PDF, OCR and building the .docx all happen in your browser. Nothing is sent to a server.",
      },
      {
        q: "Does it work with password-protected PDFs?",
        a: "Not with ones that need a password to open. Remove the password in your PDF app first, then convert.",
      },
    ],
  },
  {
    id: "word-to-pdf",
    href: "/word-to-pdf",
    name: "Word to PDF",
    short: "Turn a Word document (.docx) into a PDF that looks the same on every device.",
    seoTitle: "Word to PDF (DOCX to PDF) converter",
    seoDescription:
      "Convert a Word .docx to PDF in your browser. Headings, lists, tables, pictures, headers and footers come across. No upload, no sign-up, no watermark.",
    category: "convert",
    inputNoun: "Word document",
    accept: `.docx,${DOCX_MIME}`,
    acceptedExtensions: ["docx"],
    acceptedMimeTypes: [DOCX_MIME],
    multiple: false,
    maxRecommendedSizeMb: 50,
    faq: [
      {
        q: "Will the PDF look exactly like my Word document?",
        a: "Very close for everyday documents. Text, headings, bold and italic, lists, tables, pictures, page breaks, headers and footers come across, and Word's standard fonts are drawn with fonts of the same width, so lines and pages break in nearly the same places. Complex Word layouts — text wrapped around pictures, text boxes, unusual fonts — may vary slightly from Microsoft Word.",
      },
      {
        q: "Can I convert an old .doc file?",
        a: "Not yet — only .docx (Word 2007 and later). Open the .doc in Word, Google Docs or LibreOffice, save it as .docx, then convert it here.",
      },
      {
        q: "Is my document uploaded?",
        a: "No. The document is read and the PDF is drawn inside this browser tab. Nothing is sent to a server.",
      },
      {
        q: "Does it work with password-protected documents?",
        a: "Not with ones that need a password to open. Remove the password in Word (File → Info → Protect Document), save, then convert.",
      },
    ],
  },
  {
    id: "pdf-to-image",
    href: "/pdf-to-image",
    name: "PDF to Image",
    short: "Turn every page — or just the ones you pick — into JPG or PNG.",
    seoTitle: "PDF to JPG or PNG",
    seoDescription: "Convert PDF pages to high-resolution JPG or PNG images. Pick pages, download one or all as a ZIP.",
    category: "convert",
    inputNoun: "PDF",
    accept: ".pdf,application/pdf",
    acceptedExtensions: PDF_EXT,
    acceptedMimeTypes: PDF_MIME,
    multiple: false,
    maxRecommendedSizeMb: 200,
    faq: [
      {
        q: "What resolution are the images?",
        a: "Pages are rendered at 2× their PDF size (about 144 DPI), which is sharp on screens and fine for most printing.",
      },
      {
        q: "Can I convert only some pages?",
        a: "Yes. Every page shows as a thumbnail — select the ones you want, or convert them all.",
      },
    ],
  },
  {
    id: "image-to-pdf",
    href: "/image-to-pdf",
    name: "Image to PDF",
    short: "Combine photos and scans into one PDF, in the order you choose.",
    seoTitle: "Image to PDF — JPG, PNG or WebP to PDF",
    seoDescription: "Combine JPG, PNG and WebP images into a single PDF. Drag to reorder, choose page size, no upload.",
    category: "convert",
    inputNoun: "images",
    accept: ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
    acceptedExtensions: RASTER_EXT,
    acceptedMimeTypes: RASTER_MIME,
    multiple: true,
    maxRecommendedSizeMb: 60,
    faq: [
      {
        q: "What page size is used?",
        a: "By default each page matches its image, so nothing is cropped or padded. You can switch to A4 or Letter with a small margin.",
      },
      {
        q: "Can I change the order?",
        a: "Yes — drag the cards, or use the arrow buttons on each one.",
      },
    ],
  },
  {
    id: "convert-image",
    href: "/convert-image",
    name: "Image Converter",
    short: "JPG, PNG, WebP and SVG — choose the format you need, nothing else.",
    seoTitle: "Image Converter — JPG, PNG, WebP, SVG",
    seoDescription:
      "Convert JPG to PNG, PNG to JPG, WebP to JPG, SVG to PNG and more. One click, no settings, no upload.",
    category: "convert",
    inputNoun: "images",
    accept: ".jpg,.jpeg,.png,.webp,.svg,image/jpeg,image/png,image/webp,image/svg+xml",
    acceptedExtensions: [...RASTER_EXT, "svg"],
    acceptedMimeTypes: [...RASTER_MIME, "image/svg+xml"],
    multiple: true,
    maxRecommendedSizeMb: 60,
    faq: [
      {
        q: "Which conversions are supported?",
        a: "JPG → PNG or WebP, PNG → JPG or WebP, WebP → JPG or PNG, and SVG → PNG, JPG or WebP.",
      },
      {
        q: "What happens to transparency when converting to JPG?",
        a: "JPG can't store transparency, so transparent areas are filled with white. PNG and WebP keep it.",
      },
      {
        q: "Are my images uploaded?",
        a: "No. Conversion happens in your browser; nothing is sent to a server.",
      },
    ],
  },
  {
    id: "merge-pdf",
    href: "/merge-pdf",
    name: "Merge PDF",
    short: "Put several PDFs together in the order you want.",
    seoTitle: "Merge PDF files",
    seoDescription: "Combine multiple PDFs into one. Drag to reorder, see page counts, merge in your browser.",
    category: "organize",
    inputNoun: "PDFs",
    accept: ".pdf,application/pdf",
    acceptedExtensions: PDF_EXT,
    acceptedMimeTypes: PDF_MIME,
    multiple: true,
    maxRecommendedSizeMb: 200,
    faq: [
      {
        q: "Is there a limit on the number of files?",
        a: "No fixed limit — it depends on your device's memory. Dozens of ordinary PDFs merge without trouble.",
      },
      {
        q: "Do bookmarks and links survive?",
        a: "Page content, including text and images, is kept exactly. Document-level extras such as bookmarks may not carry over.",
      },
    ],
  },
  {
    id: "split-pdf",
    href: "/split-pdf",
    name: "Split PDF",
    short: "Pull out the pages you need, or split every page into its own file.",
    seoTitle: "Split PDF — extract pages",
    seoDescription: "Extract selected pages from a PDF or split every page into a separate file. Visual page picker, no upload.",
    category: "organize",
    inputNoun: "PDF",
    accept: ".pdf,application/pdf",
    acceptedExtensions: PDF_EXT,
    acceptedMimeTypes: PDF_MIME,
    multiple: false,
    maxRecommendedSizeMb: 200,
    faq: [
      {
        q: "How do I choose pages?",
        a: "Click the page thumbnails you want. If you prefer, you can also type a range like 1-3, 7.",
      },
      {
        q: "What does 'split every page' give me?",
        a: "One PDF per page, downloaded together as a ZIP.",
      },
    ],
  },
  {
    id: "organize-pdf",
    href: "/organize-pdf",
    name: "Organize PDF",
    short: "Reorder, rotate, duplicate and delete pages with a visual grid.",
    seoTitle: "Organize PDF pages — reorder, rotate, delete",
    seoDescription: "Rearrange PDF pages by dragging, rotate them, duplicate or delete them, then save the new PDF.",
    category: "organize",
    inputNoun: "PDF",
    accept: ".pdf,application/pdf",
    acceptedExtensions: PDF_EXT,
    acceptedMimeTypes: PDF_MIME,
    multiple: false,
    maxRecommendedSizeMb: 200,
    faq: [
      {
        q: "Does rotating reduce quality?",
        a: "No. Rotation only changes how the page is displayed; the content itself isn't re-rendered.",
      },
      {
        q: "Can I undo a deletion?",
        a: "Yes — deleted pages can be restored until you save. Your original file is never changed.",
      },
    ],
  },
  {
    id: "pdf-editor",
    href: "/pdf-editor",
    name: "PDF Editor",
    short: "Edit text, fix scans, highlight, draw, sign and add images.",
    seoTitle: "Edit PDF in your browser",
    seoDescription:
      "Edit PDF text, correct scanned documents with on-device OCR, highlight, draw, add images and a visual signature. No upload.",
    category: "edit",
    inputNoun: "PDF",
    accept: ".pdf,application/pdf",
    acceptedExtensions: PDF_EXT,
    acceptedMimeTypes: PDF_MIME,
    multiple: false,
    maxRecommendedSizeMb: 200,
    faq: [
      {
        q: "Can I edit text in a scanned PDF?",
        a: "Yes. Click Recognize text — the page is read with OCR on your device — then click any word to correct it. The change is painted to match the surrounding scan as closely as possible; always check the preview.",
      },
      {
        q: "Is the signature legally binding?",
        a: "It's a visual signature — an image of your signature placed on the page. It is not a cryptographic digital signature.",
      },
      {
        q: "Does whiteout remove the text underneath?",
        a: "No. Whiteout visually covers content; the original is still inside the file. It is not secure redaction.",
      },
      {
        q: "Is my PDF uploaded?",
        a: "No. The editor, OCR included, runs entirely in your browser.",
      },
    ],
  },
];

export const CATEGORY_LABEL: Record<ToolCategory, string> = {
  compress: "Compress",
  convert: "Convert",
  edit: "Edit",
  organize: "Organize",
};

export function getTool(id: ToolId): Tool {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}

export function toolsInCategory(category: ToolCategory): Tool[] {
  return TOOLS.filter((t) => t.category === category);
}

export type EntryKind = "pdf" | "word" | "image" | "svg" | "unsupported";

/** Classifies a dropped file for the homepage's "what do you want to do with it?" step. */
export function entryKindFor(file: { name: string; type: string }): EntryKind {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type === DOCX_MIME || name.endsWith(".docx")) return "word";
  if (file.type === "image/svg+xml" || name.endsWith(".svg")) return "svg";
  if (/^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/.test(name)) return "image";
  return "unsupported";
}

/** The tools offered for a dropped file (or files), most likely first. Several files only get
 * tools that take several files. */
export function suggestionsFor(kind: EntryKind, count: number): ToolId[] {
  switch (kind) {
    case "pdf":
      return count > 1 ? ["merge-pdf"] : ["compress-pdf", "pdf-editor", "pdf-to-word", "merge-pdf", "split-pdf", "pdf-to-image", "organize-pdf"];
    case "word":
      return count > 1 ? [] : ["word-to-pdf"];
    case "image":
      return count > 1 ? ["image-to-pdf", "convert-image"] : ["compress-image", "convert-image", "image-to-pdf"];
    case "svg":
      return ["convert-image"];
    default:
      return [];
  }
}

/** One kind for a set of dropped files; "unsupported" when they can't go to the same tool. */
export function entryKindForAll(files: { name: string; type: string }[]): EntryKind {
  const kinds = new Set(files.map(entryKindFor));
  if (kinds.size === 0 || kinds.has("unsupported")) return "unsupported";
  if (kinds.has("pdf")) return kinds.size === 1 ? "pdf" : "unsupported";
  if (kinds.has("word")) return kinds.size === 1 ? "word" : "unsupported";
  return kinds.has("svg") ? "svg" : "image";
}
