import type { Metadata } from "next";

import { AppShell } from "@/components/agents/AppShell";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI Trade",
  description: "AI-assisted FX paper trading dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
