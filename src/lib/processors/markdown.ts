export class ProcessorError extends Error {}

export type MdBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "listitem"; ordered: boolean; text: string }
  | { type: "code"; text: string }
  | { type: "quote"; text: string }
  | { type: "hr" };

/**
 * Parses a practical subset of Markdown (headings, bold/italic/code spans,
 * links, lists, blockquotes, fenced code, hr, paragraphs). This is not a
 * full CommonMark implementation, but it covers everyday documents without
 * pulling in a large dependency.
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

    const listMatch = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      blocks.push({
        type: "listitem",
        ordered: /^\d+\./.test(listMatch[1]),
        text: listMatch[2].trim(),
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
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
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

/** Renders escaped inline markdown spans (bold/italic/code/links) to safe HTML. */
function renderInlineHtml(text: string): string {
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  escaped = escaped.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`);
  escaped = escaped.replace(/\*([^*]+)\*|_([^_]+)_/g, (_m, a, b) => `<em>${a ?? b}</em>`);
  escaped = escaped.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label: string, href: string) =>
      `<a href="${href.replace(/"/g, "&quot;")}" rel="noopener noreferrer">${label}</a>`
  );
  return escaped;
}

export function markdownToHtmlBody(source: string): string {
  const blocks = parseMarkdown(source);
  const html: string[] = [];
  let listBuffer: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!listBuffer) return;
    const tag = listBuffer.ordered ? "ol" : "ul";
    html.push(`<${tag}>${listBuffer.items.map((li) => `<li>${li}</li>`).join("")}</${tag}>`);
    listBuffer = null;
  };

  for (const block of blocks) {
    if (block.type === "listitem") {
      if (!listBuffer || listBuffer.ordered !== block.ordered) {
        flushList();
        listBuffer = { ordered: block.ordered, items: [] };
      }
      listBuffer.items.push(renderInlineHtml(block.text));
      continue;
    }
    flushList();

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
      case "hr":
        html.push("<hr />");
        break;
    }
  }
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
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 760px; margin: 40px auto; padding: 0 20px; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { background: #f4f4f5; padding: 12px 16px; border-radius: 8px; overflow-x: auto; }
  code { background: #f4f4f5; padding: 2px 5px; border-radius: 4px; }
  blockquote { margin: 0; padding-left: 16px; border-left: 3px solid #d4d4d8; color: #52525b; }
  a { color: #2563eb; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
