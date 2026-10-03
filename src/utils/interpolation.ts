/** A bounded ease-out between two real presentation targets. No sample
 * generation, springs, accumulated frame-count error, or overshoot. */
export function interpolateMeasurement(
  from: number,
  target: number,
  elapsedMs: number,
  durationMs = 360,
): number {
  const progress =
    durationMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / durationMs));
  return progress === 1
    ? target
    : from + (target - from) * (1 - (1 - progress) ** 3);
}
