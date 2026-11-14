import { notFound } from "next/navigation";
import { parseUuid } from "@/lib/routeParams";
import BookingDetail from "./BookingDetail";

/**
 * Sunucu bileşeni: URL'deki `id` BFF yollarına eklenmeden önce UUID olarak doğrulanır ve kodlanır (WEB-06).
 * Geçersizse istemci kodu hiç çalışmaz ve yanıt HTTP 404 olur (istemci bileşeninde `notFound()` akış başladıktan
 * sonra tetiklendiği için durum 200 kalıyordu).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const id = parseUuid((await params).id) ?? notFound();
  return <BookingDetail id={id} />;
}
