import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EdgeFleet — Distributed AMR Coordination",
  description: "SIH26123 · Edge-AI Based Distributed Fleet Coordination for AMRs in Smart Warehouses",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
