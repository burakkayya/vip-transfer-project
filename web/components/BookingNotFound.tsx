import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// Rezervasyon bulunamadı: geçersiz biçimli kod (`bookings/[code]/not-found.tsx`, durum 404) ve API'nin 404/403'ü
// (`BookingDetail`). Yeniden deneme anlamsızdır; çıkış yolları "Rezervasyonlarım" ve "Yeni rezervasyon".
// Sunucu ve istemci bileşenlerinden kullanılabilir ("use client" yok).
export default function BookingNotFound(props: { announce?: boolean }) {
  const t = useTranslations("bookings");
  return (
    <div className="booking-not-found" role={props.announce ? "alert" : undefined}>
      <h1>{t("notFoundTitle")}</h1>
      <p>{t("notFound")}</p>
      <p className="muted">{t("notFoundHint")}</p>
      <div className="not-found-actions">
        <Link className="btn" href="/bookings">
          {t("title")}
        </Link>
        <Link className="btn secondary" href="/book">
          {t("newBooking")}
        </Link>
      </div>
    </div>
  );
}
