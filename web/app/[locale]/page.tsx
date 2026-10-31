import { getTranslations, setRequestLocale } from "next-intl/server";
import FleetCard from "@/components/FleetCard";
import Icon from "@/components/Icon";
import { CountUp, DriveIn, HeroMedia, ParallaxBg, Reveal, SmoothScroll, StepBar, WordsIn } from "@/components/Motion";
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

export default async function Home({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const [regions, vehicleTypes] = await Promise.all([getRegions(), getVehicleTypes()]);
  const airports = regions.filter((r) => r.type === "havalimani");
  const districts = regions.filter((r) => r.type === "ilce");
  const trust = [
    { i: 1, icon: "shield" },
    { i: 3, icon: "plane" },
    { i: 2, icon: "user" },
    { i: 4, icon: "refund" },
  ] as const;
  const colorLabels = { white: t("colorWhite"), black: t("colorBlack") };

  return (
    <>
      <SmoothScroll />
      <section className="hero">
        <HeroMedia src="/images/hero-airport.webp" mobileSrc="/images/hero-airport-mobile.webp" alt="" />
        <div className="container hero-inner">
          <div className="hero-copy">
            <Reveal y={12}>
              <span className="chip"><span className="live-dot" /> {t("heroBadge")}</span>
            </Reveal>
            <h1><WordsIn text={t("heroTitle")} delay={0.1} /></h1>
            <Reveal delay={0.45}>
              <p className="lead">{t("heroText")}</p>
            </Reveal>
            <Reveal delay={0.6}>
              <ul className="hero-stats">
                {airports.length > 0 && <li><strong><CountUp value={airports.length} /></strong><span>{t("statAirports")}</span></li>}
                {districts.length > 0 && <li><strong><CountUp value={districts.length} /></strong><span>{t("statDistricts")}</span></li>}
                <li><strong><CountUp value={48} suffix={t("statHoursUnit")} /></strong><span>{t("statCancel")}</span></li>
              </ul>
            </Reveal>
          </div>
          <Reveal delay={0.25} y={40}>
            <div className="hero-card" id="quote">
              <h2 className="hero-card-title">{t("cardTitle")}</h2>
              <p className="hero-card-sub">{t("cardText")}</p>
              <TripForm regions={regions} initial={emptyTrip()} />
            </div>
          </Reveal>
        </div>
        <div className="flight-tag" aria-hidden>
          <Icon name="plane" size={18} /> <span>{t("flightTag")}</span>
        </div>
      </section>

      <div className="container">
        <div className="trust-strip">
          {trust.map(({ i, icon }, n) => (
            <Reveal key={i} delay={n * 0.08}>
              <div className="trust-item">
                <span className="ico"><Icon name={icon} size={20} /></span>
                <div>
                  <h3>{t(`why${i}Title`)}</h3>
                  <p>{t(`why${i}Text`)}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <section className="section" id="services">
          <Reveal className="section-head">
            <div>
              <span className="eyebrow">{t("servicesEyebrow")}</span>
              <h2 className="section-title">{t("servicesTitle")}</h2>
            </div>
            <p>{t("servicesLead")}</p>
          </Reveal>
          <div className="services">
            {SERVICES.map((s, n) => (
              <Reveal key={s.key} delay={n * 0.08}>
                <Link href={s.to} className="service">
                  <img src={s.image} alt="" loading="lazy" width={960} height={720} />
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
              <div>
                <span className="eyebrow">{t("fleetEyebrow")}</span>
                <h2 className="section-title">{t("fleetTitle")}</h2>
              </div>
              <p>{t("fleetLead")}</p>
            </Reveal>
            <div className="fleet">
              {vehicleTypes.map((vt, n) => (
                <Reveal key={vt.code} delay={n * 0.1}>
                  <FleetCard
                    code={vt.code}
                    name={vt.name}
                    capacity={vt.capacity}
                    luggage={vt.luggage_capacity}
                    tag={vt.code === "vip_van" ? "VIP" : undefined}
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
          <Reveal className="section-head">
            <div>
              <span className="eyebrow">{t("howEyebrow")}</span>
              <h2 className="section-title">{t("howTitle")}</h2>
            </div>
            <p>{t("howLead")}</p>
          </Reveal>
          <ol className="steps-row">
            {(["how1", "how2", "how3"] as const).map((k, i) => (
              <Reveal key={k} as="li" delay={i * 0.12}>
                <div className="step">
                  <span className="step-num">0{i + 1}</span>
                  <StepBar delay={0.2 + i * 0.25} />
                  <p>{t(k)}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </section>

        <section className="section feature-band">
          <Reveal>
            <span className="eyebrow">{t("groupEyebrow")}</span>
            <h2>{t("groupTitle")}</h2>
            <p>{t("groupText")}</p>
            <ul>
              {(["group1", "group2", "group3", "group4"] as const).map((k) => (
                <li key={k}><Icon name="check" size={18} /> {t(k)}</li>
              ))}
            </ul>
            <Link href="/book" className="btn big on-dark">{t("ctaButton")} <Icon name="arrow" size={18} /></Link>
          </Reveal>
          <div className="drive-stage">
            <span className="capacity-pill"><Icon name="users" size={16} /> {t("groupPill")}</span>
            <span className="glow" aria-hidden />
            <span className="road" aria-hidden />
            <DriveIn src="/images/vito-side.webp" alt={t("groupImageAlt")} />
          </div>
        </section>

        {airports.length > 0 && (
          <section className="section">
            <Reveal className="section-head">
              <div>
                <span className="eyebrow">{t("airportsEyebrow")}</span>
                <h2 className="section-title">{t("airportsTitle")}</h2>
              </div>
              <p>{t("trust2")}</p>
            </Reveal>
            <div className="airport-list">
              {airports.map((a, n) => (
                <Reveal key={a.id} delay={n * 0.06}>
                  <Link href={`/book?from=${a.code}`} className="airport-row">
                    <span className="iata">{a.iata_code}</span>
                    <span>{a.name}</span>
                    <Icon name="arrow" size={20} />
                  </Link>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        <section className="section cta-band">
          <ParallaxBg src="/images/coast.webp" className="bg" />
          <Reveal className="inner">
            <h2>{t("ctaTitle")}</h2>
            <p>{t("ctaText")}</p>
            <Link href="/book" className="btn big on-dark">{t("ctaButton")} <Icon name="arrow" size={18} /></Link>
          </Reveal>
        </section>

        <section className="section faq" id="faq">
          <Reveal>
            <span className="eyebrow">{t("faqEyebrow")}</span>
            <h2 className="section-title" style={{ marginTop: 14 }}>{t("faqTitle")}</h2>
            <p className="muted" style={{ marginTop: 16 }}>{t("faqLead")}</p>
          </Reveal>
          <div>
            {([1, 2, 3, 4] as const).map((i) => (
              <Reveal key={i} delay={i * 0.05}>
                <details>
                  <summary>{t(`faq${i}q`)}</summary>
                  <p>{t(`faq${i}a`)}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
