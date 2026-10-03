import type { MeasurementPoint } from "@/types/speedtest";
import { formatMetric } from "@/utils/format";

export function MeasurementSamples({
  latency,
  download,
  upload,
}: {
  latency: MeasurementPoint[];
  download: MeasurementPoint[];
  upload: MeasurementPoint[];
}) {
  return (
    <details className="method-details">
      <summary>Measured samples</summary>
      <div className="sample-tables">
        {[
          { label: "Download", points: download, unit: "Mbps" },
          { label: "Upload", points: upload, unit: "Mbps" },
          { label: "Idle latency", points: latency, unit: "ms" },
        ].map((series) => (
          <details key={series.label}>
            <summary>
              {series.label} <span>{series.points.length} samples</span>
            </summary>
            <div className="sample-table-wrap">
              <table>
                <caption className="sr-only">
                  {series.label} measurements
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Sample</th>
                    <th scope="col">Time (s)</th>
                    <th scope="col">{series.unit}</th>
                  </tr>
                </thead>
                <tbody>
                  {series.points.map((point, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        {(
                          (point.timeMs - (series.points[0]?.timeMs ?? 0)) /
                          1000
                        ).toFixed(2)}
                      </td>
                      <td>{formatMetric(point.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!series.points.length && <p>Unavailable</p>}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}
