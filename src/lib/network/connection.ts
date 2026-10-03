interface BrowserConnection extends EventTarget {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
}
export interface ConnectionInfo {
  online: boolean | null;
  protocol: string;
  networkType: string;
  downlink: number | null;
  saveData: boolean;
}
const connection = () =>
  (navigator as Navigator & { connection?: BrowserConnection }).connection;
export const serverConnection = JSON.stringify({
  online: null,
  protocol: "—",
  networkType: "Unknown",
  downlink: null,
  saveData: false,
});
export function getConnectionSnapshot() {
  const network = connection();
  return JSON.stringify({
    online: navigator.onLine,
    protocol:
      location.protocol === "https:"
        ? "HTTPS"
        : location.protocol === "http:"
          ? "HTTP"
          : "Unknown",
    // effectiveType describes performance, not cellular transport. Only call
    // a connection Wi-Fi when the browser actually exposes its physical type.
    networkType:
      network?.type ??
      (network?.effectiveType
        ? `${network.effectiveType.toUpperCase()} estimate`
        : "Unknown"),
    downlink:
      typeof network?.downlink === "number" && Number.isFinite(network.downlink)
        ? network.downlink
        : null,
    saveData: network?.saveData ?? false,
  } satisfies ConnectionInfo);
}
export function subscribeConnection(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  const network = connection();
  network?.addEventListener("change", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
    network?.removeEventListener("change", callback);
  };
}
