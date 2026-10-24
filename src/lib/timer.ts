/** Starts a stopwatch; the returned function gives whole milliseconds elapsed. */
export function startTimer(): () => number {
  const t0 = performance.now();
  return () => Math.round(performance.now() - t0);
}
