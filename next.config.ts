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
};

export default nextConfig;
