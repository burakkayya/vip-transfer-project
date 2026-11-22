import type { Metadata } from "next";
import { Inter } from "next/font/google";
import ErrorReporter from "@/components/ErrorReporter";
import "./tokens.css";
import "./globals.css";

const sans = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-sans", display: "swap" });

// CSP nonce'ı (WEB-04) istek başına üretilir; önceden derlenmiş HTML nonce taşımadığı için sayfalar her istekte
// çizilir. Next, middleware'in istek başlığına yazdığı CSP'den nonce'ı okuyup kendi script'lerine ekler.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Getaway Admin",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={sans.variable}>
      <body>
        <ErrorReporter />
        {children}
      </body>
    </html>
  );
}
