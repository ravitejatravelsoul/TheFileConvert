export class ProcessorError extends Error {}

export type MdBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | {
      type: "listitem";
      ordered: boolean;
      text: string;
      /** Nesting level: 0 = top level. */
      depth: number;
      /** The number written in the source, for ordered items. */
      number?: number;
    }
  | { type: "code"; text: string }
  | { type: "quote"; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "hr" };

const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Parses a practical subset of Markdown (headings, bold/italic/code spans,
 * links, nested lists, blockquotes, fenced code, hr, pipe tables, paragraphs).
 * This is not a full CommonMark implementation, but it covers everyday documents
 * without pulling in a large dependency.
 */
export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (/^```/.test(line.trim())) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: "code", text: codeLines.join("\n") });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", text: quoteLines.join(" ") });
      continue;
    }

    // Pipe table: a header row, a --- separator row, then body rows.
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("|") && TABLE_SEPARATOR.test(lines[i + 1])) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        const row = splitTableRow(lines[i]);
        while (row.length < header.length) row.push("");
        rows.push(row.slice(0, header.length));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const indent = listMatch[1].replace(/\t/g, "    ").length;
      const ordered = /^\d+\./.test(listMatch[2]);
      blocks.push({
        type: "listitem",
        ordered,
        text: listMatch[3].trim(),
        depth: Math.min(4, Math.floor(indent / 2)),
        number: ordered ? parseInt(listMatch[2], 10) : undefined,
      });
      i++;
      continue;
    }

    const paragraphLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^```/.test(lines[i].trim())
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ").trim() });
  }

  return blocks;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only web/mail/phone links and same-page or relative ones are kept; `javascript:`, `data:` and the like
 * are dropped so the HTML we hand back can't carry a script-running link. */
export function safeHref(href: string): string | null {
  const decoded = href.trim().replace(/&amp;/g, "&");
  // Strip characters browsers ignore inside a scheme ("java\tscript:").
  const compact = [...decoded].filter((ch) => { const c = ch.charCodeAt(0); return c > 32 && !(c >= 127 && c <= 159); }).join("");
  const scheme = compact.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (scheme) {
    return ["http", "https", "mailto", "tel"].includes(scheme[1].toLowerCase()) ? href.trim() : null;
  }
  return href.trim();
}

/** Renders escaped inline markdown spans (bold/italic/code/links) to safe HTML. */
function renderInlineHtml(text: string): string {
  let escaped = escapeHtml(text);
  // Code spans first, and protect their contents from the emphasis rules below.
  const codeSpans: string[] = [];
  escaped = escaped.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `@@MDCODE${codeSpans.length - 1}@@`;
  });
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Underscore emphasis only counts at word edges: snake_case_names must stay as written.
  escaped = escaped.replace(/(^|[^\p{L}\p{N}_])__([^_]+)__(?![\p{L}\p{N}_])/gu, "$1<strong>$2</strong>");
  escaped = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  escaped = escaped.replace(/(^|[^\p{L}\p{N}_])_([^_]+)_(?![\p{L}\p{N}_])/gu, "$1<em>$2</em>");
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
    const safe = safeHref(href);
    return safe === null ? label : `<a href="${safe.replace(/"/g, "&quot;")}" rel="noopener noreferrer">${label}</a>`;
  });
  return escaped.replace(/@@MDCODE([0-9]+)@@/g, (_m, n: string) => codeSpans[Number(n)]);
}

/** Same rules as the HTML renderer, but producing plain text (for PDF output): markers removed, link text kept. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^\p{L}\p{N}_])__([^_]+)__(?![\p{L}\p{N}_])/gu, "$1$2")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(^|[^\p{L}\p{N}_])_([^_]+)_(?![\p{L}\p{N}_])/gu, "$1$2")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

interface OpenList {
  ordered: boolean;
  depth: number;
}

export function markdownToHtmlBody(source: string): string {
  const blocks = parseMarkdown(source);
  const html: string[] = [];
  // A stack of open <ul>/<ol> elements so nested items render as nested lists.
  let stack: OpenList[] = [];
  let itemOpen: boolean[] = [];
  // List markup is assembled without newlines, then emitted as one piece.
  let listHtml: string[] = [];
  const flushList = () => {
    if (listHtml.length > 0) html.push(listHtml.join(""));
    listHtml = [];
  };

  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      const top = stack.pop()!;
      if (itemOpen.pop()) listHtml.push("</li>");
      listHtml.push(top.ordered ? "</ol>" : "</ul>");
    }
  };

  for (const block of blocks) {
    if (block.type === "listitem") {
      const wanted = block.depth + 1;
      if (stack.length > wanted) closeTo(wanted);
      if (stack.length === wanted && stack[wanted - 1].ordered !== block.ordered) closeTo(wanted - 1);
      if (stack.length === wanted) {
        if (itemOpen[wanted - 1]) listHtml.push("</li>");
        itemOpen[wanted - 1] = false;
      }
      while (stack.length < wanted) {
        const ordered = stack.length === wanted - 1 ? block.ordered : false;
        listHtml.push(ordered ? "<ol>" : "<ul>");
        stack.push({ ordered, depth: stack.length });
        itemOpen.push(false);
      }
      listHtml.push(`<li>${renderInlineHtml(block.text)}`);
      itemOpen[stack.length - 1] = true;
      continue;
    }
    closeTo(0);
    flushList();
    stack = [];
    itemOpen = [];

    switch (block.type) {
      case "heading":
        html.push(`<h${block.level}>${renderInlineHtml(block.text)}</h${block.level}>`);
        break;
      case "paragraph":
        html.push(`<p>${renderInlineHtml(block.text)}</p>`);
        break;
      case "quote":
        html.push(`<blockquote>${renderInlineHtml(block.text)}</blockquote>`);
        break;
      case "code":
        html.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`);
        break;
      case "table":
        html.push(
          `<table><thead><tr>${block.header.map((c) => `<th>${renderInlineHtml(c)}</th>`).join("")}</tr></thead><tbody>${block.rows
            .map((r) => `<tr>${r.map((c) => `<td>${renderInlineHtml(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`
        );
        break;
      case "hr":
        html.push("<hr />");
        break;
    }
  }
  closeTo(0);
  flushList();

  return html.join("\n");
}

export function markdownToHtmlDocument(source: string, title: string): string {
  const body = markdownToHtmlBody(source);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 760px; margin: 40px auto; padding: 0 20px; overflow-wrap: anywhere; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { background: #f4f4f5; padding: 12px 16px; border-radius: 8px; overflow-x: auto; }
  code { background: #f4f4f5; padding: 2px 5px; border-radius: 4px; }
  blockquote { margin: 0; padding-left: 16px; border-left: 3px solid #d4d4d8; color: #52525b; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #d4d4d8; padding: 6px 12px; text-align: left; }
  th { background: #f4f4f5; }
  a { color: #2563eb; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
