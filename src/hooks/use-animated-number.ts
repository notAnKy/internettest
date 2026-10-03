"use client";

import { useLayoutEffect, useRef } from "react";
import { formatMetric } from "@/utils/format";
import { interpolateMeasurement } from "@/utils/interpolation";

/** Presentation only. Neither the measurement store nor final results are
 * written here. Only this span's text changes on frames; React never renders
 * the page, metrics, or chart in response to an animation tick. */
export function useAnimatedNumber(
  value: number | null,
  animate: boolean,
  durationMs = 360,
) {
  const element = useRef<HTMLSpanElement>(null);
  const displayed = useRef<number | null>(null);

  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame: number | null = null;
    const paint = (next: number | null) => {
      displayed.current = next;
      const text = formatMetric(next);
      if (node.textContent !== text) node.textContent = text;
    };
    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const snap = () => {
      stop();
      paint(value);
    };
    const onPreference = () => {
      if (preference.matches) snap();
    };
    preference.addEventListener("change", onPreference);

    if (
      !animate ||
      preference.matches ||
      value === null ||
      displayed.current === null ||
      displayed.current === value
    ) {
      paint(value);
    } else {
      // Retarget from the currently painted value, not the previous sample.
      // Elapsed time makes the same easing work at any display refresh rate.
      const from = displayed.current;
      const started = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, Math.max(0, (now - started) / durationMs));
        paint(interpolateMeasurement(from, value, now - started, durationMs));
        frame = progress < 1 ? requestAnimationFrame(tick) : null;
      };
      frame = requestAnimationFrame(tick);
    }
    return () => {
      stop();
      preference.removeEventListener("change", onPreference);
    };
  }, [value, animate, durationMs]);

  return element;
}
