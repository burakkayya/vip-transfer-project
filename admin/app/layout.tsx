import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./tokens.css";
import "./globals.css";

const sans = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Getaway Admin",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
