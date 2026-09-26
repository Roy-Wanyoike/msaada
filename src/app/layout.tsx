import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Toaster as RadixToaster } from "@/components/ui/toaster";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Msaada — CHV mental-health triage",
  description:
    "Community health volunteer home-visit observation triage. Demo build — not a diagnostic tool. Crisis line: Kenya Red Cross 1199 / Befrienders Kenya +254 722 178 177.",
  applicationName: "Msaada",
  keywords: [
    "Msaada",
    "community health",
    "CHV",
    "mental health triage",
    "Kenya",
    "Qwen",
  ],
  openGraph: {
    title: "Msaada — CHV mental-health triage",
    description:
      "Help reaches the household first: natural-language observation → deterministic safety policy → tracked referral. Built for Kenya's 90,000+ community health volunteers.",
    type: "website",
    siteName: "Msaada",
    locale: "en_KE",
  },
  twitter: {
    card: "summary",
    title: "Msaada — CHV mental-health triage",
    description:
      "Help reaches the household first: AI structures the observation, deterministic policy decides, humans deliver care.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0E3A3D",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/* Skip-to-main link — first focusable element (WCAG 2.4.1 Bypass Blocks).
            Each page renders its own <main>; pages should use <main id="main">
            (and tabIndex={-1} if programmatic focus move is desired) as the
            skip-link target. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:left-2 focus:top-2 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
        >
          Skip to main content
        </a>
        {children}
        {/* Sonner toasts (default for client pages via sonner's `toast()`) */}
        <Toaster />
        {/* Radix toasts — required because the dashboard uses `useToast()` from
            @/hooks/use-toast, which renders into <Toaster /> below. Without it,
            dashboard toasts are invisible. The two coexist fine. */}
        <RadixToaster />
        <Analytics />
      </body>
    </html>
  );
}
