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

describe("product-acceptance regressions", () => {
  it("jsonToCsv writes nested objects/arrays as JSON text, never [object Object]", () => {
    const csv = jsonToCsv('[{"a":{"b":1},"c":[1,2]}]');
    expect(csv).not.toContain("[object Object]");
    expect(csv.split("\n")[1]).toBe('"{""b"":1}","[1,2]"');
  });

  it("jsonToCsv rejects arrays that contain non-objects instead of crashing or guessing", () => {
    expect(() => jsonToCsv('[{"a":1}, 3]')).toThrow(/array of objects/);
    expect(() => jsonToCsv('[{"a":1}, null]')).toThrow(/array of objects/);
  });

  it("parseCsv reports an unclosed quote instead of swallowing the rest of the file", () => {
    expect(() => parseCsv('a,b\n"unterminated,1\n')).toThrow(/never closed/);
    expect(parseCsv('a,"b, c"\n1,2\n')).toEqual([["a", "b, c"], ["1", "2"]]);
  });

  it("formatXml keeps the XML declaration when pretty-printing", () => {
    const out = formatXml('<?xml version="1.0" encoding="UTF-8"?><a><b>1</b></a>', "pretty");
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<a>')).toBe(true);
  });

  it("case conversions keep accented letters and treat apostrophes inside words as part of the word", () => {
    expect(convertTextCase("café au lait", "kebab")).toBe("café-au-lait");
    expect(convertTextCase("it's a Ünïcode test", "snake")).toBe("its_a_ünïcode_test");
    expect(convertTextCase("it's fine", "camel")).toBe("itsFine");
    expect(convertTextCase("élan vital", "title")).toBe("Élan Vital");
    expect(convertTextCase("élan. vital", "sentence")).toBe("Élan. Vital");
  });
});

describe("formatters never alter the data they format", () => {
  it("formatJson keeps integers beyond 2^53, number spelling, escapes and duplicate keys", () => {
    const src = '{"big":12345678901234567890,"n":1.0,"e":1E5,"s":"\\u00e9\\n","a":1,"a":2,"empty":{},"list":[]}';
    const pretty = formatJson(src, "pretty");
    expect(pretty).toContain('"big": 12345678901234567890');
    expect(pretty).toContain('"n": 1.0');
    expect(pretty).toContain('"e": 1E5');
    expect(pretty).toContain('"s": "\\u00e9\\n"');
    expect(pretty).toContain('"empty": {}');
    expect(pretty).toContain('"list": []');
    expect(formatJson(pretty, "minify")).toBe(src);
  });

  it("formatXml escapes text and attributes, and keeps CDATA, comments, processing instructions and mixed content", () => {
    const src = '<?xml version="1.0"?><!-- top --><r a="x &amp; &quot;y&quot;"><t>Caf&#233; &amp; Co</t><c><![CDATA[<b>raw</b>]]></c><m>hello <b>bold</b> tail</m><?pi data?></r>';
    const pretty = formatXml(src, "pretty");
    const reparsed = new DOMParser().parseFromString(pretty, "application/xml");
    expect(reparsed.querySelector("parsererror")).toBeNull();
    expect(pretty).toContain("<!-- top -->");
    expect(pretty).toContain('a="x &amp; &quot;y&quot;"');
    expect(pretty).toContain("<t>Café &amp; Co</t>");
    expect(pretty).toContain("<![CDATA[<b>raw</b>]]>");
    expect(pretty).toContain("<m>hello <b>bold</b> tail</m>");
    expect(pretty).toContain("<?pi data?>");
    const mini = formatXml(pretty, "minify");
    expect(mini).not.toMatch(/>\s+</);
    expect(new DOMParser().parseFromString(mini, "application/xml").querySelector("parsererror")).toBeNull();
    expect(mini).toContain("<![CDATA[<b>raw</b>]]>");
  });
});

describe("csvToJson delimiter detection", () => {
  it("reads semicolon, tab and pipe separated files, not just commas", () => {
    expect(JSON.parse(csvToJson("a;b\n1;2\n"))).toEqual([{ a: "1", b: "2" }]);
    expect(JSON.parse(csvToJson("a|b\n1|2\n"))).toEqual([{ a: "1", b: "2" }]);
    expect(JSON.parse(csvToJson("a\tb\n1\t2\n"))).toEqual([{ a: "1", b: "2" }]);
    expect(JSON.parse(csvToJson('"x,y",z\n1,2\n'))).toEqual([{ "x,y": "1", z: "2" }]);
  });
});
