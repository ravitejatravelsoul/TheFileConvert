export class ProcessorError extends Error {}

/**
 * Re-lays-out JSON text token by token instead of going through JSON.parse/stringify, so numbers keep
 * every digit (12345678901234567890 must not silently become 12345678901234567000) and strings, key order
 * and duplicate keys are exactly what the user typed. The input is validated with JSON.parse first.
 */
function relayoutJson(input: string, pretty: boolean): string {
  const out: string[] = [];
  let depth = 0;
  let i = 0;
  const nl = () => (pretty ? "\n" + "  ".repeat(depth) : "");
  while (i < input.length) {
    const c = input[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (input[j] !== '"') j += input[j] === "\\" ? 2 : 1;
      out.push(input.slice(i, j + 1));
      i = j + 1;
    } else if (c === "{" || c === "[") {
      let j = i + 1;
      while (/\s/.test(input[j] ?? "")) j++;
      if (input[j] === (c === "{" ? "}" : "]")) {
        out.push(c + input[j]);
        i = j + 1;
      } else {
        depth++;
        out.push(c + nl());
        i++;
      }
    } else if (c === "}" || c === "]") {
      depth--;
      out.push(nl() + c);
      i++;
    } else if (c === ",") {
      out.push("," + nl());
      i++;
    } else if (c === ":") {
      out.push(pretty ? ": " : ":");
      i++;
    } else {
      let j = i;
      while (j < input.length && !/[\s,:\]}]/.test(input[j])) j++;
      out.push(input.slice(i, j));
      i = j;
    }
  }
  return out.join("");
}

export function formatJson(input: string, mode: "pretty" | "minify"): string {
  try {
    JSON.parse(input);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid JSON.";
    throw new ProcessorError(`This isn't valid JSON: ${message}`);
  }
  return relayoutJson(input, mode === "pretty");
}

export function validateJson(input: string): { valid: boolean; error?: string } {
  try {
    JSON.parse(input);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : "Invalid JSON." };
  }
}

export function formatXml(input: string, mode: "pretty" | "minify"): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ProcessorError("Paste some XML first.");

  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, "application/xml");
  const errorNode = doc.querySelector("parsererror");
  if (errorNode) {
    throw new ProcessorError("This isn't valid XML.");
  }

  // Keep the <?xml … ?> declaration (version/encoding) — the parsed tree doesn't carry it.
  const declaration = trimmed.match(/^<\?xml[^>]*\?>/)?.[0];
  const pretty = mode === "pretty";
  const parts: string[] = [];
  for (const node of Array.from(doc.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue;
    parts.push(serializeXml(node, 0, pretty));
  }
  const body = parts.join(pretty ? "\n" : "");
  return declaration ? `${declaration}${pretty ? "\n" : ""}${body}` : body;
}

const escapeXmlText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeXmlAttr = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");

/** Serializes any node so the output is well-formed and lossless: text/attribute escaping, CDATA, comments,
 * processing instructions, the DOCTYPE and mixed content (text next to elements) are all kept. */
function serializeXml(node: Node, depth: number, pretty: boolean): string {
  const indent = pretty ? "  ".repeat(depth) : "";
  switch (node.nodeType) {
    case Node.TEXT_NODE:
      return escapeXmlText(node.textContent ?? "");
    case Node.CDATA_SECTION_NODE:
      return `<![CDATA[${node.textContent ?? ""}]]>`;
    case Node.COMMENT_NODE:
      return `${indent}<!--${node.textContent ?? ""}-->`;
    case Node.PROCESSING_INSTRUCTION_NODE: {
      const pi = node as ProcessingInstruction;
      return `${indent}<?${pi.target}${pi.data ? " " + pi.data : ""}?>`;
    }
    case Node.DOCUMENT_TYPE_NODE: {
      const dt = node as DocumentType;
      const ids = dt.publicId ? ` PUBLIC "${dt.publicId}" "${dt.systemId}"` : dt.systemId ? ` SYSTEM "${dt.systemId}"` : "";
      return `<!DOCTYPE ${dt.name}${ids}>`;
    }
    case Node.ELEMENT_NODE:
      break;
    default:
      return "";
  }
  const el = node as Element;
  const attrs = Array.from(el.attributes)
    .map((a) => ` ${a.name}="${escapeXmlAttr(a.value)}"`)
    .join("");
  const open = `<${el.tagName}${attrs}`;
  const kids = Array.from(el.childNodes);
  if (kids.length === 0) return `${indent}${open}/>`;

  const hasStructure = kids.some((n) => n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.COMMENT_NODE || n.nodeType === Node.PROCESSING_INSTRUCTION_NODE);
  const hasRealText = kids.some((n) => (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) || n.nodeType === Node.CDATA_SECTION_NODE);

  if (!hasStructure) {
    // Only text / CDATA: keep it inline; pretty mode trims padding whitespace around plain text.
    const inner = kids
      .map((n) => (n.nodeType === Node.TEXT_NODE && pretty ? escapeXmlText((n.textContent ?? "").trim()) : serializeXml(n, 0, false)))
      .join("");
    return `${indent}${open}>${inner}</${el.tagName}>`;
  }
  if (hasRealText) {
    // Mixed content: whitespace is significant, so the children are written exactly as they are.
    return `${indent}${open}>${kids.map((n) => serializeXml(n, 0, false)).join("")}</${el.tagName}>`;
  }
  const inner = kids.filter((n) => n.nodeType !== Node.TEXT_NODE).map((n) => serializeXml(n, depth + 1, pretty));
  return pretty ? `${indent}${open}>\n${inner.join("\n")}\n${indent}</${el.tagName}>` : `${open}>${inner.join("")}</${el.tagName}>`;
}

export interface CsvParseOptions {
  delimiter: string;
}

/** Minimal RFC 4180 CSV parser: handles quoted fields, escaped quotes, and CRLF/LF. */
export function parseCsv(input: string, options: CsvParseOptions = { delimiter: "," }): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const delimiter = options.delimiter;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new ProcessorError(`A quoted value in this CSV is never closed (it starts on row ${rows.length + 1}). Check for a missing closing quote.`);
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function csvEscapeField(field: string, delimiter: string): string {
  if (field.includes(delimiter) || field.includes('"') || field.includes("\n") || field.includes("\r")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/** Picks the delimiter from the header line: comma, semicolon (common in European Excel exports), tab or pipe. */
export function detectCsvDelimiter(input: string): string {
  const firstLine = input.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  // Ignore anything inside quotes when counting.
  const bare = firstLine.replace(/"[^"]*"/g, "");
  const counts = [",", ";", "	", "|"].map((d) => [d, bare.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ",";
}

export function csvToJson(input: string): string {
  const rows = parseCsv(input, { delimiter: detectCsvDelimiter(input) });
  if (rows.length === 0) throw new ProcessorError("Paste some CSV data first.");
  const [header, ...dataRows] = rows;
  const objects = dataRows.map((row) => {
    const obj: Record<string, string> = {};
    header.forEach((key, i) => {
      obj[key || `column_${i + 1}`] = row[i] ?? "";
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

export function jsonToCsv(input: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new ProcessorError("This isn't valid JSON.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((row) => row === null || typeof row !== "object" || Array.isArray(row))
  ) {
    throw new ProcessorError("Provide a JSON array of objects, e.g. [{\"name\":\"Ada\"}].");
  }

  const rows = parsed as Record<string, unknown>[];
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  );

  const lines = [columns.map((c) => csvEscapeField(c, ",")).join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((col) => {
          const value = row[col];
          // Nested objects/arrays go into the cell as JSON text (String() would give "[object Object]").
          const text = value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
          return csvEscapeField(text, ",");
        })
        .join(",")
    );
  }
  return lines.join("\n");
}

/** Words for camelCase / kebab-case / snake_case: runs of letters or digits in any script (so "café" stays
 * "café"), with apostrophes inside a word dropped rather than treated as separators ("it's" -> "its"). */
function identifierWords(input: string): string[] {
  return input.replace(/(\p{L})['’](\p{L})/gu, "$1$2").match(/[\p{L}\p{N}]+/gu) ?? [];
}

export type TextCase = "upper" | "lower" | "title" | "sentence" | "camel" | "kebab" | "snake";

export function convertTextCase(input: string, targetCase: TextCase): string {
  switch (targetCase) {
    case "upper":
      return input.toUpperCase();
    case "lower":
      return input.toLowerCase();
    case "title":
      // Whitespace-separated words; the first *letter* of each (any script) is capitalized.
      return input.replace(/\S+/gu, (word) => word.toLowerCase().replace(/\p{L}/u, (letter) => letter.toUpperCase()));
    case "sentence":
      return input.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s*\p{L})/gu, (match) => match.toUpperCase());
    case "camel": {
      const words = identifierWords(input);
      return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("");
    }
    case "kebab":
      return identifierWords(input).map((w) => w.toLowerCase()).join("-");
    case "snake":
      return identifierWords(input).map((w) => w.toLowerCase()).join("_");
    default:
      return input;
  }
}

export interface WordCountStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  readingTimeMinutes: number;
}

export function countWords(input: string): WordCountStats {
  const words = input.trim().length === 0 ? [] : input.trim().split(/\s+/);
  const sentences = input.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const paragraphs = input.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return {
    characters: input.length,
    charactersNoSpaces: input.replace(/\s/g, "").length,
    words: words.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length || (input.trim() ? 1 : 0),
    readingTimeMinutes: Math.max(1, Math.round(words.length / 200)),
  };
}

export function generateUuidV4(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type HashAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

export async function hashText(input: string, algorithm: HashAlgorithm): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest(algorithm, data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashFile(file: File, algorithm: HashAlgorithm): Promise<string> {
  const data = await file.arrayBuffer();
  const digest = await crypto.subtle.digest(algorithm, data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function base64Encode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export function base64Decode(input: string): string {
  try {
    const binary = atob(input.trim());
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    throw new ProcessorError("This isn't valid Base64 text.");
  }
}

export function urlEncode(input: string): string {
  return encodeURIComponent(input);
}

export function urlDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    throw new ProcessorError("This isn't validly encoded URL text.");
  }
}

export interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
}

/** Line-level LCP-based diff. Good enough for text comparison without pulling in a diff library. */
export function diffLines(original: string, changed: string): DiffLine[] {
  const a = original.split("\n");
  const b = changed.split("\n");
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      result.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: "removed", text: a[i] });
      i++;
    } else {
      result.push({ type: "added", text: b[j] });
      j++;
    }
  }
  while (i < m) result.push({ type: "removed", text: a[i++] });
  while (j < n) result.push({ type: "added", text: b[j++] });

  return result;
}
