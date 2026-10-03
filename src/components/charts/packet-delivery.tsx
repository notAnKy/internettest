import type { PacketLossResult } from "@/types/packet-loss";

export function PacketDeliveryChart({
  delivery,
}: {
  delivery: NonNullable<PacketLossResult["delivery"]>;
}) {
  const { samples, settings } = delivery;
  const stride = Math.max(1, Math.ceil(samples.length / 160));
  const groups = Array.from(
    { length: Math.ceil(samples.length / stride) },
    (_, index) => samples.slice(index * stride, (index + 1) * stride),
  );
  const maxDelay = Math.max(
    settings.acceptableDelay * 1.25,
    ...samples.map((sample) => sample.delayMs ?? 0),
  );
  const y = (delay: number) => 142 - Math.min(1, delay / maxDelay) * 118;
  const step = 560 / groups.length;
  const threshold = y(settings.acceptableDelay);
  return (
    <figure className="packet-chart">
      <figcaption>
        Delivery delay <span>ms</span>
      </figcaption>
      <svg
        viewBox="0 0 620 175"
        role="img"
        aria-label="Message delivery delay chart with acceptable delay threshold and lost message markers"
      >
        <title>
          Delivery delay through the Metered relay. Lost messages appear as
          markers below the baseline.
        </title>
        <text x="0" y="28" className="packet-chart-label">
          {Math.ceil(maxDelay)}
        </text>
        <text x="0" y="145" className="packet-chart-label">
          0
        </text>
        <path d="M42 142H602" className="packet-chart-axis" />
        <path d={`M42 ${threshold}H602`} className="packet-chart-threshold" />
        {groups.map((group, index) => {
          const received = group
            .filter((sample) => sample.delayMs !== null)
            .map((sample) => sample.delayMs!);
          const x = 42 + step * (index + 0.5);
          return (
            <g key={index}>
              {received.length > 0 && (
                <path
                  d={`M${x} ${y(Math.max(...received))}V${Math.min(142, y(Math.min(...received)) + 2)}`}
                  className={
                    received.some((delay) => delay > settings.acceptableDelay)
                      ? "packet-chart-late"
                      : "packet-chart-received"
                  }
                />
              )}
              {received.length < group.length && (
                <path d={`M${x} 149v5`} className="packet-chart-lost" />
              )}
            </g>
          );
        })}
        <text x="42" y="172" className="packet-chart-label">
          1
        </text>
        <text x="602" y="172" textAnchor="end" className="packet-chart-label">
          {samples.length} messages
        </text>
      </svg>
      <div className="packet-chart-legend">
        <span>Received</span>
        <span>Late</span>
        <span>Lost</span>
        <span>Delay threshold</span>
      </div>
      {stride > 1 && (
        <p>
          Each column groups up to {stride} messages; bars show minimum and
          maximum delay.
        </p>
      )}
    </figure>
  );
}
