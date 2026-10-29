import { getTranslations, setRequestLocale } from "next-intl/server";
import Icon, { vehicleIcon } from "@/components/Icon";
import TripForm from "@/components/TripForm";
import { Link } from "@/i18n/navigation";
import { getRegions, getVehicleTypes } from "@/lib/server";
import { emptyTrip } from "@/lib/trip";
import { vehicleImage } from "@/lib/vehicles";

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
  const trust = [
    { i: 1, icon: "shield" },
    { i: 3, icon: "plane" },
    { i: 2, icon: "user" },
    { i: 4, icon: "refund" },
  ] as const;

  return (
    <>
      <div className="container hero-wrap">
        <section className="hero" style={{ backgroundImage: "url(/images/hero.webp)" }}>
          <div className="hero-copy">
            <span className="eyebrow">{t("heroBadge")}</span>
            <h1>{t("heroTitle")}</h1>
            <p className="lead">{t("heroText")}</p>
          </div>
          <div className="hero-card">
            <TripForm regions={regions} initial={emptyTrip()} />
          </div>
        </section>

        <div className="trust-strip">
          {trust.map(({ i, icon }) => (
            <div key={i}>
              <h3><Icon name={icon} size={18} /> {t(`why${i}Title`)}</h3>
              <p>{t(`why${i}Text`)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="container">
        <section className="section" id="services">
          <div className="section-head">
            <h2 className="section-title">{t("servicesTitle")}</h2>
            <p>{t("servicesLead")}</p>
          </div>
          <div className="services">
            {SERVICES.map((s) => (
              <article key={s.key} className="service">
                <img src={s.image} alt="" loading="lazy" width={960} height={720} />
                <div>
                  <h3>{t(`${s.key}Title`)}</h3>
                  <p>{t(`${s.key}Text`)}</p>
                  <Link href={s.to} className="text-link">{t("bookThis")} <Icon name="arrow" size={16} /></Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        {vehicleTypes.length > 0 && (
          <section className="section" id="fleet">
            <div className="section-head">
              <h2 className="section-title">{t("fleetTitle")}</h2>
              <p>{t("fleetLead")}</p>
            </div>
            <div className="fleet">
              {vehicleTypes.map((vt) => {
                const img = vehicleImage(vt.code);
                return (
                  <Link key={vt.code} href="/book" className="fleet-card" aria-label={`${vt.name} · ${t("fleetCta")}`}>
                    <div className="media">
                      {img ? (
                        <img src={img} alt={vt.name} loading="lazy" width={960} height={600} />
                      ) : (
                        <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
                          <Icon name={vehicleIcon(vt.code)} size={56} />
                        </div>
                      )}
                    </div>
                    <h3>{vt.name}</h3>
                    <p className="specs">
                      <span><Icon name="users" size={15} /> {vt.capacity}</span>
                      <span><Icon name="bag" size={15} /> {vt.luggage_capacity}</span>
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">{t("howTitle")}</h2>
            <p>{t("howLead")}</p>
          </div>
          <ol className="steps-row">
            {(["how1", "how2", "how3"] as const).map((k, i) => (
              <li key={k}>
                <span className="step-num">0{i + 1}</span>
                <p>{t(k)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="section feature-band">
          <div>
            <span className="eyebrow">{t("fleetTitle")}</span>
            <h2>{t("groupTitle")}</h2>
            <p className="muted">{t("groupText")}</p>
            <ul>
              {(["group1", "group2", "group3", "group4"] as const).map((k) => (
                <li key={k}><Icon name="check" size={18} /> {t(k)}</li>
              ))}
            </ul>
            <Link href="/book" className="btn big">{t("ctaButton")} <Icon name="arrow" size={18} /></Link>
          </div>
          <img src="/images/group.webp" alt="" loading="lazy" width={1200} height={760} />
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
                  <span>{a.name}</span>
                  <Icon name="arrow" size={20} />
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="section faq" id="faq">
          <div>
            <h2 className="section-title">{t("faqTitle")}</h2>
            <p className="muted">{t("faqLead")}</p>
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
