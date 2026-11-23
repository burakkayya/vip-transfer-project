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

// Yolculuk olayı (backend TripEventType).
export const TRIP_EVENT: Record<string, string> = {
  atandi: "Sürücü atandı",
  yola_cikti: "Sürücü yola çıktı",
  vardi: "Sürücü alış noktasına vardı",
  basladi: "Yolcu alındı",
  bitti: "Yolculuk tamamlandı",
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
  kimlik: "Kimlik kartı",
  surucu_belgesi: "Ehliyet",
  adli_sicil: "Adli sicil kaydı",
  d2_yetki_belgesi: "D2 yetki belgesi",
  tursab_belgesi: "TÜRSAB belgesi",
  src_belgesi: "SRC belgesi",
  turizm_tasimacilik_yetki: "Turizm taşımacılığı yetki belgesi",
  arac_foto_dis: "Araç fotoğrafı: dış görünüm",
  arac_foto_on_koltuk: "Araç fotoğrafı: ön koltuklar",
  arac_foto_arka_koltuk: "Araç fotoğrafı: arka koltuklar",
  arac_foto_bagaj: "Araç fotoğrafı: bagaj",
  arac_ruhsati: "Araç ruhsatı",
  arac_muayene: "Muayene raporu",
  arac_sigortasi: "Kasko ve zorunlu trafik sigortası",
  ticari_plaka_yetki: "Ticari plaka yetkisi",
};

/** K-78: sürücü detayları ve araç detayları (sıra ekrandaki sıradır). */
export const DRIVER_DOCS = ["kimlik", "surucu_belgesi", "adli_sicil", "d2_yetki_belgesi", "tursab_belgesi"];
export const VEHICLE_PHOTOS: Record<string, string> = {
  arac_foto_dis: "Dış görünüm",
  arac_foto_on_koltuk: "Ön koltuklar",
  arac_foto_arka_koltuk: "Arka koltuklar",
  arac_foto_bagaj: "Bagaj",
};
export const VEHICLE_DOCS = ["arac_ruhsati", "arac_muayene", "arac_sigortasi"];
/** Son geçerlilik tarihi zorunlu belgeler (backend `documents.EXPIRY_REQUIRED`). */
export const EXPIRY_REQUIRED = new Set(["kimlik", "surucu_belgesi", "d2_yetki_belgesi", "tursab_belgesi", "arac_muayene", "arac_sigortasi"]);

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
  belirsiz: "Belirsiz (sağlayıcı yanıtı yok)",
};
/** REV-A-6: belirsiz iadede yalnızca admin, PayTR panelinden mutabakat yaptıktan sonra karar verir. */
export const UNKNOWN_REFUND_ACTION = {
  retry: "Gerçekleşmedi, yeniden dene",
  complete: "Gerçekleşmiş, tamamlandı işaretle",
  retryConfirm:
    "PayTR panelinden bu iadenin GERÇEKLEŞMEDİĞİNİ doğruladım. Aynı iade yeniden gönderilecek; iade gerçekleşmişse müşteriye çift iade yapılır. Devam edilsin mi?",
  completeConfirm:
    "PayTR panelinde bu iadenin GERÇEKLEŞTİĞİNİ doğruladım. Sağlayıcı yeniden çağrılmadan iade tamamlandı işaretlenecek. Devam edilsin mi?",
  referencePrompt: "PayTR panelindeki iade referansı (isteğe bağlı):",
  adminOnly: "Belirsiz iade: PayTR mutabakatı için admin'e iletin.",
} as const;
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
  geri_cekildi: "Müşteri geri çekti",
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
/** K-29 hizmet türü. */
export const SERVICE_TYPE: Record<string, string> = { transfer: "Transfer", gunluk: "Günlük kiralama" };
export const DAILY_PACKAGE: Record<string, string> = { tam: "Tam gün", yarim: "Yarım gün" };

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

// K-54: manuel rezervasyon (admin girişi).
export const BOOKING_SOURCE: Record<string, string> = { musteri: "Müşteri (site/uygulama)", admin: "Admin girişi" };
export const BOOKING_CHANNEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  telefon: "Telefon",
  eposta: "E-posta",
  yuz_yuze: "Yüz yüze",
  diger: "Diğer",
};
export const MANUAL_PAYMENT_METHOD: Record<string, string> = { havale: "Havale / EFT", nakit: "Nakit", pos: "Fiziki POS" };
export const PAYMENT_PROVIDER: Record<string, string> = { paytr: "PayTR", iyzico: "iyzico", fake: "Test", elle: "Elle tahsilat" };
// K-77: müşteri dili (SMS ve paylaşım metni bu dilde gider).
export const LOCALE: Record<string, string> = {
  tr: "Türkçe", en: "İngilizce", de: "Almanca", es: "İspanyolca", ru: "Rusça", fr: "Fransızca", ar: "Arapça",
  zh: "Çince", ja: "Japonca", it: "İtalyanca", pt: "Portekizce", ko: "Korece",
};

/** K-81: sürücü profil fotoğrafı onayı. */
export const PHOTO_STATUS: Record<string, string> = { beklemede: "Onay bekliyor", onaylandi: "Onaylı", reddedildi: "Reddedildi" };

// K-83: olaylar (incident) ve yolculuk geçmişi.
export const INCIDENT_LEVEL: Record<string, string> = { warning: "Uyarı", error: "Hata", critical: "Kritik" };
export const INCIDENT_STATUS: Record<string, string> = {
  open: "Açık",
  acknowledged: "İnceleniyor",
  resolved: "Çözüldü",
};
export const INCIDENT_SOURCE: Record<string, string> = {
  backend: "Sunucu",
  worker: "Zamanlanmış iş",
  web: "Web sitesi",
  admin: "Admin paneli",
  mobile_customer: "Müşteri uygulaması",
  mobile_driver: "Sürücü uygulaması",
};
export const INCIDENT_KIND: Record<string, string> = {
  exception: "Beklenmeyen hata",
  job_failure: "Zamanlanmış iş hatası",
  client_error: "Uygulama/tarayıcı hatası",
  security: "Güvenlik alarmı",
  payment: "Ödeme",
  refund: "İade",
  provider: "Dış servis",
};
export function incidentTone(level: string, status: string): "ok" | "warn" | "danger" | "" {
  if (status === "resolved") return "ok";
  if (level === "critical" || level === "error") return "danger";
  return "warn";
}

export const ACTOR_TYPE: Record<string, string> = {
  customer: "Müşteri",
  driver: "Sürücü",
  staff: "Personel",
  system: "Sistem",
};
export const PLATFORM: Record<string, string> = {
  web: "Web",
  admin: "Admin paneli",
  ios: "iOS",
  android: "Android",
  system: "Sistem",
};

/** Yolculuk geçmişi adımları; bilinmeyen kod olduğu gibi gösterilir. */
export const TIMELINE_EVENT: Record<string, string> = {
  "booking.created": "Rezervasyon oluşturuldu",
  // K-83 öncesi rezervasyonlarda aynı adımlar yalnızca denetim kaydında.
  "booking.create": "Rezervasyon oluşturuldu",
  "booking.admin_create": "Rezervasyon oluşturuldu (admin girişi)",
  "payment.paid": "Ödeme alındı",
  "booking_leg.assign": "Sürücü atandı",
  "booking_leg.customer_finish": "Müşteri yolculuğu bitirdi",
  "booking_leg.no_show": "Yolcu gelmedi",
  "booking.cancel": "Rezervasyon iptal edildi",
  "booking.cancel_day": "Gün iptal edildi",
  "booking.refund": "İade başlatıldı",
  "booking.resend_payment_sms": "Ödeme SMS'i yeniden gönderildi",
  "booking.chat_view": "Personel mesajları açtı",
  "booking.timeline_view": "Personel geçmişi açtı",
  "booking.accept_all_days": "Tüm günler kabul edildi",
  "payment.started": "Ödeme sayfası açıldı",
  "payment.page_reopened": "Ödeme sayfası yeniden açıldı",
  "payment.succeeded": "Ödeme alındı",
  "payment.failed": "Ödeme başarısız",
  "payment.rejected": "Ödeme bildirimi reddedildi",
  "payment.manual": "Elle tahsilat",
  "payment.auto_refund": "Otomatik iade",
  "refund.retry": "İade yeniden denendi",
  "refund.mark_completed": "İade tamamlandı işaretlendi",
  "refund.manual_complete": "Elle iade tamamlandı",
  "refund.stuck_pending_unknown": "İade belirsiz kaldı",
  "dispatch.offered": "Sürücülere teklif gönderildi",
  "dispatch.declined": "Sürücü teklifi reddetti",
  "dispatch.expired": "Teklif süresi doldu",
  "leg.assigned": "Sürücü atandı",
  "leg.departed": "Sürücü yola çıktı",
  "leg.arrived": "Sürücü alış noktasına vardı",
  "leg.started": "Yolcu alındı",
  "leg.finished": "Yolculuk bitti",
  "leg.no_show": "Yolcu gelmedi",
  "leg.customer_finished": "Müşteri yolculuğu bitirdi",
  "booking_leg.force_advance": "Operasyon adımı zorla ilerletti",
  "booking_leg.event_rejected": "Sürücü adımı reddedildi",
  "booking_leg.driver_early_finish": "Erken bitiş",
  "booking_leg.day_report": "Gün sonu km bildirildi",
  "booking_leg.release_suspended_driver": "Askıdaki sürücüden alındı",
  "chat.message_sent": "Mesaj gönderildi",
  "rating.submitted": "Değerlendirme yapıldı",
  "tip.paid": "Bahşiş ödendi",
  "tip.refund": "Bahşiş iade edildi",
  "flight.updated": "Uçuş bilgisi güncellendi",
  incident: "Hata / olay",
};
/** Geçmiş ve olay ayrıntısındaki veri anahtarları. */
export const DATA_KEY: Record<string, string> = {
  booking_code: "Rezervasyon kodu",
  total: "Tutar",
  amount: "Tutar",
  currency: "Para birimi",
  reason: "Gerekçe",
  item_count: "Kayıt sayısı",
  message_count: "Mesaj sayısı",
  status: "Durum",
  source: "Kaynak",
  type: "Tür",
  legs: "Bacak sayısı",
  channel: "Kanal",
  provider: "Ödeme sağlayıcı",
  driver_count: "Sürücü sayısı",
  online_only: "Yalnızca çevrimiçi",
  offer_count: "Teklif sayısı",
  translated: "Çevrildi",
  stars: "Puan",
  has_comment: "Yorum var",
  estimated_at: "Tahmini iniş",
  scheduled_at: "Planlanan iniş",
  distance_m: "Uzaklık (m)",
  waited_min: "Bekleme (dk)",
  recipient: "Alıcı",
  refund_percent: "İade oranı (%)",
  refund_amount: "İade tutarı",
  event: "Adım",
  old_status: "Önceki durum",
  new_status: "Yeni durum",
  level: "Seviye",
  title: "Başlık",
};

export function timelineLabel(event: string): string {
  if (TIMELINE_EVENT[event]) return TIMELINE_EVENT[event];
  if (event.startsWith("notify.")) return `Bildirim: ${event.slice(7).replaceAll("_", " ")}`;
  return event;
}
