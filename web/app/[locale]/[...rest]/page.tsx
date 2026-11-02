import { notFound } from "next/navigation";

// Hiçbir rotaya uymayan adres (ör. /tr/yok): yerel düzen içindeki `not-found.tsx` çizilir,
// böylece `html[lang]`, üst bilgi ve 404 durum kodu korunur.
export default function CatchAll(): never {
  notFound();
}
