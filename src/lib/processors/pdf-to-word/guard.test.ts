import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OcrBudgetExceeded, PdfToWordCancelled, guarded } from "./extract";
import { renderPageOffscreen } from "../pdfjs-utils";

describe("guarded — no awaited step may wait forever", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("passes the value through when the work finishes in time", async () => {
    await expect(guarded(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("passes an error through unchanged", async () => {
    await expect(guarded(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
  });

  it("gives up with OcrBudgetExceeded when the work never settles", async () => {
    const never = new Promise<number>(() => {});
    const result = guarded(never, 5000);
    const caught = result.catch((e) => e);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await caught).toBeInstanceOf(OcrBudgetExceeded);
  });

  it("stops at once when the user cancels, and never settles twice", async () => {
    const controller = new AbortController();
    const caught = guarded(new Promise<number>(() => {}), 60_000, controller.signal).catch((e) => e);
    controller.abort();
    expect(await caught).toBeInstanceOf(PdfToWordCancelled);
    await vi.advanceTimersByTimeAsync(61_000); // the timer was cleared: no late rejection
  });

  it("is already cancelled when the signal was aborted before it started", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(guarded(new Promise<number>(() => {}), 1000, controller.signal)).rejects.toBeInstanceOf(PdfToWordCancelled);
  });

  it("ignores an abort that arrives after the work finished", async () => {
    const controller = new AbortController();
    const p = guarded(Promise.resolve("ok"), 1000, controller.signal);
    await expect(p).resolves.toBe("ok");
    controller.abort();
  });
});

describe("renderPageOffscreen — a conversion's render must not wait for animation frames", () => {
  it("asks pdf.js for the print intent, which is scheduled with promises instead of requestAnimationFrame", async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve() }));
    const page = { render } as unknown as Parameters<typeof renderPageOffscreen>[0];
    const params = { canvasContext: {} as CanvasRenderingContext2D, viewport: {} as never, canvas: {} as HTMLCanvasElement };
    await renderPageOffscreen(page, params);
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ intent: "print", canvasContext: params.canvasContext }));
  });

  it("never schedules an animation frame while rendering", async () => {
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    const page = { render: () => ({ promise: Promise.resolve() }) } as unknown as Parameters<typeof renderPageOffscreen>[0];
    await renderPageOffscreen(page, { canvasContext: {} as CanvasRenderingContext2D, viewport: {} as never, canvas: {} as HTMLCanvasElement });
    expect(raf).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
