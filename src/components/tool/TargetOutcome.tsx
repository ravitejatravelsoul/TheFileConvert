import type { Outcome } from "@/lib/processors/outcome";
import { formatSize, formatTarget } from "@/lib/size";
import { IconCheck, IconWarning } from "@/components/icons";

/**
 * The headline of a target-size result. Success wording appears only when the file really is at or
 * under the target; anything else reads "Target not reached" with the requested size and the closest
 * safe result, so a result can never look like it met a target it missed.
 */
export function TargetOutcome({ outcome, target, noun }: { outcome: Outcome; target: number; noun: "PDF" | "image" }) {
  const reached = outcome.kind === "reached" || outcome.kind === "already-small";
  return (
    <div className={`relative overflow-hidden px-5 py-6 sm:px-7 ${reached ? "bg-[linear-gradient(135deg,var(--success-soft),#f1faf5)]" : "bg-[linear-gradient(135deg,var(--warning-soft),#fdf7ea)]"}`}>
      <span
        aria-hidden="true"
        className={`mb-3 flex h-10 w-10 items-center justify-center rounded-full text-white shadow-[var(--shadow-2)] ${reached ? "bg-[var(--success)]" : "bg-[var(--warning)]"}`}
      >
        {reached ? <IconCheck className="h-5 w-5" strokeWidth={2.6} /> : <IconWarning className="h-5 w-5" />}
      </span>
      <p role="status" className="text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">
        {outcome.kind === "reached" ? `Done — ${formatSize(outcome.bytes)}` : outcome.kind === "already-small" ? "Already under your target" : "Target not reached"}
      </p>
      {outcome.kind === "reached" && <p className="mt-1 text-[var(--ink-2)]">Best quality we could preserve for your target.</p>}
      {outcome.kind === "already-small" && <p className="mt-1 text-[var(--ink-2)]">Your {noun} is already under {formatTarget(target)}, so it&rsquo;s returned unchanged.</p>}
      {!reached && (
        <div className="mt-1 text-[var(--ink-2)]">
          <p>Couldn&rsquo;t reach {formatTarget(target)} without unacceptable quality loss.</p>
          <p className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[var(--ink)]">
            <span>
              Requested: <strong className="tabular font-semibold">{formatTarget(target)}</strong>
            </span>
            <span>
              Closest safe result: <strong className="tabular font-semibold">{formatSize(outcome.bytes)}</strong>
              {outcome.kind === "no-gain" && ` (your original — nothing we tried came out smaller)`}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
