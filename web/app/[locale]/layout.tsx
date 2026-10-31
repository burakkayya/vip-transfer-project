import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import Icon from "@/components/Icon";
import Logo from "@/components/Logo";
import SiteHeader from "@/components/SiteHeader";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { company } from "@/lib/site";
import "../globals.css";
import "../home.css";

// next/font yazı tipini derleme sırasında indirir ve kendi sunucumuzdan verir (ziyaretçi Google'a bağlanmaz).
const sans = Inter({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--font-sans", display: "swap" });

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

// Alt bilgideki popüler rotalar (bölge kodları seed verisiyle aynı).
const ROUTES = [
  { from: "ayt", to: "kemer", label: "Antalya Havalimanı → Kemer" },
  { from: "ayt", to: "serik", label: "Antalya Havalimanı → Belek" },
  { from: "ayt", to: "alanya", label: "Antalya Havalimanı → Alanya" },
  { from: "dlm", to: "fethiye", label: "Dalaman Havalimanı → Fethiye" },
  { from: "bjv", to: "bodrum", label: "Bodrum Havalimanı → Bodrum" },
];

const AIRPORTS = [
  { code: "ayt", label: "Antalya (AYT)" },
  { code: "gzp", label: "Gazipaşa-Alanya (GZP)" },
  { code: "dlm", label: "Dalaman (DLM)" },
  { code: "bjv", label: "Milas-Bodrum (BJV)" },
];

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = { themeColor: "#ffffff" };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: t("title"),
    description: t("description"),
    icons: { icon: "/icon.svg" },
    alternates: { languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])) },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("nav");
  const f = await getTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <html lang={locale} className={sans.variable}>
      <body>
        <NextIntlClientProvider>
          <SiteHeader
            labels={{
              services: t("services"), fleet: t("fleet"), faq: t("faq"), bookings: t("bookings"),
              account: t("account"), book: t("book"), menu: t("menu"), home: company.name,
            }}
          />
          <main>{children}</main>
          <footer className="footer">
            <div className="container">
              <div className="footer-box">
                <div className="footer-top">
                  <div className="footer-about">
                    <Logo inverted />
                    <p>{f("about")}</p>
                    <p>{f("tursab", { no: company.tursabNo })}</p>
                  </div>
                  <div>
                    <h4>{f("airports")}</h4>
                    <ul>
                      {AIRPORTS.map((a) => (
                        <li key={a.code}><Link href={`/book?from=${a.code}`}>{a.label}</Link></li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4>{f("routes")}</h4>
                    <ul>
                      {ROUTES.map((r) => (
                        <li key={r.label}><Link href={`/book?from=${r.from}&to=${r.to}`}>{r.label}</Link></li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4>{f("legal")}</h4>
                    <ul>
                      <li><Link href="/legal/cancellation">{f("cancellation")}</Link></li>
                      <li><Link href="/legal/privacy">{f("privacy")}</Link></li>
                      <li><Link href="/legal/distance-sales">{f("distanceSales")}</Link></li>
                      <li><Link href="/legal/cookies">{f("cookies")}</Link></li>
                      <li><Link href="/data-request">{f("dataRequest")}</Link></li>
                    </ul>
                  </div>
                  <div>
                    <h4>{f("contact")}</h4>
                    <ul>
                      <li><a href={`mailto:${company.email}`}>{company.email}</a></li>
                      <li>{company.address}</li>
                    </ul>
                  </div>
                </div>
                <div className="footer-bottom">
                  <span>© {year} {company.name}. {f("rights")}</span>
                  <span className="payment-note"><Icon name="lock" size={15} /> PayTR · Visa · Mastercard</span>
                </div>
              </div>
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
