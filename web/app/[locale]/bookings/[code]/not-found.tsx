import BookingNotFound from "@/components/BookingNotFound";

// Geçersiz biçimli rezervasyon kodu (`page.tsx` `notFound()`): genel 404 yerine rezervasyona özgü, yerelleştirilmiş
// mesaj ve "Rezervasyonlarım" / "Yeni rezervasyon" çıkışları. Durum kodu 404 kalır.
export default function BookingCodeNotFound() {
  return (
    <div className="container narrow page">
      <BookingNotFound />
    </div>
  );
}
