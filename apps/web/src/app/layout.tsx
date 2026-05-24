import type { Metadata } from "next";

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
      <body>{children}</body>
    </html>
  );
}
