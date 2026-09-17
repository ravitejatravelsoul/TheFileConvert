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
      { type: "listitem", ordered: false, text: "one" },
      { type: "listitem", ordered: false, text: "two" },
      { type: "listitem", ordered: true, text: "first" },
      { type: "listitem", ordered: true, text: "second" },
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
