/**
 * Yolculuk durumu canlı etkinliği (K-59): iOS'ta Canlı Etkinlik (kilit ekranı, Dynamic Island),
 * Android'de kalıcı bildirim. Düzenler yalnızca bu düz alanları alır (widget çalışma zamanında
 * hook, bağlam veya modül düzeyi sabit kullanılamaz).
 */
export type LiveTripProps = {
  /** Ana durum satırı, ör. "Sürücünüz yolda". */
  title: string;
  /** İkinci satır, ör. "Mehmet · 07 GA 001 · Mercedes Vito" veya varış adresi. */
  detail: string;
  /** Sağdaki kısa değer, ör. "8 dk", "Geldi". Boş olabilir. */
  eta: string;
  /** Aşama ilerlemesi 0..1 (atandı → yolda → geldi → yolculukta → bitti). */
  progress: number;
  /** "Müşteri" uygulaması mı "sürücü" mü (renk ve simge seçimi). */
  role: "customer" | "driver";
};
