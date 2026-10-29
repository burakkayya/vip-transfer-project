"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { PENDING_KEY } from "./PaymentPanel";

/**
 * PayTR ödeme sonunda iFrame içinde bu sayfaya yönlendirir (merchant_ok_url / merchant_fail_url).
 * Sayfa iFrame'den çıkar ve kullanıcıyı ödeme ekranına geri götürür; kesin sonuç sunucu bildirimiyle gelir.
 */
export default function PaymentResult(props: { status: "ok" | "fail" }) {
  const router = useRouter();
  useEffect(() => {
    if (window.top && window.top !== window.self) {
      window.top.location.href = window.location.href;
      return;
    }
    const code = sessionStorage.getItem(PENDING_KEY);
    router.replace(code ? `/bookings/${code}/pay?result=${props.status}` : "/bookings");
  }, [props.status, router]);
  return null;
}
