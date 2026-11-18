import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import DriverProfileCard from "@/components/DriverProfileCard";
import { DocRow, PhotoSlot, latest } from "@/components/DriverDocs";
import { PROVINCE } from "@/components/AddressField";
import { Alert, Badge, Button, Card, H2, Hero, IconBubble, Input, P, Picker, Row, Screen, Segmented, T, colors, onDark, statusTone } from "@/components/ui";
import { api } from "@/lib/api";
import { DOC_LABEL, DOC_TYPES_DRIVER, DRIVER_STATUS, VEHICLE_PHOTOS } from "@/lib/driverLabels";
import { date } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import type { DriverDocument, DriverMe, DriverVehicle, VehicleType } from "@/lib/types";

type DocAlert = { id: string; doc_type: string; valid_until: string; days_left: number };
type Tab = "driver" | "vehicle";
const PLATE_RE = /^\d{2}\s?[A-Z]{1,3}\s?\d{2,4}$/;
const VEHICLE_DOCS: Record<string, string> = {
  arac_ruhsati: "Araç ruhsatı",
  arac_muayene: "Muayene raporu",
  arac_sigortasi: "Kasko ve zorunlu trafik sigortası",
};
const VEHICLE_STATUS: Record<string, string> = { beklemede: "Onay bekliyor", aktif: "Aktif", pasif: "Pasif" };

/** Tamamlanan zorunlu belge oranı halkası. */
function Ring(props: { done: number; total: number }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const p = props.total ? props.done / props.total : 0;
  return (
    <View style={{ width: 76, height: 76, alignItems: "center", justifyContent: "center" }}>
      <Svg width={76} height={76} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={38} cy={38} r={R} stroke={onDark.line} strokeWidth={6} fill="none" />
        <Circle cx={38} cy={38} r={R} stroke={p >= 1 ? colors.okOnDark : colors.accent} strokeWidth={6} fill="none" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - p)} />
      </Svg>
      <T style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{props.done}/{props.total}</T>
    </View>
  );
}

/**
 * K-78 sürücü ekranı: "Sürücü detayları" (iletişim, çalışılan il, kişisel belgeler, profil) ve "Araç detayları"
 * (araç bilgisi, dört fotoğraf, ruhsat, muayene, sigorta). Her belge admin onayına gider; onaylı ve geçerli
 * belgelerle iş alınır.
 */
export default function DocumentsScreen() {
  const [tab, setTab] = useState<Tab>("driver");
  const [me, setMe] = useState<DriverMe | null>(null);
  const [docs, setDocs] = useState<DriverDocument[]>([]);
  const [vehicles, setVehicles] = useState<DriverVehicle[]>([]);
  const [alerts, setAlerts] = useState<DocAlert[]>([]);
  const [types, setTypes] = useState<VehicleType[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState<{ whatsapp: string; province: string } | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [vehicle, setVehicle] = useState({ plate: "", type: "minivan", brand: "", model: "", year: "", capacity: "6", color: "" });

  const load = useCallback(async () => {
    try {
      const [m, d, v, a, vt] = await Promise.all([
        api<DriverMe>("driver/me"),
        api<DriverDocument[]>("driver/documents"),
        api<DriverVehicle[]>("driver/vehicles"),
        api<DocAlert[]>("driver/document-alerts"),
        api<VehicleType[]>("vehicle-types"),
      ]);
      setMe(m);
      setDocs(d);
      setVehicles(v);
      setAlerts(a);
      setTypes(vt);
      setContact((c) => c ?? { whatsapp: m.whatsapp_phone ?? "", province: m.operating_province ?? "" });
      setVehicleId((cur) => (cur && v.some((x) => x.id === cur) ? cur : v[0]?.id ?? null));
    } catch (e) {
      setMessage({ ok: false, text: errorTextTr(e) });
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const uploaded = useCallback((text: string) => {
    setMessage({ ok: true, text });
    void load();
  }, [load]);

  // Sabit liste + sunucunun eksik dediği başka türler (admin zorunlu listeyi değiştirirse satırı görünsün).
  const required = useMemo(() => {
    const base = Object.keys(DOC_TYPES_DRIVER).filter((k) => !["src_belgesi", "turizm_tasimacilik_yetki"].includes(k));
    return [...base, ...(me?.missing_documents ?? []).filter((k) => !base.includes(k))];
  }, [me]);
  const current = vehicles.find((v) => v.id === vehicleId) ?? null;
  const vehicleDocs = useMemo(() => {
    const base = Object.keys(VEHICLE_DOCS);
    const extra = (current?.missing_documents ?? []).filter((k) => !base.includes(k) && !(k in VEHICLE_PHOTOS));
    return [...base, ...extra];
  }, [current]);
  const vehicleRequired = Object.keys(VEHICLE_PHOTOS).length + vehicleDocs.length;

  async function saveContact() {
    if (!contact) return;
    setBusy(true);
    setMessage(null);
    try {
      setMe(await api<DriverMe>("driver/me/contact", {
        method: "PUT",
        body: { whatsapp_phone: contact.whatsapp.trim() || null, operating_province: contact.province || null },
      }));
      setMessage({ ok: true, text: "Sürücü detayları kaydedildi." });
    } catch (e) {
      setMessage({ ok: false, text: errorTextTr(e) });
    } finally {
      setBusy(false);
    }
  }

  async function addVehicle() {
    setBusy(true);
    setMessage(null);
    try {
      const v = await api<DriverVehicle>("driver/vehicles", {
        body: {
          plate: vehicle.plate.toUpperCase().trim(),
          vehicle_type_code: vehicle.type,
          brand: vehicle.brand.trim(),
          model: vehicle.model.trim(),
          year: vehicle.year ? Number(vehicle.year) : null,
          capacity: Number(vehicle.capacity),
          color: vehicle.color.trim() || null,
        },
      });
      setVehicle({ plate: "", type: "minivan", brand: "", model: "", year: "", capacity: "6", color: "" });
      setAdding(false);
      setVehicleId(v.id);
      setMessage({ ok: true, text: "Araç eklendi. Fotoğrafları ve belgeleri yükleyin." });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: errorTextTr(e) });
    } finally {
      setBusy(false);
    }
  }

  const driverDone = me ? required.length - me.missing_documents.filter((d) => required.includes(d)).length : 0;
  const vehicleDone = current ? Math.max(0, vehicleRequired - current.missing_documents.length) : 0;

  return (
    <Screen canvas header={<Hero title="Belgeler" subtitle="Onaylı belgelerle iş almaya başlarsınız." />} refreshing={false} onRefresh={load}>
      {me && (
        <View style={{ backgroundColor: colors.ink, borderRadius: 24, padding: 18, flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Ring done={tab === "driver" ? driverDone : vehicleDone} total={tab === "driver" ? required.length : vehicleRequired} />
          <View style={{ flex: 1, gap: 4 }}>
            <T style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>{tab === "driver" ? me.full_name : current ? `${current.brand} ${current.model}` : "Araç ekleyin"}</T>
            <T style={{ color: onDark.muted, fontSize: 13 }}>
              {tab === "driver"
                ? me.missing_documents.length === 0 ? "Kişisel belgeleriniz tamam." : `${me.missing_documents.length} kişisel belge onay bekliyor veya eksik.`
                : current ? current.missing_documents.length === 0 ? "Araç belgeleri tamam." : `${current.missing_documents.length} araç belgesi onay bekliyor veya eksik.` : "Aracınızı ekleyip fotoğraflarını yükleyin."}
            </T>
            <View style={{ alignSelf: "flex-start", backgroundColor: onDark.fill, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <T style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
                {tab === "driver" ? DRIVER_STATUS[me.status] ?? me.status : current ? VEHICLE_STATUS[current.status] ?? current.status : "—"}
              </T>
            </View>
          </View>
        </View>
      )}

      <Segmented<Tab> value={tab} onChange={setTab}
        options={[{ value: "driver", label: "Sürücü detayları" }, { value: "vehicle", label: "Araç detayları" }]} />

      <Alert text={message?.text ?? null} tone={message?.ok ? "ok" : "danger"} />
      {alerts.map((a) => (
        <Alert key={a.id} tone={a.days_left < 0 ? "danger" : "warn"}
          text={`${DOC_LABEL[a.doc_type] ?? a.doc_type}: ${a.days_left < 0 ? "süresi doldu" : `${a.days_left} gün kaldı`} (${date(a.valid_until)}). Yenisini yükleyin.`} />
      ))}

      {tab === "driver" && me && contact && (
        <>
          <Card>
            <Row gap={12}>
              <IconBubble name="person-outline" dark />
              <H2>İletişim ve bölge</H2>
            </Row>
            <Input label="Telefon" icon="call-outline" value={me.phone ?? ""} editable={false}
              hint="Giriş numaranız; değiştirmek için destekle görüşün." />
            <Input label="WhatsApp numarası (isteğe bağlı)" icon="logo-whatsapp" placeholder="+90 5XX XXX XX XX" keyboardType="phone-pad"
              value={contact.whatsapp} onChangeText={(whatsapp) => setContact({ ...contact, whatsapp })} maxLength={20} />
            <Picker label="Çalıştığınız il" placeholder="Seçin" icon="location-outline" value={contact.province || null}
              options={Object.entries(PROVINCE).map(([value, label]) => ({ value, label }))}
              onChange={(province) => setContact({ ...contact, province })} />
            <Button title="Kaydet" variant="secondary" onPress={saveContact} busy={busy} />
          </Card>

          <Card style={{ paddingBottom: 4 }}>
            <Row gap={12}>
              <IconBubble name="id-card-outline" dark />
              <View style={{ flex: 1 }}>
                <H2>Kişisel belgeler</H2>
                <P muted small>Her belge ayrı ayrı onaylanır.</P>
              </View>
            </Row>
            {required.map((k, i) => (
              <DocRow key={k} docType={k} label={DOC_LABEL[k] ?? k} doc={latest(docs, me.id, k)}
                last={i === required.length - 1} onUploaded={uploaded} />
            ))}
          </Card>

          <DriverProfileCard me={me} onSaved={setMe} />
        </>
      )}

      {tab === "vehicle" && (
        <>
          {vehicles.length > 1 && (
            <Segmented value={vehicleId ?? ""} onChange={setVehicleId}
              options={vehicles.map((v) => ({ value: v.id, label: v.plate }))} />
          )}

          {current && (
            <>
              <Card>
                <Row spread>
                  <Row gap={10}>
                    <View style={{ borderWidth: 1.5, borderColor: colors.ink, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <T style={{ fontWeight: "800", letterSpacing: 1, fontSize: 13 }}>{current.plate}</T>
                    </View>
                    <P bold>{current.brand} {current.model}</P>
                  </Row>
                  <Badge text={VEHICLE_STATUS[current.status] ?? current.status} tone={statusTone(current.status)} />
                </Row>
                <P muted small>{types.find((t) => t.code === current.vehicle_type_code)?.name ?? current.vehicle_type_code} · {current.capacity} yolcu{current.color ? ` · ${current.color}` : ""}</P>
              </Card>

              <Card>
                <Row gap={12}>
                  <IconBubble name="images-outline" dark />
                  <View style={{ flex: 1 }}>
                    <H2>Araç fotoğrafları</H2>
                    <P muted small>Gün ışığında, aracın tamamı görünecek şekilde çekin.</P>
                  </View>
                </Row>
                <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 16 }}>
                  {Object.entries(VEHICLE_PHOTOS).map(([k, label]) => (
                    <PhotoSlot key={k} docType={k} label={label} vehicleId={current.id} doc={latest(docs, current.id, k)} onUploaded={uploaded} />
                  ))}
                </View>
              </Card>

              <Card style={{ paddingBottom: 4 }}>
                <Row gap={12}>
                  <IconBubble name="document-text-outline" dark />
                  <H2>Araç belgeleri</H2>
                </Row>
                {vehicleDocs.map((k, i, all) => (
                  <DocRow key={k} docType={k} label={DOC_LABEL[k] ?? k} vehicleId={current.id} doc={latest(docs, current.id, k)}
                    last={i === all.length - 1} onUploaded={uploaded} />
                ))}
              </Card>
            </>
          )}

          {(adding || vehicles.length === 0) ? (
            <Card>
              <H2>Araç ekle</H2>
              <Input label="Plaka" placeholder="07 ABC 123" autoCapitalize="characters" value={vehicle.plate} onChangeText={(plate) => setVehicle({ ...vehicle, plate })} />
              <Picker label="Araç tipi" placeholder="Seçin" value={vehicle.type} options={types.map((t) => ({ value: t.code, label: t.name }))}
                onChange={(type) => setVehicle({ ...vehicle, type })} />
              <Input label="Marka" value={vehicle.brand} onChangeText={(brand) => setVehicle({ ...vehicle, brand })} maxLength={50} />
              <Input label="Model" value={vehicle.model} onChangeText={(model) => setVehicle({ ...vehicle, model })} maxLength={50} />
              <Input label="Renk (yolcu aracı tanısın)" placeholder="Siyah" value={vehicle.color} onChangeText={(color) => setVehicle({ ...vehicle, color })} maxLength={30} />
              <Row>
                <Input label="Yıl" keyboardType="number-pad" value={vehicle.year} onChangeText={(year) => setVehicle({ ...vehicle, year })} style={{ minWidth: 90 }} />
                <Input label="Yolcu kapasitesi" keyboardType="number-pad" value={vehicle.capacity} onChangeText={(capacity) => setVehicle({ ...vehicle, capacity })} style={{ minWidth: 90 }} />
              </Row>
              <Button title="Aracı ekle" onPress={addVehicle} busy={busy}
                disabled={!PLATE_RE.test(vehicle.plate.toUpperCase().trim()) || !vehicle.brand.trim() || !vehicle.model.trim()} />
            </Card>
          ) : (
            <Button title="Başka araç ekle" variant="secondary" icon="add" onPress={() => setAdding(true)} />
          )}
        </>
      )}
    </Screen>
  );
}
