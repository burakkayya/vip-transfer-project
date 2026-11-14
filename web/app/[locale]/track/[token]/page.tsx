import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import TrackView from "@/components/TrackView";

type Props = { params: Promise<{ locale: string; token: string }> };

// Paylaşılan takip bağlantısı arama motorlarına kapalıdır, yönlendiren adres dışarı sızmaz.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function TrackPage({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  return (
    <div className="container narrow page">
      <TrackView token={token} />
    </div>
  );
}
