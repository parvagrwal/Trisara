import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/martian-mono/wdth.css";
import "@fontsource-variable/schibsted-grotesk/wght.css";
import "./globals.css";
import { SITE_URL } from "@/lib/config";

export const metadata: Metadata = {
  title: "Trisara: session-aware infrastructure for tokenized stocks",
  description:
    "Trisara is session-aware infrastructure for tokenized stocks: every trade checks the market session before it executes.",
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
};

export const viewport: Viewport = {
  themeColor: "#F1F5EC",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
