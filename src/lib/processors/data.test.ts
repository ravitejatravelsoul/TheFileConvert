import { describe, expect, it } from "vitest";
import {
  formatJson,
  validateJson,
  formatXml,
  parseCsv,
  csvToJson,
  jsonToCsv,
  convertTextCase,
  countWords,
  generateUuidV4,
  hashText,
  base64Encode,
  base64Decode,
  urlEncode,
  urlDecode,
  diffLines,
  ProcessorError,
} from "./data";

describe("formatJson", () => {
  it("pretty-prints valid JSON", () => {
    expect(formatJson('{"a":1}', "pretty")).toBe('{\n  "a": 1\n}');
  });

  it("minifies valid JSON", () => {
    expect(formatJson('{ "a" : 1 }', "minify")).toBe('{"a":1}');
  });

  it("throws a friendly error on invalid JSON", () => {
    expect(() => formatJson("{not json", "pretty")).toThrow(ProcessorError);
  });
});

describe("validateJson", () => {
  it("reports valid JSON", () => {
    expect(validateJson("[1,2,3]").valid).toBe(true);
  });

  it("reports invalid JSON with an error message", () => {
    const result = validateJson("{bad");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("formatXml", () => {
  it("pretty-prints simple XML", () => {
    const result = formatXml("<root><item>value</item></root>", "pretty");
    expect(result).toContain("<root>");
    expect(result).toContain("  <item>value</item>");
  });

  it("minifies XML by collapsing whitespace between tags", () => {
    const result = formatXml("<root>\n  <item>value</item>\n</root>", "minify");
    expect(result).toBe("<root><item>value</item></root>");
  });

  it("throws on malformed XML", () => {
    expect(() => formatXml("<root><unclosed></root>", "pretty")).toThrow(ProcessorError);
  });

  it("throws on empty input", () => {
    expect(() => formatXml("   ", "pretty")).toThrow(ProcessorError);
  });
});

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCsv('name,note\n"Doe, John",hello')).toEqual([
      ["name", "note"],
      ["Doe, John", "hello"],
    ]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCsv('field\n"She said ""hi"""')).toEqual([["field"], ['She said "hi"']]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("csvToJson", () => {
  it("converts CSV rows into an array of objects", () => {
    const result = JSON.parse(csvToJson("name,age\nAda,30\nGrace,32"));
    expect(result).toEqual([
      { name: "Ada", age: "30" },
      { name: "Grace", age: "32" },
    ]);
  });

  it("throws on empty input", () => {
    expect(() => csvToJson("")).toThrow(ProcessorError);
  });
});

describe("jsonToCsv", () => {
  it("converts an array of objects into CSV", () => {
    const result = jsonToCsv('[{"name":"Ada","age":30},{"name":"Grace","age":32}]');
    expect(result).toBe("name,age\nAda,30\nGrace,32");
  });

  it("fills missing columns with empty strings", () => {
    const result = jsonToCsv('[{"a":1},{"a":2,"b":3}]');
    expect(result).toBe("a,b\n1,\n2,3");
  });

  it("throws when input is not a JSON array of objects", () => {
    expect(() => jsonToCsv('{"a":1}')).toThrow(ProcessorError);
    expect(() => jsonToCsv("not json")).toThrow(ProcessorError);
  });
});

describe("convertTextCase", () => {
  it("converts to uppercase and lowercase", () => {
    expect(convertTextCase("Hello World", "upper")).toBe("HELLO WORLD");
    expect(convertTextCase("Hello World", "lower")).toBe("hello world");
  });

  it("converts to title case", () => {
    expect(convertTextCase("the quick brown fox", "title")).toBe("The Quick Brown Fox");
  });

  it("converts to camelCase", () => {
    expect(convertTextCase("convert this text", "camel")).toBe("convertThisText");
  });

  it("converts to kebab-case and snake_case", () => {
    expect(convertTextCase("Convert This", "kebab")).toBe("convert-this");
    expect(convertTextCase("Convert This", "snake")).toBe("convert_this");
  });
});

describe("countWords", () => {
  it("counts words and characters", () => {
    const stats = countWords("Hello world");
    expect(stats.words).toBe(2);
    expect(stats.characters).toBe(11);
  });

  it("returns zero counts for empty input", () => {
    const stats = countWords("");
    expect(stats.words).toBe(0);
    expect(stats.paragraphs).toBe(0);
  });
});

describe("generateUuidV4", () => {
  it("generates well-formed v4 UUIDs", () => {
    const uuid = generateUuidV4();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("generates unique values across calls", () => {
    const values = new Set(Array.from({ length: 20 }, () => generateUuidV4()));
    expect(values.size).toBe(20);
  });
});

describe("hashText", () => {
  it("computes a known SHA-256 hash", async () => {
    const hash = await hashText("hello", "SHA-256");
    expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});

describe("base64Encode / base64Decode", () => {
  it("round-trips text", () => {
    const encoded = base64Encode("Hello, world!");
    expect(encoded).toBe("SGVsbG8sIHdvcmxkIQ==");
    expect(base64Decode(encoded)).toBe("Hello, world!");
  });

  it("throws on invalid base64 during decode", () => {
    expect(() => base64Decode("not base64!@#")).toThrow(ProcessorError);
  });
});

describe("urlEncode / urlDecode", () => {
  it("round-trips text with special characters", () => {
    const encoded = urlEncode("hello world/?");
    expect(urlDecode(encoded)).toBe("hello world/?");
  });
});

describe("diffLines", () => {
  it("marks unchanged lines as same", () => {
    const result = diffLines("a\nb\nc", "a\nb\nc");
    expect(result.every((l) => l.type === "same")).toBe(true);
  });

  it("detects additions and removals", () => {
    const result = diffLines("a\nb", "a\nc");
    expect(result).toContainEqual({ type: "same", text: "a" });
    expect(result).toContainEqual({ type: "removed", text: "b" });
    expect(result).toContainEqual({ type: "added", text: "c" });
  });
});
