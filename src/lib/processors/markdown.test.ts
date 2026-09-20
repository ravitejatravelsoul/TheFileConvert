import { describe, expect, it } from "vitest";
import { parseMarkdown, markdownToHtmlBody } from "./markdown";

describe("parseMarkdown", () => {
  it("parses headings by level", () => {
    const blocks = parseMarkdown("# Title\n## Subtitle");
    expect(blocks).toEqual([
      { type: "heading", level: 1, text: "Title" },
      { type: "heading", level: 2, text: "Subtitle" },
    ]);
  });

  it("parses paragraphs", () => {
    const blocks = parseMarkdown("Hello there\nstill one paragraph");
    expect(blocks).toEqual([{ type: "paragraph", text: "Hello there still one paragraph" }]);
  });

  it("parses unordered and ordered list items", () => {
    const blocks = parseMarkdown("- one\n- two\n\n1. first\n2. second");
    expect(blocks).toEqual([
      { type: "listitem", ordered: false, text: "one", depth: 0, number: undefined },
      { type: "listitem", ordered: false, text: "two", depth: 0, number: undefined },
      { type: "listitem", ordered: true, text: "first", depth: 0, number: 1 },
      { type: "listitem", ordered: true, text: "second", depth: 0, number: 2 },
    ]);
  });

  it("parses fenced code blocks verbatim", () => {
    const blocks = parseMarkdown("```\nconst x = 1;\n```");
    expect(blocks).toEqual([{ type: "code", text: "const x = 1;" }]);
  });

  it("parses blockquotes", () => {
    const blocks = parseMarkdown("> quoted text");
    expect(blocks).toEqual([{ type: "quote", text: "quoted text" }]);
  });

  it("parses horizontal rules", () => {
    expect(parseMarkdown("---")).toEqual([{ type: "hr" }]);
  });
});

describe("markdownToHtmlBody", () => {
  it("renders headings", () => {
    expect(markdownToHtmlBody("# Hello")).toBe("<h1>Hello</h1>");
  });

  it("renders bold and italic spans", () => {
    const html = markdownToHtmlBody("This is **bold** and *italic*.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("escapes HTML in the source to prevent injection", () => {
    const html = markdownToHtmlBody("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("groups consecutive list items into a single list", () => {
    const html = markdownToHtmlBody("- one\n- two");
    expect(html).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("renders links safely", () => {
    const html = markdownToHtmlBody("[click here](https://example.com)");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain("click here</a>");
  });
});

describe("markdown: product-acceptance regressions", () => {
  it("does not emit links that run script (javascript:, data:, vbscript:, obfuscated)", () => {
    for (const evil of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:x", "java\tscript:alert(1)"]) {
      const html = markdownToHtmlBody(`[click](${evil})`);
      expect(html).not.toMatch(/href=/i);
      expect(html).toContain("click");
    }
    expect(markdownToHtmlBody("[a](https://x.test/?a=1&b=2)")).toContain('href="https://x.test/?a=1&amp;b=2"');
    expect(markdownToHtmlBody("[a](/relative/page)")).toContain('href="/relative/page"');
    expect(markdownToHtmlBody("[a](mailto:me@example.com)")).toContain("mailto:me@example.com");
  });

  it("leaves underscores inside identifiers alone but still supports _emphasis_", () => {
    const html = markdownToHtmlBody("use my_var_name and call _this_ one");
    expect(html).toContain("my_var_name");
    expect(html).toContain("<em>this</em>");
  });

  it("does not apply emphasis inside code spans", () => {
    expect(markdownToHtmlBody("`a*b*c` and **x**")).toBe("<p><code>a*b*c</code> and <strong>x</strong></p>");
  });

  it("renders pipe tables", () => {
    const html = markdownToHtmlBody("| Name | Qty |\n| ---- | --- |\n| Apple | 3 |\n| Pear | 5 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("<td>Pear</td><td>5</td>");
  });

  it("nests indented list items and keeps ordered numbering in the parse", () => {
    const html = markdownToHtmlBody("- a\n  - b\n  - c\n- d");
    expect(html).toBe("<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>");
    const blocks = parseMarkdown("3. three\n4. four");
    expect(blocks[0]).toMatchObject({ ordered: true, number: 3 });
  });
});

it("markdown table separator rows may use a single hyphen per column", () => {
  expect(markdownToHtmlBody("| A | B |\n| - | - |\n| 1 | 2 |")).toContain("<table>");
  expect(markdownToHtmlBody("a | b\n:-: | --:\n1 | 2")).toContain("<table>");
});
