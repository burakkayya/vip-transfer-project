import { clock } from "./format";
/** K-78 sürücü detayları: kişisel belgeler (sıra ekrandaki sıradır). */
export const DOC_TYPES_DRIVER: Record<string, string> = {
  kimlik: "Kimlik kartı",
  surucu_belgesi: "Ehliyet",
  adli_sicil: "Adli sicil kaydı",
  d2_yetki_belgesi: "D2 yetki belgesi",
  tursab_belgesi: "TÜRSAB belgesi",
  src_belgesi: "SRC belgesi",
  turizm_tasimacilik_yetki: "Turizm taşımacılığı yetki belgesi",
};

/** K-78 araç detayları: dört fotoğraf ve araç belgeleri. */
export const VEHICLE_PHOTOS: Record<string, string> = {
  arac_foto_dis: "Dış görünüm",
  arac_foto_on_koltuk: "Ön koltuklar",
  arac_foto_arka_koltuk: "Arka koltuklar",
  arac_foto_bagaj: "Bagaj",
};

export const DOC_TYPES_VEHICLE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(VEHICLE_PHOTOS).map(([k, v]) => [k, `Araç fotoğrafı: ${v.toLowerCase()}`])),
  arac_ruhsati: "Araç ruhsatı",
  arac_muayene: "Muayene raporu",
  arac_sigortasi: "Kasko ve zorunlu trafik sigortası",
  ticari_plaka_yetki: "Ticari plaka yetkisi",
};

/** Belgenin ne olduğu, kısa açıklama (yükleme satırının alt metni). */
export const DOC_HINT: Record<string, string> = {
  kimlik: "Nüfus cüzdanı, ön ve arka yüz",
  surucu_belgesi: "Sürücü belgesi, ön ve arka yüz",
  adli_sicil: "e-Devlet'ten alınan sabıka kaydı",
  d2_yetki_belgesi: "Ulaştırma Bakanlığı D2 yetki belgesi",
  tursab_belgesi: "TÜRSAB üyelik veya acente belgesi",
  arac_ruhsati: "Araç tescil belgesi",
  arac_muayene: "Geçerli muayene raporu",
  arac_sigortasi: "Kasko ve zorunlu trafik poliçesi",
};

/** Son geçerlilik tarihi istenen belgeler (backend `documents.EXPIRY_REQUIRED` ile aynı). */
export const EXPIRY_REQUIRED = new Set(["kimlik", "surucu_belgesi", "d2_yetki_belgesi", "tursab_belgesi", "arac_muayene", "arac_sigortasi"]);

export const DOC_LABEL: Record<string, string> = { ...DOC_TYPES_DRIVER, ...DOC_TYPES_VEHICLE };

export const DRIVER_STATUS: Record<string, string> = {
  basvuru: "Onay bekliyor",
  onayli: "Onaylı",
  askida: "Askıda",
  pasif: "Pasif",
};

export const DOC_STATUS: Record<string, string> = {
  beklemede: "İnceleniyor",
  onayli: "Onaylı",
  reddedildi: "Reddedildi",
  suresi_doldu: "Süresi doldu",
};

export const LEG_STATUS: Record<string, string> = {
  beklemede: "Bekliyor",
  atandi: "Atandı",
  yolda: "Yoldasınız",
  vardi: "Alış noktasındasınız",
  basladi: "Yolcu araçta",
  bitti: "Tamamlandı",
  iptal: "İptal",
};

/** Yolculuk akışı (ekran 5): mevcut durumdan sonraki adım. */
export const NEXT_STEP: Record<string, { event: string; label: string } | undefined> = {
  atandi: { event: "yola_cikti", label: "Yola çıktım" },
  yolda: { event: "vardi", label: "Vardım" },
  vardi: { event: "basladi", label: "Yolcu alındı" },
  basladi: { event: "bitti", label: "Yolculuğu bitir" },
};

/** K-29: günlük kiralamada bırakış noktası yerine gösterilen metin. */
export const DAILY_DROPOFF = "Gün boyu, müşteriyle";

/** K-29 şoförlü günlük kiralama: iş kartı ve yolculuk ekranındaki kısa özet (ör. "Günlük kiralama · 10 sa / 250 km"). */
export function dailyLine(durationMinutes: number | null | undefined, km: string | number | null | undefined): string {
  const hours = durationMinutes ? Number((durationMinutes / 60).toFixed(1)).toLocaleString("tr-TR") : null;
  const parts = [hours ? `${hours} sa` : null, km ? `${Number(km).toFixed(0)} km` : null].filter(Boolean);
  return parts.length ? `Günlük kiralama · ${parts.join(" / ")}` : "Günlük kiralama";
}

const FLIGHT_CHIP: Record<string, string> = {
  planlandi: "Zamanında", rotarli: "Rötarlı", havada: "Havada", indi: "İndi",
  iptal: "İptal edildi", yonlendirildi: "Yönlendirildi", bulunamadi: "Uçuş bulunamadı",
};

/** Teklif kartındaki uçuş etiketi (K-60). Uçuş numarası kabul öncesi verilmez; durum ve tahmini iniş gösterilir. */
export function flightChip(status: string | null | undefined, eta: string | null | undefined): string {
  const label = status ? FLIGHT_CHIP[status] : undefined;
  if (!label) return "Uçuş var";
  if (status === "iptal" || status === "yonlendirildi" || status === "bulunamadi" || !eta) return `Uçuş · ${label}`;
  return `Uçuş · ${label} · ${status === "indi" ? "iniş" : "tahmini iniş"} ${clock(eta)}`;
}
