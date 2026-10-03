import type { QualityGrade } from "../../types/quality";

export type RatedGrade = Exclude<QualityGrade, "unavailable">;
export const grades: RatedGrade[] = ["excellent", "good", "fair", "poor"];
export const gradeLabels: Record<QualityGrade, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  unavailable: "Unavailable",
};

// InternetTest v1 policy, not a universal service certification. Sources,
// headroom, bounds and confidence rules are documented in README.md.
// Tuples represent excellent / good / fair, then poor beyond these bounds.
export const thresholds = {
  gaming: {
    latency: [40, 80, 150],
    jitter: [5, 15, 30],
    download: [5, 3, 1],
    upload: [1, 0.5, 0.25],
  },
  streaming: { download: [30, 7.5, 3] },
  browsing: {
    latency: [50, 100, 200],
    download: [10, 5, 1],
    loaded: [100, 200, 400],
  },
  videoCalls: {
    latency: [50, 100, 250],
    jitter: [5, 15, 30],
    bandwidth: [5, 3.2, 1],
    loaded: [100, 200, 400],
  },
  // Based on Waveform's 5 / 30 / 60 ms breakpoints, collapsed into four
  // consumer grades. Use worst direction; Cloudflare medians, not averages.
  bufferbloat: [5, 30, 60],
  overallWeights: { gaming: 20, streaming: 25, browsing: 30, videoCalls: 25 },
} as const;

export function validMetric(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function band(
  value: number | null,
  limits: readonly number[],
  higher = false,
): RatedGrade | null {
  if (value === null) return null;
  const index = limits.findIndex((limit) =>
    higher ? value >= limit : value <= limit,
  );
  return grades[index < 0 ? 3 : index];
}

export function increaseGrade(value: number): RatedGrade {
  const index = thresholds.bufferbloat.findIndex(
    (limit) => Math.max(0, value) < limit,
  );
  return grades[index < 0 ? 3 : index];
}

export function worstGrade(values: (RatedGrade | null)[]): RatedGrade {
  return grades[
    Math.max(
      0,
      ...values
        .filter((value) => value !== null)
        .map((value) => grades.indexOf(value)),
    )
  ];
}
