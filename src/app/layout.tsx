import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bordereau",
  description: "Onboard insurer bordereaux, catch data problems, and produce a reconciled Lloyd's claims report.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
