import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Hide the floating Next.js dev-tools badge so it never appears as a stray
  // "N" element in demo screenshots / judge recordings.
  devIndicators: false,
  // Let the dev server be opened via its LAN "Network" URL (e.g. from a phone
  // on the same Wi-Fi). Without this, Next blocks its dev scripts for that
  // origin and the page renders blank. Dev-only; ignored in production.
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;
