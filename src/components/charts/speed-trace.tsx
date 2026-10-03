"use client";

import { memo, useMemo } from "react";
import type { MeasurementPoint } from "@/types/speedtest";

// Each stroke is one actual sample. New strokes fade in without inventing
// points, smoothing the data, or animating the measured chart geometry.
export const SpeedTrace = memo(function SpeedTrace({
  points,
}: {
  points: MeasurementPoint[];
}) {
  const strokes = useMemo(() => {
    const visible = points.slice(-24);
    const max = Math.max(1, ...visible.map((point) => point.value));
    return visible.map((point, i) => ({
      ...point,
      x: (250 - (visible.length - 1) * 10) / 2 + i * 10,
      height: Math.max(2, (point.value / max) * 30),
    }));
  }, [points]);
  if (!strokes.length)
    return <div className="trace-placeholder" aria-hidden="true" />;
  return (
    <svg
      className="speed-trace"
      viewBox="0 0 250 40"
      role="img"
      aria-label={`${points.length} real measurement samples`}
    >
      {strokes.map((stroke, i) => (
        <line
          key={`${stroke.timeMs}:${i}`}
          x1={stroke.x}
          x2={stroke.x}
          y1={36}
          y2={36 - stroke.height}
          stroke="currentColor"
          strokeWidth="2"
          className="sample-stroke"
        />
      ))}
    </svg>
  );
});
