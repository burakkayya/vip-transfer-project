# Backend (FastAPI)

Python 3.10+, PostgreSQL 16 + PostGIS, Redis.

## Kurulum

```
docker compose up -d                 # kök dizinde: PostgreSQL+PostGIS ve Redis
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt     # Linux/macOS: .venv/bin/pip
copy .env.example .env                            # gerekirse düzenleyin
.venv\Scripts\alembic upgrade head
.venv\Scripts\python -m app.cli seed
.venv\Scripts\python -m app.cli seed-demo                       # yalnızca geliştirme: onaylı demo sürücüler + kur
.venv\Scripts\python -m app.cli create-admin --email siz@getawaytransfers.com
.venv\Scripts\uvicorn app.main:app --reload
```

- API belgeleri: http://localhost:8000/docs. Üretimde kapalıdır.
- Zamanlanmış görevler: `.venv\Scripts\arq app.worker.WorkerSettings`
- Admin ilk girişte 2FA kurulumu yapar. Yanıttaki `provisioning_uri` bir doğrulama uygulamasına eklenir. Parola `POST /auth/staff/password` ile değiştirilir.
- Geliştirmede (`GETAWAY_ENV` prod değil ve SMS konsolda) `POST /auth/otp/request` yanıtında `dev_code` döner; uygulamalar kodu ekranda gösterir.
- Adres arama: `GETAWAY_PLACES_PROVIDER=fake` örnek yerlerle çalışır, `google` için `GETAWAY_GOOGLE_MAPS_API_KEY` gerekir (Places API New + Routes API).

## Testler

```
docker compose exec db psql -U getaway -c "CREATE DATABASE getaway_test;"   # bir kez
.venv\Scripts\python -m pytest
```

- Saf birim testleri (`test_pricing`, `test_domain`) veritabanı olmadan çalışır.
- Entegrasyon testleri `getaway_test` veritabanını her çalıştırmada sıfırlar. Veritabanı yoksa atlanır.

## Yapı

```
app/
  pricing.py, cancellation.py, commission.py, currency.py   Saf iş kuralları (I/O yok)
  models/        SQLAlchemy modelleri (docs/veritabani.md)
  services/      İş akışları: teklif, rezervasyon, ödeme, eşleştirme, belge, OTP, oturum, görevler
  providers/     Dış servisler: SMS, rota, ödeme (PayTR), push, depolama. Her biri için geliştirme uygulaması var
  api/           HTTP uçları: public, auth, me (müşteri), driver, admin/*, payments
  security/      Alan şifreleme + kör indeks, Argon2, JWT
alembic/         Migration'lar (0002: audit_logs değiştirilemez tetikleyicisi)
```

## API özeti (`/api/v1`)

| Grup | Uçlar |
|---|---|
| Public | `GET /regions`, `GET /vehicle-types`, `POST /quotes`, `GET /places/autocomplete`, `GET /places/{place_id}` (ilçe çözümü + imzalı adres jetonu) |
| Auth | `POST /auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `/auth/logout`, `/auth/staff/login`, `/auth/staff/2fa`, `/auth/staff/password` |
| Müşteri | `/me/bookings` (oluştur, listele, detay, iptal önizleme, iptal, ödeme, sürücü konumu), `/me/profile`, `/me/consents`, `/me/data-requests`, WS `/ws/bookings/{code}/location`. Rezervasyon detayında (`GET /me/bookings/{code}`) her ayağın `legs[].route_polyline` alanı (Google encoded polyline) dolu gelir, liste ve oluşturma yanıtlarında `null` kalır |
| Sürücü | `/driver/register`, `/driver/me`, `/driver/me/online`, `/driver/documents`, `/driver/vehicles`, `/driver/offers`, `/driver/trips`, `/driver/trips/{id}` (tekil yolculuk, `route_polyline` dolu; yalnızca atanan sürücü, aksi 404), `/driver/trips/{id}/events`, `/driver/trips/{id}/location` (teklif kabulü, tekil yolculuk ve durum adımı yanıtındaki `TripOut.route_polyline` dolu, `/driver/trips` ve `/driver/offers` listelerinde `null`), `/driver/earnings` |
| Admin | dashboard, bookings, dispatch, drivers, vehicles, vehicle-types, documents, regions, pricing-rules, round-trip-discounts, cancellation-policies, commission-rules, exchange-rates, payments, refunds, ledger, payouts, invoices, customers, data-requests, users, audit-logs, notification-templates, settings |

## Roller

| Rol | Yetki |
|---|---|
| `admin` | Her şey (K-21) |
| `operasyon` | Rezervasyon, eşleştirme, sürücü, araç, belge, bölge, şablon |
| `muhasebe` | Ödeme, iade, hakediş, fatura, kur, komisyon listesi |
| `destek` | Rezervasyon görüntüleme, müşteri (maskeli), KVKK talepleri |

## Güvenlik notları

- Üretimde (`GETAWAY_ENV=prod`) geliştirme anahtarları veya sahte ödeme sağlayıcısı kullanılırsa uygulama açılmaz.
- Tam iade garantisi `GETAWAY_GUARANTEE_ENABLED=false` ile kapalıdır (K-15).
- Fiyat istemciden alınmaz. Rezervasyonda sunucu yeniden hesaplar, istemcinin gördüğü fiyatla farklıysa 409 döner.
- Fiyat ilçe bazlıdır (K-28): adresin ilçesi backend'de çözülür ve imzalı jetonla taşınır; istemci ilçeyi değiştiremez. Adres araması IP başına dakikada 60 istekle sınırlıdır.
