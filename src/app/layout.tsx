import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InternetTest",
  description:
    "A browser-based internet speed, connection quality, and packet-loss testing tool.",
  openGraph: {
    title: "InternetTest",
    description:
      "A browser-based internet speed, connection quality, and packet-loss testing tool.",
    siteName: "InternetTest",
    type: "website",
  },
};

// Next provides width=device-width and initial-scale=1; keep zoom enabled.
export const viewport: Viewport = {
  themeColor: "#0d1012",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
