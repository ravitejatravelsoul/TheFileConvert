/**
 * Turns a target-size search result into what the user is shown and given. The rules keep the
 * result honest: never hand back a file bigger than the original as if it were "compressed", and
 * never call a result successful unless it is at or under the target.
 */
export type OutcomeKind =
  /** At or under the target. */
  | "reached"
  /** The original already fits and nothing smaller came out — the original is returned untouched. */
  | "already-small"
  /** Target not reachable; this is the smallest safe result, and it is smaller than the original. */
  | "closest"
  /** Target not reachable and nothing tried was smaller than the original. */
  | "no-gain";

export interface Outcome {
  kind: OutcomeKind;
  blob: Blob;
  bytes: number;
}

export function decideOutcome(original: Blob, targetBytes: number, result: { blob: Blob; newBytes: number; targetAchieved: boolean }): Outcome {
  const fitsAlready = original.size <= targetBytes;
  if (result.newBytes >= original.size && fitsAlready) {
    return { kind: "already-small", blob: original, bytes: original.size };
  }
  if (result.targetAchieved && result.newBytes <= targetBytes) {
    return { kind: "reached", blob: result.blob, bytes: result.newBytes };
  }
  if (result.newBytes >= original.size) {
    return { kind: "no-gain", blob: original, bytes: original.size };
  }
  return { kind: "closest", blob: result.blob, bytes: result.newBytes };
}
