# VIP Transfer — getawaytransfers.com

Antalya ve Muğla'da havalimanı, otel ve şehirlerarası özel şoförlü transfer platformu. Monorepo.
Ürün kararları, fiyatlandırma, veri modeli ve yasal konular `docs/` klasöründe.

```
backend/   FastAPI (Python), PostgreSQL + PostGIS, Redis, ARQ        http://localhost:8000/docs
web/       Müşteri web sitesi (Next.js, 4 dil: tr, en, de, ru)         http://localhost:3000
admin/     Admin paneli (Next.js, 2FA, rol bazlı)                       http://localhost:3001
mobile/    Expo SDK 58: müşteri ve sürücü uygulaması (tek kod tabanı)
docs/      Kararlar, fiyatlandırma, veritabanı, ekranlar, yasal, test senaryoları
```

Her uygulamanın ayrıntılı kurulumu kendi `README.md` dosyasında (`backend/`, `web/`, `admin/`, `mobile/`).

## Geliştirme ortamını açma (VS Code önerilir)

Ön koşullar: Docker Desktop, Python 3.10+ (`backend/.venv`), Node 20+, Android SDK (emülatör için).

1. `Ctrl+Shift+P` → **Tasks: Run Task**
2. İlk kez: **Getaway: Veritabanını hazırla (migration + seed + demo)**
3. Her oturumda: **Getaway: Tümünü başlat** (veritabanı, backend, iş kuyruğu, web, admin, mobil önizlemeler)
4. Emülatörler: **Getaway: Android emülatörünü aç** (müşteri, `getaway_pixel7`) ve sürücü için ikinci emülatör (`getaway_driver`, bağlantı noktası 5556)
5. Mobil uygulamalar emülatörde: **Getaway: Mobil müşteri (Android emülatör)** ve **Getaway: Mobil sürücü (Android emülatör)**

Ekranları VS Code içinde açmak için `Ctrl+Shift+P` → **Simple Browser: Show**:

| Ekran | Adres |
|---|---|
| Müşteri web sitesi | http://localhost:3000 |
| Admin paneli | http://localhost:3001 |
| Mobil müşteri (web önizleme) | http://localhost:8081 |
| Mobil sürücü (web önizleme) | http://localhost:8082 |

Adım adım senaryolar, test hesapları ve demo sürücüler: `docs/test_senaryolari.md`.

## Komut satırıyla

```
docker compose up -d

cd backend
.venv\Scripts\alembic upgrade head
.venv\Scripts\python -m app.cli seed
.venv\Scripts\python -m app.cli seed-demo
.venv\Scripts\python -m pytest

cd ../web    && npm install && npm run dev
cd ../admin  && npm install && npm run dev
cd ../mobile && npm install && npm run web       # ya da: npm run start:driver / npm start (Expo Go)
```

Geliştirmede SMS kodları backend konsoluna yazılır ve uygulamalarda ekranda gösterilir; ödemeler sahte sağlayıcıyla yapılır.

Tek yerden özet: `docs/proje_rehberi.md`. Değişiklik kaydı: `docs/degisiklik_gunlugu.md`.

## Durum (2026-10-31)

| Alan | Durum |
|---|---|
| Backend | Tamamlandı; 78 test geçiyor. Kur TCMB'den otomatik, gidiş-dönüş %5, fiyatlar 5'in katı. Adres (Google Places, şimdilik örnek veri), ilçe bazlı fiyat (K-28), PayTR (test mağazası bekliyor) |
| Müşteri web sitesi | Tamamlandı; 4 dil, adres arama, rezervasyon, ödeme, iptal, KVKK sayfaları, mobil uyumlu. 2026-10-31: yeni tasarım, Motion/Lenis animasyonları, beyaz minibüs |
| Admin paneli | Tamamlandı; 19 ekran, 2FA, rol bazlı menü, parola değiştirme |
| Mobil (müşteri + sürücü) | Tamamlandı; 2026-10-31 Uber tarzı yeni tasarım (Reanimated, SVG harita). Gerçek harita, push bildirim (FCM) ve mağaza derlemesi bekliyor |
| Yasal metinler | Taslak; hukukçu onayı bekliyor (`web/lib/site.ts` içinde yer tutucular) |

Araç tipleri: Minivan, VIP Van, Minibüs. Sedan hizmetten kaldırıldı.

Kararı verilmiş, geliştirmesi bekleyen: günlük araç kiralama (K-29) ve on dil (K-34).

## Mimari notlar

- Web ve admin, backend'e tarayıcıdan doğrudan değil kendi sunucu vekilleri (`app/bff`) üzerinden bağlanır. Jetonlar `httpOnly` çerezde tutulur.
- Mobil uygulama jetonları cihazın güvenli deposunda (Keychain / Keystore) tutar ve backend'e doğrudan bağlanır.
- Fiyat istemcide hesaplanmaz; backend hesaplar ve rezervasyonda yeniden doğrular. Adres, backend'in imzaladığı bir jetonla taşınır; ilçe istemci tarafından değiştirilemez.
- Ortam değişkenleri `GETAWAY_` önekiyle okunur. Gerçek anahtarlar `.env` dosyasında tutulur ve commit edilmez; örnek için `backend/.env.example`.

## Güvenlik ve veri

- Kart verisi sistemde tutulmaz; ödeme sağlayıcının sayfası kullanılır.
- Kişisel alanlar (telefon, e-posta, adres, IBAN) alan düzeyinde şifrelenir; admin panelinde maskelenir.
- Denetim kayıtları (`audit_logs`) değiştirilemez (PostgreSQL tetikleyicisi).
- Uçuş verisi yolculuktan 24 saat sonra silinir (K-18).

## Açık konular

`docs/acik_konular.md`. Hukuki ve ödeme maddeleri doğrulanmadan ilgili özellikler canlıya alınmaz.
