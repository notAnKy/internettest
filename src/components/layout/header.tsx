import { History, Radio } from "lucide-react";
import Link from "next/link";

export function Header({
  active = "speed",
}: {
  active?: "speed" | "packet-loss";
}) {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="InternetTest home">
        <Radio size={23} aria-hidden="true" />
        <span>
          Internet<span className="brand-light">Test</span>
        </span>
      </Link>
      <nav className="test-navigation" aria-label="Tests">
        <Link href="/" aria-current={active === "speed" ? "page" : undefined}>
          Speed test
        </Link>
        <Link
          href="/packet-loss"
          aria-current={active === "packet-loss" ? "page" : undefined}
        >
          Packet loss
        </Link>
      </nav>
      <button
        className="history-button"
        disabled
        title="History is coming later"
      >
        <History size={16} aria-hidden="true" />
        History <span className="history-soon">Soon</span>
      </button>
    </header>
  );
}
