"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Moves `key` to `toIndex`, returning a new array (pure — unit tested). */
export function moveKey<T>(items: T[], keyOf: (item: T) => string, key: string, toIndex: number): T[] {
  const from = items.findIndex((i) => keyOf(i) === key);
  if (from === -1) return items;
  const to = Math.max(0, Math.min(items.length - 1, toIndex));
  if (from === to) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The key of the `[data-sort-key]` element under a point inside `container`, if any. */
function keyAt(container: HTMLElement, x: number, y: number): string | null {
  for (const node of container.querySelectorAll<HTMLElement>("[data-sort-key]")) {
    const r = node.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return node.dataset.sortKey ?? null;
  }
  return null;
}

/**
 * Pointer-based drag-to-reorder for lists and grids — one code path for mouse, pen and touch
 * (HTML5 drag-and-drop doesn't fire on touch screens). Items reorder live under the pointer.
 *
 * Usage: put `ref={setContainer}` on the list, `data-sort-key={key}` on each item, and call
 * `start(key, event, fromHandle)` from `onPointerDown`. A mouse can grab the whole card; touch
 * only starts from the handle so the page still scrolls.
 */
export function useReorder<T>(items: T[], setItems: (next: T[]) => void, keyOf: (item: T) => string) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const container = useRef<HTMLElement | null>(null);
  const latest = useRef({ items, setItems, keyOf });
  useEffect(() => {
    latest.current = { items, setItems, keyOf };
  });

  const drag = useRef<{ key: string; pointerId: number } | null>(null);
  const listeners = useRef<{ move: (e: PointerEvent) => void; end: (e: PointerEvent) => void } | null>(null);

  const stop = useCallback(() => {
    const l = listeners.current;
    if (l) {
      window.removeEventListener("pointermove", l.move);
      window.removeEventListener("pointerup", l.end);
      window.removeEventListener("pointercancel", l.end);
    }
    listeners.current = null;
    drag.current = null;
    setDragKey(null);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    (key: string, e: React.PointerEvent, fromHandle: boolean) => {
      if (e.button !== 0) return;
      if (e.pointerType === "touch" && !fromHandle) return;
      if (!fromHandle && (e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
      e.preventDefault();
      if (fromHandle) e.stopPropagation();
      stop();
      drag.current = { key, pointerId: e.pointerId };
      setDragKey(key);
      const move = (ev: PointerEvent) => {
        const d = drag.current;
        if (!d || ev.pointerId !== d.pointerId || !container.current) return;
        ev.preventDefault();
        const over = keyAt(container.current, ev.clientX, ev.clientY);
        if (!over || over === d.key) return;
        const { items: current, setItems: set, keyOf: k } = latest.current;
        const next = moveKey(current, k, d.key, current.findIndex((i) => k(i) === over));
        // Keep our copy current until React re-renders, so fast moves don't reorder a stale list.
        latest.current = { ...latest.current, items: next };
        set(next);
      };
      const end = (ev: PointerEvent) => {
        if (drag.current && ev.pointerId === drag.current.pointerId) stop();
      };
      listeners.current = { move, end };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [stop]
  );

  /** Keyboard/button alternative to dragging: move one step earlier (-1) or later (+1). */
  const move = useCallback((key: string, delta: number) => {
    const { items: current, setItems: set, keyOf: k } = latest.current;
    set(moveKey(current, k, key, current.findIndex((i) => k(i) === key) + delta));
  }, []);

  const setContainer = useCallback((el: HTMLElement | null) => {
    container.current = el;
  }, []);

  return { setContainer, dragKey, start, move };
}
