export const DOC_TYPES_DRIVER: Record<string, string> = {
  surucu_belgesi: "Sürücü belgesi",
  src_belgesi: "SRC belgesi",
  tursab_belgesi: "TÜRSAB belgesi",
  turizm_tasimacilik_yetki: "Turizm taşımacılığı yetki belgesi",
  adli_sicil: "Adli sicil kaydı",
};

export const DOC_TYPES_VEHICLE: Record<string, string> = {
  arac_ruhsati: "Araç ruhsatı",
  arac_sigortasi: "Araç sigortası",
  arac_muayene: "Araç muayenesi",
  ticari_plaka_yetki: "Ticari plaka yetkisi",
};

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
