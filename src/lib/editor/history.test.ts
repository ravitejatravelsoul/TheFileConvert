import { describe, expect, it } from "vitest";
import { EditorHistory } from "./history";

describe("EditorHistory", () => {
  it("starts with the initial state and no undo/redo available", () => {
    const h = new EditorHistory(0);
    expect(h.current).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("push updates current and enables undo", () => {
    const h = new EditorHistory(0);
    h.push(1);
    expect(h.current).toBe(1);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it("undo reverts to the previous state and enables redo", () => {
    const h = new EditorHistory(0);
    h.push(1);
    h.push(2);
    expect(h.undo()).toBe(1);
    expect(h.current).toBe(1);
    expect(h.canRedo).toBe(true);
  });

  it("redo re-applies an undone state", () => {
    const h = new EditorHistory(0);
    h.push(1);
    h.push(2);
    h.undo();
    expect(h.redo()).toBe(2);
    expect(h.current).toBe(2);
    expect(h.canRedo).toBe(false);
  });

  it("a new push after undo discards the redo stack", () => {
    const h = new EditorHistory(0);
    h.push(1);
    h.push(2);
    h.undo(); // back to 1, redo -> 2 available
    h.push(3); // branches history
    expect(h.canRedo).toBe(false);
    expect(h.current).toBe(3);
    expect(h.undo()).toBe(1);
  });

  it("undo at the start of history is a no-op", () => {
    const h = new EditorHistory(0);
    expect(h.undo()).toBe(0);
    expect(h.current).toBe(0);
  });

  it("redo with nothing to redo is a no-op", () => {
    const h = new EditorHistory(0);
    h.push(1);
    expect(h.redo()).toBe(1);
  });

  it("caps history length so memory doesn't grow unbounded", () => {
    const h = new EditorHistory(0);
    for (let i = 1; i <= 100; i++) h.push(i);
    expect(h.current).toBe(100);
    let undoCount = 0;
    while (h.canUndo) {
      h.undo();
      undoCount++;
    }
    expect(undoCount).toBeLessThanOrEqual(50);
    expect(undoCount).toBeGreaterThan(0);
  });

  it("works with object snapshots (typical editor state shape)", () => {
    interface State { objects: string[] }
    const h = new EditorHistory<State>({ objects: [] });
    h.push({ objects: ["a"] });
    h.push({ objects: ["a", "b"] });
    expect(h.current.objects).toEqual(["a", "b"]);
    expect(h.undo().objects).toEqual(["a"]);
    expect(h.undo().objects).toEqual([]);
    expect(h.canUndo).toBe(false);
  });
});

describe("EditorHistory coalescing", () => {
  it("collapses a burst of same-key pushes into a single undo step", () => {
    const h = new EditorHistory<string>("");
    h.push("H", "text:1", 1000);
    h.push("He", "text:1", 1100);
    h.push("Hel", "text:1", 1200);
    expect(h.current).toBe("Hel");
    expect(h.undo()).toBe(""); // one undo returns to before the whole burst
    expect(h.canUndo).toBe(false);
  });

  it("does not coalesce across different keys or after the time window", () => {
    const h = new EditorHistory<string>("");
    h.push("a", "k1", 1000);
    h.push("b", "k2", 1100);
    h.push("c", "k2", 1100 + 5000); // same key but too long after
    expect(h.undo()).toBe("b");
    expect(h.undo()).toBe("a");
  });

  it("never coalesces an un-keyed push, and undo/redo break a coalescing run", () => {
    const h = new EditorHistory<string>("0");
    h.push("1", "k", 1000);
    h.undo();
    h.push("2", "k", 1050); // right after an undo: must be its own step
    expect(h.undo()).toBe("0");
    h.push("3", undefined, 1100);
    h.push("4", undefined, 1110);
    expect(h.undo()).toBe("3");
  });
});

describe("EditorHistory.breakCoalescing", () => {
  it("makes the next same-key edit its own undo step", () => {
    const h = new EditorHistory<string>("");
    h.push("a", "k", 1000);
    h.breakCoalescing();
    h.push("ab", "k", 1100);
    expect(h.undo()).toBe("a");
    expect(h.undo()).toBe("");
  });
});
