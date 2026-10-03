export interface PacketLossSettings {
  packetSize: number;
  frequency: number;
  duration: number;
  acceptableDelay: number;
  warmup: boolean;
}

export interface PacketDeliverySample {
  sequence: number;
  delayMs: number | null;
}

export interface PacketLossProgress {
  phase: "connecting" | "warmup" | "testing" | "waiting";
  total: number;
  elapsedMs: number;
  durationMs: number;
}

export interface PacketLossResult {
  status: "complete";
  measurementType: "webrtc-turn-udp";
  sentPackets: number;
  receivedPackets: number;
  lostPackets: number;
  lossPercent: number;
  durationMs: number;
  delivery?: {
    settings: PacketLossSettings;
    samples: PacketDeliverySample[];
    latePackets: number;
    latePercent: number;
    averageDelayMs: number;
    jitterMs: number | null;
  };
}

export type PacketLossFailure =
  | "setup-required"
  | "credentials-unavailable"
  | "unsupported"
  | "connection-failed"
  | "udp-unverified"
  | "timeout"
  | "no-delivery"
  | "invalid-settings";

export class PacketLossError extends Error {
  constructor(public readonly code: PacketLossFailure) {
    super(code);
    this.name = "PacketLossError";
  }
}
