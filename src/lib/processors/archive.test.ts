import { describe, expect, it } from "vitest";
import { createZip, inspectZip, extractZip, ProcessorError } from "./archive";

function makeFile(name: string, content: string, type = "text/plain"): File {
  return new File([content], name, { type });
}

describe("createZip", () => {
  it("creates a ZIP blob containing the given files", async () => {
    const files = [makeFile("a.txt", "hello"), makeFile("b.txt", "world")];
    const zipBlob = await createZip(files);
    expect(zipBlob.size).toBeGreaterThan(0);

    const zipFile = new File([zipBlob], "out.zip", { type: "application/zip" });
    const entries = await inspectZip(zipFile);
    const names = entries.filter((e) => !e.isDirectory).map((e) => e.name);
    expect(names.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("de-duplicates identical filenames", async () => {
    const files = [makeFile("dup.txt", "one"), makeFile("dup.txt", "two")];
    const zipBlob = await createZip(files);
    const zipFile = new File([zipBlob], "out.zip");
    const entries = await inspectZip(zipFile);
    const names = entries.map((e) => e.name);
    expect(names).toContain("dup.txt");
    expect(names).toContain("copy-dup.txt");
  });

  it("throws when given no files", async () => {
    await expect(createZip([])).rejects.toThrow(ProcessorError);
  });
});

describe("extractZip round-trip", () => {
  it("extracts the same files that were zipped", async () => {
    const original = [makeFile("one.txt", "content one"), makeFile("two.txt", "content two")];
    const zipBlob = await createZip(original);
    const zipFile = new File([zipBlob], "archive.zip", { type: "application/zip" });

    const extracted = await extractZip(zipFile);
    expect(extracted.map((e) => e.name).sort()).toEqual(["one.txt", "two.txt"]);

    const contents = await Promise.all(extracted.map((e) => e.blob.text()));
    expect(contents.sort()).toEqual(["content one", "content two"]);
  });

  it("throws a friendly error for a non-ZIP file", async () => {
    const badFile = makeFile("not-a-zip.zip", "just plain text");
    await expect(extractZip(badFile)).rejects.toThrow(ProcessorError);
  });
});
