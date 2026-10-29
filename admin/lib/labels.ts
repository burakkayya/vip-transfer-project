// Backend enum değerlerinin panel etiketleri (backend/app/models/enums.py).

export const ROLE: Record<string, string> = {
  admin: "Admin",
  operasyon: "Operasyon",
  muhasebe: "Muhasebe",
  destek: "Destek",
};

export const BOOKING_STATUS: Record<string, string> = {
  odeme_bekliyor: "Ödeme bekliyor",
  onaylandi: "Onaylandı",
  atandi: "Atandı",
  yolculukta: "Yolculukta",
  tamamlandi: "Tamamlandı",
  iptal: "İptal",
  odeme_basarisiz: "Ödeme başarısız",
};

export const LEG_STATUS: Record<string, string> = {
  beklemede: "Bekliyor",
  atandi: "Atandı",
  yolda: "Yolda",
  vardi: "Vardı",
  basladi: "Başladı",
  bitti: "Bitti",
  iptal: "İptal",
};

export const DRIVER_STATUS: Record<string, string> = {
  basvuru: "Başvuru",
  onayli: "Onaylı",
  askida: "Askıda",
  pasif: "Pasif",
};

export const VEHICLE_STATUS: Record<string, string> = { beklemede: "Beklemede", aktif: "Aktif", pasif: "Pasif" };

export const DOCUMENT_STATUS: Record<string, string> = {
  beklemede: "Beklemede",
  onayli: "Onaylı",
  reddedildi: "Reddedildi",
  suresi_doldu: "Süresi doldu",
};

export const DOCUMENT_TYPE: Record<string, string> = {
  surucu_belgesi: "Sürücü belgesi",
  src_belgesi: "SRC belgesi",
  tursab_belgesi: "TÜRSAB belgesi",
  turizm_tasimacilik_yetki: "Turizm taşımacılığı yetki belgesi",
  adli_sicil: "Adli sicil kaydı",
  arac_ruhsati: "Araç ruhsatı",
  arac_sigortasi: "Araç sigortası",
  arac_muayene: "Araç muayenesi",
  ticari_plaka_yetki: "Ticari plaka yetkisi",
};

export const PAYMENT_STATUS: Record<string, string> = {
  beklemede: "Beklemede",
  odendi: "Ödendi",
  basarisiz: "Başarısız",
  iade_edildi: "İade edildi",
  kismi_iade: "Kısmi iade",
};

export const REFUND_STATUS: Record<string, string> = {
  beklemede: "Beklemede",
  tamamlandi: "Tamamlandı",
  basarisiz: "Başarısız",
};
export const LEDGER_STATUS: Record<string, string> = { beklemede: "Beklemede", odendi: "Ödendi", iptal: "İptal" };
export const PAYOUT_STATUS: Record<string, string> = { beklemede: "Beklemede", odendi: "Ödendi", basarisiz: "Başarısız" };
export const INVOICE_STATUS: Record<string, string> = {
  beklemede: "Beklemede",
  kesildi: "Kesildi",
  basarisiz: "Başarısız",
  iptal: "İptal",
};

export const DATA_REQUEST_TYPE: Record<string, string> = { erisim: "Erişim", silme: "Silme", duzeltme: "Düzeltme" };
export const DATA_REQUEST_STATUS: Record<string, string> = {
  acik: "Açık",
  isleniyor: "İşleniyor",
  tamamlandi: "Tamamlandı",
  reddedildi: "Reddedildi",
};

export const OFFER_STATUS: Record<string, string> = {
  gonderildi: "Gönderildi",
  kabul: "Kabul",
  red: "Red",
  suresi_doldu: "Süresi doldu",
  geri_cekildi: "Geri çekildi",
};

export const COMMISSION_SCOPE: Record<string, string> = { genel: "Genel", bolge: "Bölge", arac_tipi: "Araç tipi" };
export const DISCOUNT_TYPE: Record<string, string> = { yuzde: "Yüzde", sabit: "Sabit tutar (€)" };
export const BOOKING_TYPE: Record<string, string> = { anlik: "Anlık", planli: "Planlı" };

const OK = ["onaylandi", "atandi", "tamamlandi", "onayli", "aktif", "odendi", "kesildi", "kabul", "bitti"];
const WARN = ["odeme_bekliyor", "beklemede", "basvuru", "acik", "isleniyor", "gonderildi", "kismi_iade",
  "yolculukta", "yolda", "vardi", "basladi"];
const DANGER = ["iptal", "odeme_basarisiz", "basarisiz", "reddedildi", "suresi_doldu", "askida", "pasif", "red"];

/** Rozet rengi. */
export function tone(status: string): "ok" | "warn" | "danger" | "" {
  if (OK.includes(status)) return "ok";
  if (WARN.includes(status)) return "warn";
  if (DANGER.includes(status)) return "danger";
  return "";
}
