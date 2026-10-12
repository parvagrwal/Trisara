import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.NEXT_PUBLIC_WAITLIST_ENDPOINT) {
    console.warn(
      "\n[trisara] NEXT_PUBLIC_WAITLIST_ENDPOINT is not set: the waitlist section renders no form, only the Read the contracts link.\n",
    );
  }
  return {
    output: "export",
    images: { unoptimized: true },
    trailingSlash: true,
    basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
    reactStrictMode: true,
    poweredByHeader: false,
  };
}
