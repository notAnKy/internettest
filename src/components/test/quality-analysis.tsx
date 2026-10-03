"use client";

import { useId, useMemo, useState } from "react";
import { analyzeConnection } from "@/lib/quality/analyzer";
import { gradeLabels } from "@/lib/quality/thresholds";
import type { SpeedTestResult } from "@/types/speedtest";
import type { ConnectionQualityReport } from "@/types/quality";
import { formatMetric } from "@/utils/format";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const rows = [
  ["overall", "Connection quality"],
  ["gaming", "Gaming"],
  ["streaming", "Streaming"],
  ["browsing", "Browsing"],
  ["videoCalls", "Video calls"],
  ["bufferbloat", "Bufferbloat"],
] as const satisfies ReadonlyArray<
  readonly [keyof Omit<ConnectionQualityReport, "methodologyVersion">, string]
>;

export function QualityAnalysis({ result }: { result: SpeedTestResult }) {
  const report = useMemo(() => analyzeConnection(result), [result]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const id = useId();
  return (
    <section
      className="quality-section"
      aria-labelledby={`${id}-title`}
      data-quality-version={report.methodologyVersion}
    >
      <h2 id={`${id}-title`} className="sr-only">
        Connection quality analysis
      </h2>
      {rows.map(([key, label]) => {
        const category = report[key];
        const open = expanded === key;
        return (
          <div
            key={key}
            className={`quality-row ${key === "overall" ? "quality-overall" : ""}`}
            data-quality={key}
            data-grade={category.grade}
          >
            <button
              className="quality-toggle"
              id={`${id}-${key}-button`}
              aria-expanded={open}
              aria-controls={`${id}-${key}-panel`}
              onClick={() => setExpanded(open ? null : key)}
            >
              <span>{label}</span>
              <span className="quality-row-end">
                {category.coverage === "limited" &&
                  category.grade !== "unavailable" && (
                    <span className="quality-limited">Limited data</span>
                  )}
                <span className={`quality-grade grade-${category.grade}`}>
                  {gradeLabels[category.grade]}
                </span>
                <span className="quality-expand" aria-hidden="true">
                  {open ? "−" : "+"}
                </span>
              </span>
            </button>
            {open && (
              <div
                className="quality-details"
                id={`${id}-${key}-panel`}
                role="region"
                aria-labelledby={`${id}-${key}-button`}
              >
                {category.metrics.length > 0 && (
                  <dl className="quality-metrics">
                    {category.metrics.map((metric) => (
                      <div key={metric.key}>
                        <dt>{metric.label}</dt>
                        <dd
                          data-quality-metric={metric.key}
                          data-value={metric.value}
                        >
                          {metric.signed && metric.value >= 0 ? "+" : ""}
                          {formatMetric(metric.value)}{" "}
                          <span>{metric.unit}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p>{category.summary}</p>
                {category.coverage === "limited" && (
                  <p className="quality-note">
                    Partial measurements; unmeasured conditions remain unknown.
                  </p>
                )}
                {category.note && (
                  <p className="quality-note">{category.note}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
      <Link
        href="/packet-loss"
        className="quality-toggle quality-row packet-loss-link"
      >
        <span>Packet loss</span>
        <span className="quality-row-end">
          Open test <ArrowUpRight size={15} aria-hidden="true" />
        </span>
      </Link>
    </section>
  );
}
