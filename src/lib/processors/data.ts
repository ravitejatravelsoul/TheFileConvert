export class ProcessorError extends Error {}

export function formatJson(input: string, mode: "pretty" | "minify"): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid JSON.";
    throw new ProcessorError(`This isn't valid JSON: ${message}`);
  }
  return mode === "pretty" ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
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

  if (mode === "minify") {
    return trimmed.replace(/>\s+</g, "><").trim();
  }

  return prettyPrintXmlNode(doc.documentElement, 0);
}

function prettyPrintXmlNode(node: Element, depth: number): string {
  const indent = "  ".repeat(depth);
  const children = Array.from(node.childNodes).filter(
    (n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim())
  );

  const attrs = Array.from(node.attributes)
    .map((a) => ` ${a.name}="${a.value}"`)
    .join("");

  if (children.length === 0) {
    return `${indent}<${node.tagName}${attrs}/>`;
  }

  if (children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
    return `${indent}<${node.tagName}${attrs}>${children[0].textContent?.trim() ?? ""}</${node.tagName}>`;
  }

  const inner = children
    .filter((n): n is Element => n.nodeType === Node.ELEMENT_NODE)
    .map((el) => prettyPrintXmlNode(el, depth + 1))
    .join("\n");

  return `${indent}<${node.tagName}${attrs}>\n${inner}\n${indent}</${node.tagName}>`;
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

export function csvToJson(input: string): string {
  const rows = parseCsv(input);
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
  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== "object") {
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
          const text = value === undefined || value === null ? "" : String(value);
          return csvEscapeField(text, ",");
        })
        .join(",")
    );
  }
  return lines.join("\n");
}

export type TextCase = "upper" | "lower" | "title" | "sentence" | "camel" | "kebab" | "snake";

export function convertTextCase(input: string, targetCase: TextCase): string {
  switch (targetCase) {
    case "upper":
      return input.toUpperCase();
    case "lower":
      return input.toLowerCase();
    case "title":
      return input.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
    case "sentence":
      return input
        .toLowerCase()
        .replace(/(^\s*\w|[.!?]\s*\w)/g, (match) => match.toUpperCase());
    case "camel": {
      const words = input.match(/[a-zA-Z0-9]+/g) ?? [];
      return words
        .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
        .join("");
    }
    case "kebab":
      return (input.match(/[a-zA-Z0-9]+/g) ?? []).map((w) => w.toLowerCase()).join("-");
    case "snake":
      return (input.match(/[a-zA-Z0-9]+/g) ?? []).map((w) => w.toLowerCase()).join("_");
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
