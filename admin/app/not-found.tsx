import Link from "next/link";

/**
 * Bulunamayan sayfa. Kök sınırı olarak bulunması, `notFound()` çağrısında (ör. geçersiz `[id]`, WEB-06) yanıtın
 * HTTP 404 dönmesini sağlar; sınır yokken akış 200 ile başlıyordu.
 */
export default function NotFound() {
  return (
    <main className="login-page">
      <div className="login stack">
        <h1>Sayfa bulunamadı</h1>
        <p className="muted">Adres hatalı ya da kayıt artık yok.</p>
        <Link href="/" className="btn">Panele dön</Link>
      </div>
    </main>
  );
}
