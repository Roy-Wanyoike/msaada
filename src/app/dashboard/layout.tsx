import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Msaada · County Triage Dashboard",
  description:
    "Aggregate community mental-health triage signals for county health officials. De-identified aggregates only — no individual observation text is exposed.",
  robots: { index: false, follow: false },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
