import { describe, expect, it } from "vitest";
import { setPendingFiles, takePendingFiles } from "./file-handoff";

const file = (n: string) => new File(["x"], n);

describe("file handoff", () => {
  it("hands the files over exactly once", () => {
    setPendingFiles([file("a.pdf")]);
    expect(takePendingFiles().map((f) => f.name)).toEqual(["a.pdf"]);
    expect(takePendingFiles()).toEqual([]);
  });

  it("does not hand over a stale file", () => {
    setPendingFiles([file("old.pdf")]);
    expect(takePendingFiles(Date.now() + 61_000)).toEqual([]);
  });

  it("clears when set with nothing", () => {
    setPendingFiles([file("a.pdf")]);
    setPendingFiles([]);
    expect(takePendingFiles()).toEqual([]);
  });
});
