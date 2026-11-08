"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import CustomerForm, { type StaffCustomer } from "@/components/CustomerForm";
import PlaceInput, { placeBody, type PlaceValue, type Region } from "@/components/PlaceInput";
import { useCan } from "@/components/Shell";
import { ErrorBox, Field, Msg, PageHead, Select, useAction, useData } from "@/components/ui";
import { ApiError, api, errorMessage, withQuery } from "@/lib/api";
import { dt, localToIso, money } from "@/lib/format";
import { BOOKING_CHANNEL, BOOKING_TYPE, LOCALE, MANUAL_PAYMENT_METHOD } from "@/lib/labels";

interface Catalog {
  regions: Region[];
  vehicle_types: { code: string; name: string; capacity: number; luggage_capacity: number }[];
  default_payment_hours: number;
  max_payment_hours: number;
}

interface QuoteRow {
  vehicle_type_code: string;
  error?: string;
  message?: string;
  quote?: { total: string; price: string; currency: string; legs: { distance_km: string; duration_minutes: number }[] };
}

interface Created {
  booking: { id: string; booking_code: string; status: string; total_amount: string; currency: string };
  manual: { pay_url: string; share_text: string; payment_due_at: string | null };
}

const PAYMENT_HOURS: Record<string, string> = { "2": "2 saat", "6": "6 saat", "12": "12 saat", "24": "24 saat", "48": "48 saat", "72": "72 saat" };

/** K-54: WhatsApp, telefon vb. kanaldan gelen müşteri için manuel rezervasyon. */
export default function NewBookingPage() {
  const can = useCan();
  const catalog = useData<Catalog>("admin/booking-catalog");

  // 1. Müşteri
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState<StaffCustomer | null>(null);
  const [lookup, setLookup] = useState<"idle" | "missing">("idle");
  const [lookupError, setLookupError] = useState<string | null>(null);

  // 2. Yolculuk
  const [type, setType] = useState("planli");
  const [pickup, setPickup] = useState<PlaceValue | null>(null);
  const [dropoff, setDropoff] = useState<PlaceValue | null>(null);
  const [pickupAt, setPickupAt] = useState("");
  const [returnAt, setReturnAt] = useState("");
  const [pax, setPax] = useState("2");
  const [luggage, setLuggage] = useState("2");
  const [flight, setFlight] = useState("");

  // 3. Fiyat
  const [quotes, setQuotes] = useState<QuoteRow[] | null>(null);
  const [quotedKey, setQuotedKey] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [override, setOverride] = useState(false);
  const [overrideTotal, setOverrideTotal] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  // 4. Yolcu, kanal, ödeme, onay
  const [passenger, setPassenger] = useState("");
  const [note, setNote] = useState("");
  const [locale, setLocale] = useState("tr");
  const [channel, setChannel] = useState("whatsapp");
  const [payMode, setPayMode] = useState<"link" | "paid">("link");
  const [hours, setHours] = useState("24");
  const [sms, setSms] = useState(true);
  const [method, setMethod] = useState("havale");
  const [reference, setReference] = useState("");
  const [consent, setConsent] = useState(false);

  const quoteAction = useAction();
  const submitAction = useAction();
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const instant = type === "anlik";
  const trip = useMemo(() => {
    if (!pickup || !dropoff || (!instant && !pickupAt)) return null;
    return {
      pickup: placeBody(pickup),
      dropoff: placeBody(dropoff),
      return_pickup_at: !instant && returnAt ? localToIso(returnAt) : null,
      passenger_count: Number(pax) || 1,
      luggage_count: Number(luggage) || 0,
      country_code: customer?.country_code ?? null,
    };
  }, [pickup, dropoff, instant, pickupAt, returnAt, pax, luggage, customer]);
  const tripKey = JSON.stringify([trip, instant ? "now" : pickupAt]);
  const stale = quotes !== null && quotedKey !== tripKey;
  const selected = quotes?.find((q) => q.vehicle_type_code === vehicle && q.quote)?.quote ?? null;
  const total = override && overrideTotal ? overrideTotal : selected?.total ?? "";

  function chooseCustomer(c: StaffCustomer) {
    setCustomer(c);
    setLookup("idle");
    // Telefonla bulunan müşterinin adı maskeli gelir (ekran 14); yolcu adı yalnızca yeni eklenen müşteride doldurulur.
    const name = c.full_name && !c.full_name.endsWith("***") ? c.full_name : "";
    setPassenger((p) => p || name);
    setLocale(c.locale in LOCALE ? c.locale : "en");
    setQuotes(null);
  }

  async function findCustomer(p = phone) {
    setLookupError(null);
    try {
      chooseCustomer(await api<StaffCustomer>(withQuery("admin/customers/lookup", { phone: p.trim() })));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setLookup("missing");
      else setLookupError(errorMessage(e));
    }
  }

  function pickupIso(): string | null {
    // Anlık işte alış zamanı "şimdi"dir (backend en fazla 30 dk sonrasını kabul eder).
    return instant ? new Date().toISOString() : localToIso(pickupAt);
  }

  async function calculate() {
    if (!trip) return;
    const ok = await quoteAction.run(async () => {
      const rows = await api<QuoteRow[]>("admin/quotes", { body: { ...trip, pickup_at: pickupIso() } });
      setQuotes(rows);
      setQuotedKey(tripKey);
      if (!rows.some((r) => r.vehicle_type_code === vehicle && r.quote)) setVehicle(rows.find((r) => r.quote)?.vehicle_type_code ?? "");
    });
    if (!ok) setQuotes(null);
  }

  async function submit() {
    if (!trip || !customer || !selected) return;
    let result: Created | null = null;
    const ok = await submitAction.run(async () => {
      try {
        result = await api<Created>("admin/bookings", {
          body: {
            ...trip,
            pickup_at: pickupIso(),
            customer_id: customer.id,
            vehicle_type_code: vehicle,
            booking_type: type,
            expected_total: selected.total,
            override_total: override && overrideTotal ? overrideTotal : null,
            override_reason: override ? overrideReason.trim() : null,
            passenger_name: passenger.trim(),
            note: note.trim() || null,
            flights: flight.trim() ? [{ leg_order: 1, flight_no: flight.trim() }] : [],
            locale,
            channel,
            consent_confirmed: consent,
            payment_hours: Number(hours),
            send_sms: sms,
            payment: payMode === "paid" ? { method, amount: total, reference: reference.trim() || null } : null,
          },
        });
      } catch (e) {
        if (e instanceof ApiError && e.code === "price_changed") {
          setQuotes(null);
          throw new ApiError(e.status, e.code, "Fiyat bu arada değişti. Fiyatları yeniden hesaplayın.");
        }
        throw e;
      }
    });
    if (ok && result) setCreated(result);
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  }

  if (!can("operasyon")) return <p className="alert error">Manuel rezervasyon için operasyon yetkisi gerekir.</p>;
  if (!catalog.data) return <ErrorBox error={catalog.error} />;

  if (created) {
    const c = created;
    return (
      <div className="stack">
        <PageHead title={`Rezervasyon oluşturuldu: ${c.booking.booking_code}`}>
          <Link href={`/bookings/${c.booking.id}`} className="btn">Detaya git</Link>
          <button className="btn secondary" type="button" onClick={() => window.location.assign("/bookings/new")}>
            Yeni rezervasyon
          </button>
        </PageHead>
        <div className="card stack">
          <p>
            Tutar <strong>{money(c.booking.total_amount, c.booking.currency)}</strong>.{" "}
            {c.booking.status === "odeme_bekliyor"
              ? <>Ödeme bekleniyor; son ödeme {dt(c.manual.payment_due_at)}. Süre dolarsa rezervasyon kendiliğinden iptal olur.</>
              : <>Ödeme kaydedildi, rezervasyon onaylandı. Müşteriye onay SMS&apos;i gönderildi.</>}
          </p>
          {c.booking.status === "odeme_bekliyor" && (
            <Field label="Ödeme bağlantısı" hint="Müşteri açınca telefonuna gelen SMS koduyla girer ve kartla öder">
              <div className="row">
                <input readOnly value={c.manual.pay_url} className="mono" style={{ flex: 1 }} />
                <button className="btn secondary" type="button" onClick={() => void copy(c.manual.pay_url, "link")}>Kopyala</button>
              </div>
            </Field>
          )}
          <Field label="WhatsApp'a yapıştırılacak metin">
            <textarea readOnly rows={8} value={c.manual.share_text} />
          </Field>
          <div className="row">
            <button className="btn" type="button" onClick={() => void copy(c.manual.share_text, "metin")}>Metni kopyala</button>
            {copied && <span className="muted" role="status">Kopyalandı ({copied}).</span>}
          </div>
        </div>
      </div>
    );
  }

  const canQuote = Boolean(customer && trip && (instant || pickupAt));
  const canSubmit = Boolean(
    customer && selected && !stale && passenger.trim().length >= 2 && consent &&
    (!override || (overrideTotal && overrideReason.trim().length >= 3)),
  );

  return (
    <div className="stack">
      <PageHead title="Yeni rezervasyon (admin girişi)">
        <Link href="/bookings" className="btn secondary small">Listeye dön</Link>
      </PageHead>
      <p className="muted">
        WhatsApp, telefon veya e-postayla ulaşan ve uygulamayı kullanmayan müşteri için. Fiyat sitedeki kurallarla hesaplanır.
      </p>

      <section className="card stack" aria-labelledby="s-customer">
        <h2 id="s-customer">1. Müşteri</h2>
        {customer ? (
          <div className="row spread">
            <div>
              <strong>{customer.full_name ?? "—"}</strong> <span className="mono">{customer.phone}</span>
              <div className="hint">
                {customer.country_code ?? "Ülke yok"} · {customer.currency} · {LOCALE[customer.locale] ?? customer.locale}
                {" · "}{customer.verified ? "Telefon doğrulanmış" : "Henüz SMS koduyla giriş yapmadı"}
              </div>
            </div>
            <button className="btn secondary small" type="button" onClick={() => { setCustomer(null); setQuotes(null); }}>
              Değiştir
            </button>
          </div>
        ) : (
          <>
            <form className="row end" onSubmit={(e) => { e.preventDefault(); void findCustomer(); }}>
              <Field label="Telefon (tam numara)" hint="Uluslararası biçimde: +4915112345678">
                <input value={phone} inputMode="tel" placeholder="+90..." onChange={(e) => { setPhone(e.target.value); setLookup("idle"); }} />
              </Field>
              <button className="btn" type="submit" disabled={phone.trim().length < 6}>Müşteriyi bul</button>
            </form>
            <ErrorBox error={lookupError} />
            {lookup === "missing" && (
              <div className="stack">
                <p className="alert info">Bu numarayla müşteri yok. Bilgileri girip ekleyin.</p>
                <CustomerForm initialPhone={phone} onCreated={chooseCustomer}
                  onExisting={(p) => { setPhone(p); void findCustomer(p); }} submitLabel="Müşteriyi ekle ve seç" />
              </div>
            )}
          </>
        )}
      </section>

      <section className="card stack" aria-labelledby="s-trip">
        <h2 id="s-trip">2. Yolculuk</h2>
        <div className="row end">
          <Field label="Tür" hint={instant ? "Alış zamanı şimdi; ödeme gelince yakın sürücülere teklif gider" : "En az 2 saat sonrası"}>
            <Select value={type} onChange={setType} options={BOOKING_TYPE} />
          </Field>
          {!instant && (
            <>
              <Field label="Alış zamanı (Türkiye saati)">
                <input type="datetime-local" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} />
              </Field>
              <Field label="Dönüş (isteğe bağlı)" hint="Doluysa gidiş-dönüş, %5 indirim">
                <input type="datetime-local" value={returnAt} onChange={(e) => setReturnAt(e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Yolcu">
            <input type="number" min={1} max={50} value={pax} onChange={(e) => setPax(e.target.value)} />
          </Field>
          <Field label="Bagaj">
            <input type="number" min={0} max={50} value={luggage} onChange={(e) => setLuggage(e.target.value)} />
          </Field>
          <Field label="Uçuş no (isteğe bağlı)">
            <input value={flight} maxLength={10} placeholder="TK2412" onChange={(e) => setFlight(e.target.value.toUpperCase())} />
          </Field>
        </div>
        <div className="grid cols-2">
          <PlaceInput label="Alış noktası" regions={catalog.data.regions} value={pickup} onChange={setPickup} />
          <PlaceInput label="Varış noktası" regions={catalog.data.regions} value={dropoff} onChange={setDropoff} />
        </div>
      </section>

      <section className="card stack" aria-labelledby="s-price">
        <h2 id="s-price">3. Araç ve fiyat</h2>
        <div className="row">
          <button className="btn" type="button" disabled={!canQuote || quoteAction.busy} onClick={() => void calculate()}>
            {quotes ? "Fiyatları yeniden hesapla" : "Fiyatları hesapla"}
          </button>
          {!customer && <span className="muted">Önce müşteriyi seçin (para birimi müşterinin ülkesinden).</span>}
          {stale && <span className="alert info" role="status">Yolculuk bilgisi değişti, fiyatları yeniden hesaplayın.</span>}
        </div>
        <Msg message={quoteAction.message} />
        {quotes && (
          <div className="stack" role="radiogroup" aria-label="Araç tipi">
            {quotes.map((q) => {
              const vt = catalog.data!.vehicle_types.find((v) => v.code === q.vehicle_type_code);
              return (
                <label key={q.vehicle_type_code} className={`check option${q.quote ? "" : " disabled"}`}>
                  <input type="radio" name="vehicle" disabled={!q.quote} checked={vehicle === q.vehicle_type_code}
                    onChange={() => setVehicle(q.vehicle_type_code)} />
                  <span style={{ flex: 1 }}>
                    <strong>{vt?.name ?? q.vehicle_type_code}</strong>{" "}
                    <span className="hint">{vt ? `${vt.capacity} yolcu, ${vt.luggage_capacity} bagaj` : ""}</span>
                  </span>
                  {q.quote
                    ? <strong>{money(q.quote.total, q.quote.currency)}</strong>
                    : <span className="muted">{q.error === "luggage_exceeded" ? "Bagaj sığmıyor" : "Kapasite yetmiyor"}</span>}
                </label>
              );
            })}
            {selected && (
              <p className="hint">
                {selected.legs.map((l, i) => `${i ? "Dönüş" : "Gidiş"} ${Number(l.distance_km).toFixed(0)} km, ~${l.duration_minutes} dk`).join(" · ")}
              </p>
            )}
          </div>
        )}
        {selected && (
          <div className="stack">
            <label className="check">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Fiyatı değiştir (indirim, özel anlaşma)
            </label>
            {override && (
              <div className="row end">
                <Field label={`Yeni toplam (${selected.currency})`} hint={`Sistem fiyatı ${money(selected.total, selected.currency)}`}>
                  <input type="number" min={1} step="0.01" value={overrideTotal} onChange={(e) => setOverrideTotal(e.target.value)} />
                </Field>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <Field label="Gerekçe (zorunlu, denetim kaydına yazılır)">
                    <input value={overrideReason} maxLength={500} onChange={(e) => setOverrideReason(e.target.value)} />
                  </Field>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="s-details">
        <h2 id="s-details">4. Yolcu ve kanal</h2>
        <div className="row end">
          <Field label="Yolcu adı (sürücüye gösterilir)">
            <input value={passenger} minLength={2} maxLength={120} onChange={(e) => setPassenger(e.target.value)} />
          </Field>
          <Field label="Talebin geldiği kanal">
            <Select value={channel} onChange={setChannel} options={BOOKING_CHANNEL} />
          </Field>
          <Field label="Dil" hint="SMS ve paylaşım metni">
            <Select value={locale} onChange={setLocale} options={LOCALE} />
          </Field>
        </div>
        <Field label="Not (isteğe bağlı, sürücüye gösterilir)">
          <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </section>

      <section className="card stack" aria-labelledby="s-pay">
        <h2 id="s-pay">5. Ödeme</h2>
        <div className="stack" role="radiogroup" aria-label="Ödeme şekli">
          <label className="check">
            <input type="radio" checked={payMode === "link"} onChange={() => setPayMode("link")} />
            Ödeme bağlantısı gönder (müşteri kartla öder)
          </label>
          <label className="check">
            <input type="radio" checked={payMode === "paid"} onChange={() => setPayMode("paid")} />
            Ödeme alındı (havale, nakit, POS)
          </label>
        </div>
        {payMode === "link" ? (
          <div className="row end">
            <Field label="Ödeme süresi" hint="Alıştan en geç 1 saat öncesine kısalır; süre dolarsa iptal">
              <Select value={hours} onChange={setHours} options={PAYMENT_HOURS} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} />
              Müşteriye ödeme bağlantısını SMS ile gönder
            </label>
          </div>
        ) : (
          <div className="row end">
            <Field label="Yöntem">
              <Select value={method} onChange={setMethod} options={MANUAL_PAYMENT_METHOD} />
            </Field>
            <Field label="Tutar">
              <input readOnly value={total ? money(total, selected?.currency ?? "EUR") : "—"} />
            </Field>
            <Field label="Dekont / makbuz no (isteğe bağlı)">
              <input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="s-confirm">
        <h2 id="s-confirm">6. Onay</h2>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Müşteriye KVKK aydınlatma metni, mesafeli satış ön bilgilendirmesi ve iptal koşulları iletildi; onayı alındı.
        </label>
        <Msg message={submitAction.message} />
        <div className="row">
          <button className="btn" type="button" disabled={!canSubmit || submitAction.busy} onClick={() => void submit()}>
            {payMode === "paid" ? "Rezervasyonu oluştur ve onayla" : "Rezervasyonu oluştur"}
          </button>
          {total && selected && <span className="muted">Toplam {money(total, selected.currency)}</span>}
        </div>
      </section>
    </div>
  );
}
