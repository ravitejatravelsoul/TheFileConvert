import { expect, type Locator, type Page } from "@playwright/test";

/**
 * "Click once, then hands off." A conversion must finish by itself — it may never wait for another click, a key, a
 * mouse move, a focus change or a repaint.
 *
 * `window.__starve(true)` makes the browser stop delivering animation frames until the user interacts with the page:
 * what a tab behind another tab, or a covered/minimised window, gets. It is the condition that once left PDF → Word
 * at "Recognizing page 1 of 1…" until the user clicked. `window.__interacted` counts genuine (trusted) input.
 * Call `installHandsOff` before the page loads.
 */
export async function installHandsOff(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const real = window.requestAnimationFrame.bind(window);
    const queue: FrameRequestCallback[] = [];
    let starved = false;
    w.__starve = (on: boolean) => {
      starved = on;
    };
    w.__interacted = 0;
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      if (!starved) return real(cb);
      queue.push(cb);
      return queue.length;
    };
    const release = (e: Event) => {
      if (!e.isTrusted) return; // the one action under test is sent as an untrusted event
      (w.__interacted as number)++;
      if (!starved) return;
      starved = false;
      for (const cb of queue.splice(0)) real(cb);
    };
    for (const t of ["pointerdown", "mousedown", "click", "keydown", "touchstart"]) addEventListener(t, release, { capture: true });
  });
}

/** Presses the primary action once, with the window starved of animation frames from that moment on. */
export async function pressOnceThenHandsOff(page: Page, button: Locator, { starved = true } = {}) {
  await button.waitFor();
  await page.evaluate((on) => {
    const w = window as unknown as { __starve: (on: boolean) => void; __interacted: number; __interactedAtPress: number };
    w.__interactedAtPress = w.__interacted; // set-up clicks (choosing an option) are not counted; what follows is
    if (on) w.__starve(true);
  }, starved);
  await button.dispatchEvent("click");
}

/** After the result: nothing the user did was needed. */
export async function expectNoInteractionAfter(page: Page) {
  const after = await page.evaluate(() => {
    const w = window as unknown as { __interacted: number; __interactedAtPress: number };
    return w.__interacted - w.__interactedAtPress;
  });
  expect(after, "genuine input after the one click").toBe(0);
}
