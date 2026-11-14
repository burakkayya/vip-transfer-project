import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Alert, Badge, Button, Card, H2, Hero, IconBubble, Input, P, Picker, Row, Screen, T, colors, s, statusTone } from "@/components/ui";
import { api, upload } from "@/lib/api";
import { DOC_LABEL, DOC_STATUS, DOC_TYPES_DRIVER, DOC_TYPES_VEHICLE, DRIVER_STATUS } from "@/lib/driverLabels";
import { date } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import type { DriverDocument, DriverMe, DriverVehicle, VehicleType } from "@/lib/types";
import DriverProfileCard from "@/components/DriverProfileCard";

type DocAlert = { id: string; doc_type: string; valid_until: string; days_left: number };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PLATE_RE = /^\d{2}\s?[A-Z]{1,3}\s?\d{2,4}$/;

/** Onaylı belge oranı halkası. */
function Ring(props: { done: number; total: number }) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const p = props.total ? props.done / props.total : 0;
  return (
    <View style={{ width: 84, height: 84, alignItems: "center", justifyContent: "center" }}>
      <Svg width={84} height={84} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={42} cy={42} r={R} stroke="rgba(255,255,255,0.15)" strokeWidth={7} fill="none" />
        <Circle cx={42} cy={42} r={R} stroke={p >= 1 ? colors.okOnDark : colors.accent} strokeWidth={7} fill="none" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - p)} />
      </Svg>
      <T style={{ color: "#fff", fontWeight: "800", fontSize: 18 }}>{props.done}/{props.total}</T>
    </View>
  );
}

const DOC_ICON: Record<string, "checkmark-circle" | "time" | "close-circle" | "alert-circle"> = {
  onayli: "checkmark-circle",
  beklemede: "time",
  reddedildi: "close-circle",
  suresi_doldu: "alert-circle",
};

/** Sürücü ekranları 1, 2, 8: belge yükleme, belge durumu, süre uyarıları; araç ekleme. */
export default function DocumentsScreen() {
  const [me, setMe] = useState<DriverMe | null>(null);
  const [docs, setDocs] = useState<DriverDocument[]>([]);
  const [vehicles, setVehicles] = useState<DriverVehicle[]>([]);
  const [alerts, setAlerts] = useState<DocAlert[]>([]);
  const [types, setTypes] = useState<VehicleType[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ owner: "driver", docType: "surucu_belgesi", validUntil: "" });
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
    } catch (e) {
      setMessage({ ok: false, text: errorTextTr(e) });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const isVehicleDoc = form.owner !== "driver";
  const typeOptions = Object.entries(isVehicleDoc ? DOC_TYPES_VEHICLE : DOC_TYPES_DRIVER).map(([value, label]) => ({ value, label }));

  async function pickAndUpload() {
    if (form.validUntil && !DATE_RE.test(form.validUntil)) {
      setMessage({ ok: false, text: "Geçerlilik tarihi YYYY-AA-GG biçiminde olmalı." });
      return;
    }
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png"], copyToCacheDirectory: true });
    if (res.canceled) return;
    const file = res.assets[0];
    setBusy(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.append("doc_type", form.docType);
      if (form.validUntil) fd.append("valid_until", form.validUntil);
      if (isVehicleDoc) fd.append("vehicle_id", form.owner);
      // React Native FormData dosyayı uri/name/type nesnesiyle kabul eder.
      fd.append("file", { uri: file.uri, name: file.name, type: file.mimeType ?? "application/octet-stream" } as unknown as Blob);
      await upload("driver/documents", fd);
      setMessage({ ok: true, text: "Belge yüklendi, incelemeye alındı." });
      await load();
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
      await api("driver/vehicles", {
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
      setMessage({ ok: true, text: "Araç eklendi. Araç belgelerini yükleyin." });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: errorTextTr(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen canvas header={<Hero title="Belgeler" subtitle="Onaylı belgelerle iş almaya başlarsınız." />} refreshing={false} onRefresh={load}>
      {me && (
        <View style={{ backgroundColor: colors.ink, borderRadius: 24, padding: 20, flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Ring done={Object.keys(DOC_TYPES_DRIVER).length - me.missing_documents.length} total={Object.keys(DOC_TYPES_DRIVER).length} />
          <View style={{ flex: 1, gap: 4 }}>
            <T style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>{me.full_name}</T>
            <T style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
              {me.missing_documents.length === 0 ? "Sürücü belgeleriniz tamam." : `${me.missing_documents.length} sürücü belgesi eksik.`}
            </T>
            <View style={{ alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <T style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{DRIVER_STATUS[me.status] ?? me.status}</T>
            </View>
          </View>
        </View>
      )}
      <Alert text={message?.text ?? null} tone={message?.ok ? "ok" : "danger"} />
      {alerts.map((a) => (
        <Alert key={a.id} tone={a.days_left < 0 ? "danger" : "warn"}
          text={`${DOC_LABEL[a.doc_type] ?? a.doc_type}: ${a.days_left < 0 ? "süresi doldu" : `${a.days_left} gün kaldı`} (${date(a.valid_until)}). Yenisini yükleyin.`} />
      ))}
      {me && me.missing_documents.length > 0 && (
        <Alert tone="warn" text={`Eksik sürücü belgeleri: ${me.missing_documents.map((d) => DOC_LABEL[d] ?? d).join(", ")}`} />
      )}

      {me ? <DriverProfileCard me={me} onSaved={setMe} /> : null}

      <Card>
        <Row gap={12}>
          <IconBubble name="cloud-upload-outline" dark />
          <H2>Belge yükle</H2>
        </Row>
        <Picker
          label="Belge sahibi"
          placeholder="Seçin"
          value={form.owner}
          options={[{ value: "driver", label: "Ben (sürücü)" }, ...vehicles.map((v) => ({ value: v.id, label: `Araç ${v.plate}` }))]}
          onChange={(owner) => setForm({ owner, docType: owner === "driver" ? "surucu_belgesi" : "arac_ruhsati", validUntil: form.validUntil })}
        />
        <Picker label="Belge türü" placeholder="Seçin" value={form.docType} options={typeOptions} onChange={(docType) => setForm({ ...form, docType })} />
        <Input label="Geçerlilik bitişi (varsa)" placeholder="2027-12-31" value={form.validUntil}
          onChangeText={(validUntil) => setForm({ ...form, validUntil })} keyboardType="numbers-and-punctuation" />
        <P muted small>PDF, JPEG veya PNG, en fazla 10 MB. Belgeler şifreli saklanır.</P>
        <Button title="Dosya seç ve yükle" onPress={pickAndUpload} busy={busy} />
      </Card>

      <H2>Belgelerim</H2>
      {docs.length === 0 && <P muted>Henüz belge yüklenmedi.</P>}
      {docs.length > 0 && (
        <Card style={{ paddingVertical: 6 }}>
          {docs.map((d, i) => (
            <View key={d.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
              <Ionicons name={DOC_ICON[d.status] ?? "document"} size={26}
                color={d.status === "onayli" ? colors.ok : d.status === "beklemede" ? colors.warn : colors.danger} />
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: "600" }}>{DOC_LABEL[d.doc_type] ?? d.doc_type}</T>
                <T style={s.hint}>
                  {d.owner_type === "vehicle" ? `Araç ${vehicles.find((v) => v.id === d.owner_id)?.plate ?? ""} · ` : ""}
                  Geçerlilik: {date(d.valid_until)} · Yüklenme: {date(d.created_at)}
                </T>
              </View>
              <Badge text={DOC_STATUS[d.status] ?? d.status} tone={statusTone(d.status)} />
            </View>
          ))}
        </Card>
      )}

      <H2>Araçlarım</H2>
      {vehicles.map((v) => (
        <Card key={v.id}>
          <Row spread>
            <Row gap={10}>
              <View style={{ borderWidth: 1.5, borderColor: colors.ink, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 }}>
                <T style={{ fontWeight: "800", letterSpacing: 1, fontSize: 13 }}>{v.plate}</T>
              </View>
              <P bold>{v.brand} {v.model}</P>
            </Row>
            <Badge text={v.status} tone={statusTone(v.status)} />
          </Row>
          {v.missing_documents.length > 0 && (
            <P small muted>Eksik: {v.missing_documents.map((d) => DOC_LABEL[d] ?? d).join(", ")}</P>
          )}
        </Card>
      ))}
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
        <Button title="Aracı ekle" variant="secondary" onPress={addVehicle} busy={busy}
          disabled={!PLATE_RE.test(vehicle.plate.toUpperCase().trim()) || !vehicle.brand.trim() || !vehicle.model.trim()} />
      </Card>
    </Screen>
  );
}
