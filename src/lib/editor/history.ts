/**
 * Bounded undo/redo history over immutable state snapshots.
 *
 * Snapshot-based rather than command/delta-based: the editor's state (pages + objects)
 * is small (a handful of objects, not thousands), so keeping full snapshots is simple,
 * easy to reason about, and easy to test, at a memory cost that's negligible for this
 * use case. Capped at MAX_HISTORY entries so a very long editing session can't grow
 * without bound.
 */

const MAX_HISTORY = 50;

export class EditorHistory<T> {
  private past: T[] = [];
  private present: T;
  private future: T[] = [];

  constructor(initial: T) {
    this.present = initial;
  }

  get current(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Records a new state as the current one, clearing any redo stack. */
  push(next: T): void {
    this.past.push(this.present);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.present = next;
    this.future = [];
  }

  undo(): T {
    if (this.past.length === 0) return this.present;
    const previous = this.past.pop()!;
    this.future.unshift(this.present);
    this.present = previous;
    return this.present;
  }

  redo(): T {
    if (this.future.length === 0) return this.present;
    const next = this.future.shift()!;
    this.past.push(this.present);
    this.present = next;
    return this.present;
  }
}
