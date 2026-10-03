export interface FortniteEndpoint {
  game: "fortnite";
  region: "Europe";
  subregion: "France" | "Germany" | "United Kingdom";
  host: string;
  documentedTransport: "icmp";
  browserTransport: null;
}

// No numeric result is possible until an appropriate transport is verified.
// Keeping this state explicit prevents failure/handshake time becoming "ping".
export interface GameLatencyResult {
  game: "fortnite";
  region: "Europe";
  subregion: FortniteEndpoint["subregion"];
  host: string;
  latencyMs: null;
  jitterMs: null;
  samples: readonly number[];
  status: "unsupported";
  measurementType: "none";
}

export interface GameLatencyReport {
  status: "unsupported";
  reason: "no-verified-browser-transport";
  results: readonly GameLatencyResult[];
  bestRoute: null;
}
