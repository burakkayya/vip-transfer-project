# Proje Rehberi

Bu dosya projenin tek yerden bakılan özetidir: ne olduğu, nasıl çalıştığı, hangi karar nerede, nelerin bittiği ve nelerin kaldığı. Ayrıntılar ilgili dosyalara bağlanır. Son güncelleme: 2026-11-02.

> Kural: Her değişiklikten sonra ilgili `.md` dosyaları güncellenir ve `degisiklik_gunlugu.md` dosyasına satır eklenir (kök `CLAUDE.md`).

## 1. Proje nedir

getawaytransfers.com: Antalya ve Muğla'da havalimanı, otel ve şehirlerarası özel şoförlü transfer ve günlük araç kiralama platformu. Müşteri web sitesi, müşteri mobil uygulaması, sürücü mobil uygulaması ve yönetim paneli (admin) vardır. Geliştirme tek kişi tarafından Claude ile yapılır; vergi ve operasyon maliyetlerini düşük tutmak önceliktir.

## 2. Parçalar ve adresler (geliştirme)

| Parça | Klasör | Teknoloji | Adres |
|---|---|---|---|
| Backend API | `backend/` | FastAPI, PostgreSQL + PostGIS, Redis, ARQ | http://localhost:8000/docs |
| Müşteri web sitesi | `web/` | Next.js, next-intl | http://localhost:3000 |
| Admin paneli | `admin/` | Next.js, 2FA, rol bazlı menü | http://localhost:3001 |
| Mobil (müşteri ve sürücü) | `mobile/` | Expo SDK 58, tek kod tabanı | web önizleme 8081 (müşteri), 8082 (sürücü); Android emülatörü |
| Dokümantasyon | `docs/` | Markdown | bu klasör |

Çalıştırma adımları: kök `README.md`. Ekrandan deneme senaryoları ve test hesapları: `test_senaryolari.md`.

## 3. Nasıl çalışır (kısa)

1. Müşteri adres seçer (Google Places backend üzerinden; anahtar yokken örnek adresler). Backend adresi imzalı jetonla taşır, ilçe istemci tarafından değiştirilemez.
2. Fiyatı backend hesaplar: ilçeler arası mesafe x 1,10 € x araç çarpanı, minimum 30 €, gidiş-dönüşte %5 indirim, 5'in katına yukarı yuvarlama. TRY için kur TCMB'den otomatik alınır. Bkz. `fiyatlandirma.md`.
3. Müşteri telefonla OTP girişi yapar (misafir rezervasyon yok), kart ile ön ödeme yapar (PayTR, geliştirmede sahte sağlayıcı).
4. Planlı işte admin sürücü atar, anlık işte yakın sürücülere teklif gider. Sürücü yolculuk adımlarını işaretler, konum paylaşır, müşteri canlı izler.
5. Yolculuk bitince sürücü hakedişi (komisyon %25 düşülür) oluşur, admin banka dosyası ile öder. Uçuş verisi silinmeye işaretlenir.

Mimari notlar ve güvenlik ilkeleri: kök `README.md` ve `yasal_ve_guvenlik.md`.

## 4. Test hesapları (geliştirme)

| Rol | Giriş |
|---|---|
| Müşteri | Herhangi bir telefon numarası. SMS kodu ekranda sarı kutuda görünür. |
| Sürücü 1 | +90 530 000 00 01, Mehmet Demir, Minivan, 07GA001 |
| Sürücü 2 | +90 530 000 00 02, Ayşe Kaya, VIP Van, 48GA002 |
| Araç tipleri | Minivan, VIP Van, Minibüs, VIP Minibüs (K-35) |
| Admin | ebkaya.0637@gmail.com. Parola repoya yazılmaz; sohbette iletilen geçici parola kullanılır, ilk girişte 2FA QR kurulumu istenir, sonra **Parolamı değiştir**. |

## 5. Kararlar

Tam liste: `kararlar.md` (K-01 ... K-43). Son eklenenler (2026-10-31 ve 2026-11-02):

| No | Karar | Uygulama durumu |
|---|---|---|
| K-29 | Günlük araç kiralama MVP'de | Bekliyor, tasarım yok |
| K-30 | Gidiş-dönüş indirimi %5 | Uygulandı (seed) |
| K-31 | Uçuş verisi yolculuk tamamlanınca silinir | Uygulandı; kuruma bildirim akışı yok |
| K-32 | Tüm para birimleri 5'in katına yuvarlanır | Uygulandı |
| K-33 | Kur manuel değil, TCMB'den otomatik | Uygulandı (saatlik görev) |
| K-34 | MVP'de on dil | Bekliyor, şu an 4 dil (tr, en, de, ru) |
| K-35 | VIP Minibüs ayrı araç tipi | Uygulandı (çarpan 2,40 yer tutucu) |
| K-36 | Arayüz dilleri fr, es, it, zh, ja, ar; yasal metinler taslak çeviri | Bekliyor (K-34'ün uygulaması) |
| K-37 | Mobil gerçek harita; backend `route_polyline` | Uygulandı: backend (rezervasyon detayı ve sürücü yolculuğu), mobil `MapCanvas` native gerçek harita (web SVG), iki ekrana bağlandı (D7); Android emülatörde doğrulandı, iOS Mac bekliyor |
| K-38 | Renk tokenlarının tek kaynağı kök `DESIGN.md` | Üretici hazır (`scripts/sync-tokens.mjs`); web ve admin bağlı, mobil `ui.tsx` bağlantısı bekliyor |
| K-39 | Görsel yön "Kıyı Yolu" | Bekliyor (arayüz taraması) |
| K-40 | Ön yüz test altyapısı (ESLint, Playwright, axe, jest-expo) | Kuruldu: web (A3) ve admin (A4) ESLint + Playwright + axe; mobil (A5) ESLint + jest-expo + RNTL. Ekran bazlı testler arayüz taraması sırasında yazılacak |
| K-41 | SMS kodu tekrar gönderme beklemesi 45 sn (yalnızca görsel; asıl sınır backend saatte 5 kod) | Uygulandı: web `OtpLogin` (B-W3), mobil giriş |
| K-42 | Web ödeme: sağlayıcı sayfası açıkken yeniden deneme yok, tek başlatma isteği, "ok" dönüşünde 75 sn onay beklemesi ve iki seçenek | Uygulandı: web `PaymentPanel` (B-W4) |
| K-43 | Ortak iskelet parıltısı yalnızca hareket serbestken | Uygulandı: `web/app/home.css` (B-W4) |

## 6. Durum matrisi (2026-11-02)

| Alan | Durum | Eksik |
|---|---|---|
| Backend | Tamamlandı, 94 test geçiyor | PayTR gerçek doğrulama, iyzico yedeği, e-Arşiv, FCM, S3 depolama |
| Müşteri web | Tamamlandı (4 dil), 2026-10-31 yeni tasarım ve animasyonlar; 2026-11-02 ana sayfa Impeccable geçişi (B-W1, critique 31/36), rezervasyon sihirbazı geçişi (B-W2, critique 35/40), SMS doğrulama geçişi (B-W3, critique 36/40), ödeme ekranı geçişi (B-W4, critique 36/40), ödeme sonucu geçiş ekranı (B-W5, critique 22/24) | 6 dil daha, günlük kiralama ekranları |
| Admin | Tamamlandı (23 rota) | Günlük kiralama yönetimi |
| Mobil müşteri ve sürücü | Tamamlandı, 2026-10-31 Uber tarzı yeni tasarım; web önizlemede uçtan uca denendi | Android Maps anahtarı (kendi derlememiz için) ve iOS harita doğrulaması, 6 dil daha, push, mağaza derlemesi, günlük kiralama |
| Ön yüz testleri | Altyapı kuruldu (K-40): web/admin Playwright + axe smoke, ESLint; mobil jest-expo + RNTL, ESLint; `scripts/` testleri; `scripts/ui-shots` | Lint taban ihlalleri (web 0, admin 3, mobil 9; `ui-review/lint-taban.md`), ekran bazlı e2e ve axe testleri (arayüz taraması; web ortak dosyalar B-W0, ana sayfa B-W1 ve rezervasyon sihirbazı B-W2 ve SMS doğrulama B-W3 ve ödeme B-W4 ve ödeme sonucu B-W5 tamamlandı: `web/e2e/shared.spec.ts`, `web/e2e/home.spec.ts`, `web/e2e/book.spec.ts`, `web/e2e/otp.spec.ts`, `web/e2e/pay.spec.ts`, `web/e2e/payment-result.spec.ts`) |
| Yasal metinler | Taslak | Hukukçu onayı, şirket bilgileri (`web/lib/site.ts`) |

## 7. Açık konular

`acik_konular.md`. Hukuki ve ödeme maddeleri doğrulanmadan ilgili özellikler canlıya alınmaz.

## 8. Dosya dizini

| Dosya | İçerik |
|---|---|
| `README.md` | Dokümantasyon girişi ve dizin |
| `proje_rehberi.md` | Bu dosya, genel özet |
| `degisiklik_gunlugu.md` | Tarihli değişiklik kaydı |
| `kararlar.md` | Tüm kararlar (K-01 ...) |
| `acik_konular.md` | Netleşmemiş ve bekleyen işler |
| `is_modeli.md`, `fiyatlandirma.md`, `odeme.md` | İş, fiyat ve ödeme kuralları |
| `veritabani.md`, `teknoloji.md`, `ekranlar.md` | Teknik tasarım |
| `yasal_ve_guvenlik.md` | Yasal gereksinimler ve veri güvenliği |
| `mvp_plani.md` | MVP ve tam sürüm kapsamı |
| `test_senaryolari.md` | Ekrandan test senaryoları ve hesaplar |
| `hesap_kurulumu.md` | Google Cloud, PayTR, Firebase, Expo, Netgsm, Cloudflare hesap adımları |
