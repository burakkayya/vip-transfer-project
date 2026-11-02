"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { PENDING_KEY } from "./PaymentPanel";
import { LoadingState } from "./States";

/** Yönlendirme bu süreden uzun sürerse müşteriye çıkış yolu gösterilir (ağ yavaş veya üst pencereye geçiş engelli). */
const STALL_MS = 8000;

/** Bekleyen rezervasyon kodu; depolama kapalı veya engelliyse yok sayılır (ekran çökmez, liste açılır). */
function pendingCode(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

/**
 * PayTR ödeme sonunda iFrame içinde bu sayfaya yönlendirir (merchant_ok_url / merchant_fail_url).
 * Sayfa iFrame'den çıkar ve kullanıcıyı ödeme ekranına geri götürür; kesin sonuç sunucu bildirimiyle gelir.
 * Yönlendirme sürerken (iFrame içinde de) "Ödeme sonucu alınıyor…" duyurulur; gecikirse rezervasyonlara bağlantı çıkar.
 */
export default function PaymentResult(props: { status: "ok" | "fail" }) {
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
    const code = pendingCode();
    router.replace(code ? `/bookings/${code}/pay?result=${props.status}` : "/bookings");
    return () => clearTimeout(timer);
  }, [props.status, router]);
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
