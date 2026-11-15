"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { BOOKING_CODE_RE, PENDING_KEY, TIP_KEY, session } from "@/lib/booking";
import { LoadingState } from "./States";

/** Yönlendirme bu süreden uzun sürerse müşteriye çıkış yolu gösterilir (ağ yavaş veya üst pencereye geçiş engelli). */
const STALL_MS = 8000;

/**
 * Bekleyen rezervasyon kodu; depolama kapalı veya engelliyse yok sayılır (ekran çökmez, liste açılır).
 * Adrese girmeden önce biçimi denetlenir: geçersiz değer yok sayılır.
 */
function pendingCode(key: string): string | null {
  const code = session.get(key);
  return code && BOOKING_CODE_RE.test(code) ? code : null;
}

/**
 * PayTR ödeme sonunda iFrame içinde bu sayfaya yönlendirir (merchant_ok_url / merchant_fail_url).
 * Sayfa iFrame'den çıkar ve kullanıcıyı ödeme ekranına geri götürür; kesin sonuç sunucu bildirimiyle gelir.
 * Yönlendirme sürerken (iFrame içinde de) "Ödeme sonucu alınıyor…" duyurulur; gecikirse rezervasyonlara bağlantı çıkar.
 */
export default function PaymentResult(props: { status: "ok" | "fail"; kind?: "booking" | "tip" }) {
  const t = useTranslations("pay");
  const tn = useTranslations("nav");
  const router = useRouter();
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), STALL_MS);
    if (window.top && window.top !== window.self) {
      try {
        window.top.location.href = window.location.href;
      } catch {
        // Üst pencereye geçiş engelliyse ekran iFrame içinde bekler; gecikme notu çıkış yolunu verir.
      }
      return () => clearTimeout(timer);
    }
    // Bahşiş rezervasyon ekranındaki puan bölümüne döner; rezervasyon ödemesi ödeme ekranına.
    const tip = props.kind === "tip";
    const code = pendingCode(tip ? TIP_KEY : PENDING_KEY);
    if (tip) session.remove(TIP_KEY);
    router.replace(!code ? "/bookings" : tip ? `/bookings/${code}?tip=${props.status}#rate-title`
      : `/bookings/${code}/pay?result=${props.status}`);
    return () => clearTimeout(timer);
  }, [props.status, props.kind, router]);
  return (
    <div className="result">
      <LoadingState label={t("resultLoading")} />
      {/* Kalıcı canlı bölge: not sonradan eklense de ekran okuyucuya duyurulur. */}
      <div aria-live="polite">
        {stalled && (
          <p className="state-text result-stalled">
            {t("resultStalled")}{" "}
            <Link href="/bookings" target="_top">
              {tn("bookings")}
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
