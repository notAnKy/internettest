import type { Metadata } from "next";
import { PacketLossConsole } from "@/components/test/packet-loss";

export const metadata: Metadata = {
  title: "Packet loss test — InternetTest",
  description:
    "Test UDP message delivery, packet loss, delay, and jitter with adjustable size, frequency, duration, and presets.",
  openGraph: {
    title: "Packet loss test — InternetTest",
    description:
      "Test message delivery, delay, jitter, and packet loss with adjustable settings.",
    siteName: "InternetTest",
    type: "website",
  },
};

export default function PacketLossPage() {
  return <PacketLossConsole />;
}
