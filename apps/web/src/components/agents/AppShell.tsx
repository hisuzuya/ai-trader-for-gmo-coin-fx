"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", match: (p) => p === "/" },
  { href: "/agents", label: "Agents", match: (p) => p.startsWith("/agents") },
  { href: "/proposals", label: "Proposals", match: (p) => p.startsWith("/proposals") },
  { href: "/runs", label: "Runs", match: (p) => p.startsWith("/runs") },
  { href: "/market", label: "Market", match: (p) => p.startsWith("/market") },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <header className="app-shell-nav">
        <Link href="/" className="app-shell-brand">
          <span className="app-shell-brand-dot" aria-hidden />
          <span>ai-trade</span>
        </Link>
        <nav className="app-shell-links" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname ?? "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "app-shell-link active" : "app-shell-link"}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <span className="app-shell-status" aria-live="polite">
          <span className="app-shell-status-dot" aria-hidden /> Live
        </span>
      </header>
      <main className="app-shell-body">{children}</main>
    </div>
  );
}
