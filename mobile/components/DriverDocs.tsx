import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Pressable, View } from "react-native";
import AuthImage from "@/components/AuthImage";
import Ionicons from "@/components/Icon";
import { Badge, Button, Input, T, colors, s, statusTone } from "@/components/ui";
import { appendFile, upload } from "@/lib/api";
import { DOC_HINT, DOC_STATUS, EXPIRY_REQUIRED } from "@/lib/driverLabels";
import { date } from "@/lib/format";
import { errorTextTr } from "@/lib/i18n";
import type { DriverDocument } from "@/lib/types";

/** K-78: bir türün en son yüklenen belgesi (liste en yeniden eskiye gelir). */
export function latest(docs: DriverDocument[], ownerId: string, docType: string): DriverDocument | undefined {
  return docs.find((d) => d.owner_id === ownerId && d.doc_type === docType);
}

const DATE_TR = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/** "31.12.2027" → "2027-12-31"; geçersizse null. */
function isoDate(v: string): string | null {
  const m = DATE_TR.exec(v.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

function maskDate(v: string): string {
  const digits = v.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join(".");
}

type Status = "yok" | "beklemede" | "onayli" | "reddedildi" | "suresi_doldu";

const STATUS_ICON: Record<Status, "ellipse-outline" | "time" | "checkmark-circle" | "close-circle" | "alert-circle"> = {
  yok: "ellipse-outline",
  beklemede: "time",
  onayli: "checkmark-circle",
  reddedildi: "close-circle",
  suresi_doldu: "alert-circle",
};
const STATUS_COLOR: Record<Status, string> = {
  yok: colors.faint,
  beklemede: colors.warn,
  onayli: colors.ok,
  reddedildi: colors.danger,
  suresi_doldu: colors.danger,
};

async function send(docType: string, file: DocumentPicker.DocumentPickerAsset, validUntil: string | null, vehicleId?: string) {
  const fd = new FormData();
  fd.append("doc_type", docType);
  if (validUntil) fd.append("valid_until", validUntil);
  if (vehicleId) fd.append("vehicle_id", vehicleId);
  appendFile(fd, "file", file);
  await upload("driver/documents", fd);
}

/**
 * Belge satırı: ad, ne olduğu, durum ve son geçerlilik. Dokununca yükleme paneli açılır; süreli belgede önce
 * son geçerlilik tarihi istenir. Onaylı belge yenilenebilir, incelemedeki belge için yeni yükleme yapılamaz.
 */
export function DocRow(props: {
  docType: string;
  label: string;
  doc?: DriverDocument;
  vehicleId?: string;
  last?: boolean;
  onUploaded: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status: Status = (props.doc?.status as Status) ?? "yok";
  const needsDate = EXPIRY_REQUIRED.has(props.docType);
  const iso = isoDate(expiry);
  const pending = status === "beklemede";

  async function pick() {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png"], copyToCacheDirectory: true });
    if (res.canceled) return;
    setBusy(true);
    try {
      await send(props.docType, res.assets[0], needsDate ? iso : null, props.vehicleId);
      setOpen(false);
      setExpiry("");
      props.onUploaded(`${props.label} yüklendi, admin onayına gönderildi.`);
    } catch (e) {
      setError(errorTextTr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ borderBottomWidth: props.last ? 0 : 1, borderBottomColor: colors.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.label}, ${status === "yok" ? "yüklenmedi" : DOC_STATUS[status]}`}
        accessibilityState={{ expanded: open, disabled: pending }}
        disabled={pending}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 }, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name={STATUS_ICON[status]} size={24} color={STATUS_COLOR[status]} />
        <View style={{ flex: 1, gap: 3 }}>
          <T style={{ fontWeight: "700", fontSize: 15.5 }}>{props.label}</T>
          {DOC_HINT[props.docType] ? <T style={s.hint}>{DOC_HINT[props.docType]}</T> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            <Badge text={status === "yok" ? "Yüklenmedi" : DOC_STATUS[status] ?? status} tone={status === "yok" ? undefined : statusTone(status)} />
            {props.doc?.valid_until ? <Badge text={`Son geçerlilik ${date(props.doc.valid_until)}`} /> : null}
          </View>
        </View>
        {!pending ? <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.faint} /> : null}
      </Pressable>
      {open && (
        <View style={{ gap: 10, paddingBottom: 16 }}>
          {status === "reddedildi" ? <T style={[s.hint, { color: colors.danger }]}>Belge reddedildi. Okunur bir kopyasını yeniden yükleyin.</T> : null}
          {needsDate ? (
            <Input label="Son geçerlilik tarihi" placeholder="GG.AA.YYYY" value={expiry} keyboardType="number-pad"
              onChangeText={(v) => setExpiry(maskDate(v))} maxLength={10}
              hint={expiry.length === 10 && !iso ? "Tarih geçersiz." : "Belgenin üzerinde yazan bitiş tarihi."} />
          ) : null}
          <T style={s.hint}>PDF, JPEG veya PNG, en fazla 10 MB. Belgeler şifreli saklanır, yalnızca onay ekibi görür.</T>
          {error ? <T style={[s.hint, { color: colors.danger }]}>{error}</T> : null}
          <Button title={status === "onayli" ? "Yenisini yükle" : "Dosya seç ve gönder"} icon="cloud-upload-outline"
            onPress={pick} busy={busy} disabled={needsDate && !iso} />
        </View>
      )}
    </View>
  );
}

/** Araç fotoğrafı yuvası: yüklendiyse küçük resim ve durum, değilse yükleme çağrısı. */
export function PhotoSlot(props: {
  docType: string;
  label: string;
  doc?: DriverDocument;
  vehicleId: string;
  onUploaded: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status: Status = (props.doc?.status as Status) ?? "yok";
  const pending = status === "beklemede";

  async function pick() {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png"], copyToCacheDirectory: true });
    if (res.canceled) return;
    setBusy(true);
    try {
      await send(props.docType, res.assets[0], null, props.vehicleId);
      props.onUploaded(`${props.label} fotoğrafı admin onayına gönderildi.`);
    } catch (e) {
      setError(errorTextTr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label} fotoğrafı, ${status === "yok" ? "yüklenmedi" : DOC_STATUS[status]}`}
      disabled={pending || busy}
      onPress={pick}
      style={({ pressed }) => [{ width: "48%", gap: 6 }, pressed && { opacity: 0.8 }]}
    >
      <View style={{ aspectRatio: 4 / 3, borderRadius: 16, overflow: "hidden", backgroundColor: colors.brandSoft,
        borderWidth: props.doc ? 0 : 1.5, borderStyle: "dashed", borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" }}>
        {props.doc ? (
          <AuthImage key={props.doc.id} path={`driver/documents/${props.doc.id}/file`}
            style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={{ alignItems: "center", gap: 6 }}>
            <Ionicons name={busy ? "hourglass-outline" : "camera-outline"} size={26} color={colors.muted} />
            <T style={[s.hint, { fontWeight: "600" }]}>{busy ? "Gönderiliyor…" : "Fotoğraf ekle"}</T>
          </View>
        )}
        {props.doc ? (
          <View style={{ position: "absolute", left: 8, bottom: 8 }}>
            <Badge text={DOC_STATUS[status] ?? status} tone={statusTone(status)} />
          </View>
        ) : null}
      </View>
      <T style={{ fontWeight: "700", fontSize: 14 }}>{props.label}</T>
      {error ? <T style={[s.hint, { color: colors.danger }]}>{error}</T> : null}
      {status === "reddedildi" || status === "onayli" ? <T style={s.hint}>Değiştirmek için dokunun</T> : null}
    </Pressable>
  );
}
