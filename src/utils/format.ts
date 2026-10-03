const metricFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatMetric(value: number | null, finished = false): string {
  if (value === null) return finished ? "Unavailable" : "—";
  return metricFormatter.format(value);
}
