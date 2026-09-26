import { describe, expect, it } from "vitest";
import { formatExact, formatSize, formatTarget, parseTarget, percentSaved, toBytes } from "./size";

describe("size helpers", () => {
  it("uses decimal units for targets", () => {
    expect(toBytes(1, "MB")).toBe(1_000_000);
    expect(toBytes(500, "KB")).toBe(500_000);
    expect(toBytes(2.5, "MB")).toBe(2_500_000);
  });

  it("parses custom targets and rejects nonsense", () => {
    expect(parseTarget("750", "KB")).toBe(750_000);
    expect(parseTarget(" 1,5 ", "MB")).toBe(1_500_000);
    expect(parseTarget(".5", "MB")).toBe(500_000);
    expect(parseTarget("", "KB")).toBeNull();
    expect(parseTarget("0", "KB")).toBeNull();
    expect(parseTarget("-3", "MB")).toBeNull();
    expect(parseTarget("abc", "MB")).toBeNull();
    expect(parseTarget("0.5", "KB")).toBeNull(); // under 1 KB is not a usable target
  });

  it("formats sizes compactly", () => {
    expect(formatSize(812)).toBe("812 B");
    expect(formatSize(3_400)).toBe("3.4 KB");
    expect(formatSize(384_120)).toBe("384 KB");
    expect(formatSize(1_234_567)).toBe("1.23 MB");
    expect(formatSize(1_200_000)).toBe("1.2 MB");
    expect(formatSize(12_345_678)).toBe("12.3 MB");
  });

  it("formats targets the way they were chosen", () => {
    expect(formatTarget(500_000)).toBe("500 KB");
    expect(formatTarget(1_000_000)).toBe("1 MB");
    expect(formatTarget(2_500_000)).toBe("2.5 MB");
  });

  it("formats exact bytes and savings", () => {
    expect(formatExact(3982736)).toBe("3,982,736 bytes");
    expect(percentSaved(1000, 250)).toBe(75);
    expect(percentSaved(1000, 1200)).toBe(0);
  });
});
