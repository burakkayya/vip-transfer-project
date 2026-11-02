import { getTranslations, setRequestLocale } from "next-intl/server";
import Image from "next/image";
import FleetCard from "@/components/FleetCard";
import Icon from "@/components/Icon";
import { CountUp, HeroMedia, InView, ParallaxBg, Reveal, SmoothScroll } from "@/components/Motion";
import TripForm from "@/components/TripForm";
import { Link } from "@/i18n/navigation";
import { getRegions, getVehicleTypes } from "@/lib/server";
import { emptyTrip } from "@/lib/trip";
import { vehicleVariants } from "@/lib/vehicles";

type Props = { params: Promise<{ locale: string }> };

const SERVICES = [
  { key: "s1", image: "/images/service-airport.webp", to: "/book?from=ayt" },
  { key: "s2", image: "/images/service-business.webp", to: "/book" },
  { key: "s3", image: "/images/service-chauffeur.webp", to: "/book" },
  { key: "s4", image: "/images/service-events.webp", to: "/book" },
] as const;

// Bento ızgarada kartın kapladığı genişlik (next/image sizes): ilk kart geniş, dördüncü tam satır.
const SERVICE_SIZES = [
  "(max-width: 960px) 100vw, 66vw",
  "(max-width: 720px) 100vw, (max-width: 960px) 50vw, 33vw",
  "(max-width: 720px) 100vw, (max-width: 960px) 50vw, 33vw",
  "(max-width: 1440px) 100vw, 1440px",
];

const TRUST = [
  { i: 1, icon: "shield" },
  { i: 3, icon: "plane" },
  { i: 2, icon: "user" },
  { i: 4, icon: "refund" },
] as const;

export default async function Home({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const [regions, vehicleTypes] = await Promise.all([getRegions(), getVehicleTypes()]);
  const airports = regions.filter((r) => r.type === "havalimani");
  const districts = regions.filter((r) => r.type === "ilce");
  const colorLabels = { white: t("colorWhite"), black: t("colorBlack") };
  const titleWords = t("heroTitle").split(" ");

  return (
    <>
      <SmoothScroll />
      <section className="hero">
        <HeroMedia src="/images/hero-airport.webp" mobileSrc="/images/hero-airport-mobile.webp" alt="" />
        <div className="container hero-inner">
          <div className="hero-copy">
            {/* Kelimeler CSS ile açılır (JS beklemez); ekran okuyucu düz başlığı okur. */}
            <h1>
              {titleWords.map((w, i) => (
                <span key={i}>
                  {i > 0 && " "}
                  <span className="word" style={{ "--i": i } as React.CSSProperties}>{w}</span>
                </span>
              ))}
            </h1>
            <p className="lead">{t("heroText")}</p>
            <ul className="hero-stats">
              {airports.length > 0 && <li><strong><CountUp value={airports.length} /></strong><span>{t("statAirports")}</span></li>}
              {districts.length > 0 && <li><strong><CountUp value={districts.length} /></strong><span>{t("statDistricts")}</span></li>}
              <li><strong><CountUp value={48} suffix={t("statHoursUnit")} /></strong><span>{t("statCancel")}</span></li>
            </ul>
          </div>
          <div className="hero-card" id="quote">
            <h2 className="hero-card-title">{t("cardTitle")}</h2>
            <p className="hero-card-sub">{t("cardText")}</p>
            <TripForm regions={regions} initial={emptyTrip()} />
          </div>
        </div>
        <div className="flight-tag" aria-hidden>
          <Icon name="plane" size={18} /> <span>{t("flightTag")}</span>
        </div>
      </section>

      {/* Güven şeridi giriş bölümünün koyu zeminini sürdürür: kart değil, çizgiyle ayrılmış dört söz. */}
      <div className="trust-band">
        <ul className="container trust-strip">
          {TRUST.map(({ i, icon }) => (
            <li key={i} className="trust-item">
              <Icon name={icon} size={20} />
              <div>
                <strong>{t(`why${i}Title`)}</strong>
                <p>{t(`why${i}Text`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="container">
        <section className="section" id="services">
          <Reveal className="section-head">
            <h2 className="section-title">{t("servicesTitle")}</h2>
            <p>{t("servicesLead")}</p>
          </Reveal>
          <div className="services">
            {SERVICES.map((s, n) => (
              <Reveal key={s.key} delay={n * 0.08}>
                <Link href={s.to} className="service">
                  <Image src={s.image} alt="" fill sizes={SERVICE_SIZES[n]} />
                  <div className="service-body">
                    <h3>{t(`${s.key}Title`)}</h3>
                    <p>{t(`${s.key}Text`)}</p>
                    <span className="text-link">{t("bookThis")} <Icon name="arrow" size={16} /></span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </section>
      </div>

      {vehicleTypes.length > 0 && (
        <section className="band" id="fleet">
          <div className="container">
            <Reveal className="section-head">
              <h2 className="section-title">{t("fleetTitle")}</h2>
              <p>{t("fleetLead")}</p>
            </Reveal>
            <div className="fleet">
              {vehicleTypes.map((vt, n) => (
                <Reveal key={vt.code} delay={n * 0.08}>
                  <FleetCard
                    code={vt.code}
                    name={vt.name}
                    capacity={vt.capacity}
                    luggage={vt.luggage_capacity}
                    tag={vt.code.startsWith("vip_") ? "VIP" : undefined}
                    cta={t("fleetCta")}
                    variants={vehicleVariants(vt.code).map((v) => ({ ...v, label: colorLabels[v.key] }))}
                  />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="container">
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">{t("howTitle")}</h2>
            <p>{t("howLead")}</p>
          </div>
          {/* Rota rayı: alış dairesi, kesikli hat, varış karesi. Görününce hat soldan sağa çizilir. */}
          <InView as="ol" className="route-steps" threshold={0.8}>
            {(["how1", "how2", "how3"] as const).map((k) => (
              <li key={k}>
                <span className="node" aria-hidden />
                <p>{t(k)}</p>
              </li>
            ))}
          </InView>
        </section>

        <section className="section feature-band">
          <div>
            <h2>{t("groupTitle")}</h2>
            <p>{t("groupText")}</p>
            <ul>
              {(["group1", "group2", "group3", "group4"] as const).map((k) => (
                <li key={k}><Icon name="check" size={18} /> {t(k)}</li>
              ))}
            </ul>
            <Link href="/book" className="btn big on-dark">{t("ctaButton")} <Icon name="arrow" size={18} /></Link>
          </div>
          {/* Yandan Vito görününce yola girer; yol çizgileri araçla birlikte akar ve araç durunca durur. */}
          <InView className="drive-stage" threshold={0.75}>
            <span className="capacity-pill"><Icon name="users" size={16} /> {t("groupPill")}</span>
            <span className="glow" aria-hidden />
            <span className="road" aria-hidden />
            <div className="drive-car">
              <Image src="/images/vito-side.webp" alt={t("groupImageAlt")} width={870} height={346} sizes="(max-width: 960px) 90vw, 660px" />
            </div>
          </InView>
        </section>

        {airports.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">{t("airportsTitle")}</h2>
              <p>{t("trust2")}</p>
            </div>
            <div className="airport-list">
              {airports.map((a) => (
                <Link key={a.id} href={`/book?from=${a.code}`} className="airport-row">
                  <span className="iata">{a.iata_code}</span>
                  <span className="airport-name">{a.name}</span>
                  <Icon name="arrow" size={20} />
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="section cta-band">
          <ParallaxBg src="/images/coast.webp" className="bg" />
          <div className="inner">
            <h2>{t("ctaTitle")}</h2>
            <p>{t("ctaText")}</p>
            <Link href="/book" className="btn big on-dark">{t("ctaButton")} <Icon name="arrow" size={18} /></Link>
          </div>
        </section>

        <section className="section faq" id="faq">
          <div>
            <h2 className="section-title">{t("faqTitle")}</h2>
            <p className="faq-lead">{t("faqLead")}</p>
          </div>
          <div>
            {([1, 2, 3, 4] as const).map((i) => (
              <details key={i}>
                <summary>{t(`faq${i}q`)}</summary>
                <p>{t(`faq${i}a`)}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
