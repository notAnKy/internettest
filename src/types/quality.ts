export type QualityGrade =
  "excellent" | "good" | "fair" | "poor" | "unavailable";
export type QualityCoverage = "complete" | "limited" | "insufficient";

export interface QualityMetric {
  key: string;
  label: string;
  value: number;
  unit: "ms" | "Mbps";
  signed?: boolean;
}

export interface QualityCategory {
  grade: QualityGrade;
  coverage: QualityCoverage;
  summary: string;
  metrics: QualityMetric[];
  note?: string;
}

export interface BufferbloatAnalysis extends QualityCategory {
  downloadIncreaseMs: number | null;
  uploadIncreaseMs: number | null;
  worstIncreaseMs: number | null;
}

export interface ConnectionQualityReport {
  methodologyVersion: "1";
  overall: QualityCategory;
  gaming: QualityCategory;
  streaming: QualityCategory;
  browsing: QualityCategory;
  videoCalls: QualityCategory;
  bufferbloat: BufferbloatAnalysis;
}
