import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Inter, Noto_Sans_Arabic } from "next/font/google";
import { notFound } from "next/navigation";
import Icon from "@/components/Icon";
import Logo from "@/components/Logo";
import SiteHeader from "@/components/SiteHeader";
import { Link } from "@/i18n/navigation";
import { dirOf } from "@/i18n/locales";
import { routing } from "@/i18n/routing";
import { airportName } from "@/lib/airports";
import { company } from "@/lib/site";
import "../tokens.css";
import "../globals.css";
import "../home.css";

// next/font yazı tipini derleme sırasında indirir ve kendi sunucumuzdan verir (ziyaretçi Google'a bağlanmaz).
const sans = Inter({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--font-sans", display: "swap" });
// K-77: Arapça glifler Inter'de yok; yalnızca Arapça sayfada önceden yüklenir. Çince, Japonca ve Korece sistem
// yazı tipiyle çizilir (globals.css :lang yığınları); CJK web fontu sayfa başına megabaytlarca olurdu.
const arabic = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-arabic", display: "swap", preload: false });

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

// Alt bilgideki popüler rotalar (bölge kodları seed verisiyle aynı).
const ROUTES = [
  { from: "ayt", to: "kemer", label: "Antalya Havalimanı → Kemer" },
  { from: "ayt", to: "serik", label: "Antalya Havalimanı → Belek" },
  { from: "ayt", to: "alanya", label: "Antalya Havalimanı → Alanya" },
  { from: "dlm", to: "fethiye", label: "Dalaman Havalimanı → Fethiye" },
  { from: "bjv", to: "bodrum", label: "Bodrum Havalimanı → Bodrum" },
  { from: "ist", to: "fatih", label: "İstanbul Havalimanı → Sultanahmet" },
  { from: "saw", to: "kadikoy", label: "Sabiha Gökçen → Kadıköy" },
  { from: "adb", to: "cesme", label: "İzmir Havalimanı → Çeşme" },
  { from: "esb", to: "cankaya", label: "Esenboğa → Çankaya" },
  { from: "asr", to: "urgup", label: "Kayseri Havalimanı → Ürgüp" },
  { from: "nav", to: "nevsehir_merkez", label: "Kapadokya Havalimanı → Göreme" },
];

const AIRPORTS = [
  { code: "ayt", label: "Antalya (AYT)" },
  { code: "gzp", label: "Gazipaşa-Alanya (GZP)" },
  { code: "dlm", label: "Dalaman (DLM)" },
  { code: "bjv", label: "Milas-Bodrum (BJV)" },
  { code: "ist", label: "İstanbul (IST)" },
  { code: "saw", label: "Sabiha Gökçen (SAW)" },
  { code: "esb", label: "Ankara Esenboğa (ESB)" },
  { code: "adb", label: "İzmir Adnan Menderes (ADB)" },
  { code: "nav", label: "Nevşehir Kapadokya (NAV)" },
  { code: "asr", label: "Kayseri Erkilet (ASR)" },
];

// CSP nonce'ı (WEB-04) istek başına üretilir; önceden derlenmiş HTML nonce taşımadığı için sayfalar her istekte
// çizilir. Next, middleware'in istek başlığına yazdığı CSP'den nonce'ı okuyup kendi script'lerine ekler.
export const dynamic = "force-dynamic";

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

/** Alt bilgi rotası: havalimanı adı ziyaretçinin dilinde (K-77), varış ilçesi özel addır. */
function routeLabel(r: (typeof ROUTES)[number], locale: string) {
  const [from, to] = r.label.split(" → ");
  return `${airportName(r.from.toUpperCase(), locale) ?? from} → ${to}`;
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("nav");
  const f = await getTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <html lang={locale} dir={dirOf(locale)} className={`${sans.variable} ${arabic.variable}`}>
      <body>
        <NextIntlClientProvider>
          <SiteHeader
            labels={{
              services: t("services"), fleet: t("fleet"), faq: t("faq"), bookings: t("bookings"),
              account: t("account"), book: t("book"), menu: t("menu"), sections: t("sections"), home: company.name,
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
                        <li key={r.label}><Link href={`/book?from=${r.from}&to=${r.to}`}><span dir="ltr">{routeLabel(r, locale)}</span></Link></li>
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
