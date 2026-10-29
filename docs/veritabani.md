# Veritabanı Şeması (PostgreSQL + PostGIS)

Migration aracı: Alembic. ORM: SQLAlchemy.

## Kimlik ve yetki

| Tablo | Ana alanlar |
|---|---|
| users | id, email, phone, password_hash, two_factor_secret (şifreli), status, created_at |
| roles | id, code (admin, operasyon, muhasebe, destek) |
| user_roles | user_id, role_id |
| sessions | id, user_id, device_info, ip, expires_at, revoked_at |

## Müşteri

| Tablo | Ana alanlar |
|---|---|
| customers | id, full_name, phone (şifreli), email (şifreli, opsiyonel), country_code, locale, currency, verified_at, created_at |
| consents | id, customer_id, consent_type (kvkk, aydınlatma, pazarlama), version, accepted_at, ip |
| data_requests | id, customer_id, request_type (erişim, silme, düzeltme), status, due_at, completed_at |

Pasaport bilgisi bu tabloda yoktur (K-17).

## Sürücü, araç, belge

| Tablo | Ana alanlar |
|---|---|
| drivers | id, user_id, full_name, phone (şifreli), tursab_or_agency_no, status (başvuru, onaylı, askıda, pasif), is_online |
| vehicles | id, plate, vehicle_type_id, brand, model, capacity, status |
| vehicle_types | id, code, name, capacity, price_multiplier |
| driver_vehicle_assignments | driver_id, vehicle_id, valid_from, valid_to |
| documents | id, owner_type (driver, vehicle), owner_id, doc_type, storage_key (şifreli), valid_until, status (beklemede, onaylı, reddedildi, süresi_doldu) |
| document_reviews | id, document_id, reviewer_id, decision, note, created_at |

Belge süresi dolduğunda sürücü otomatik pasif olur (zamanlanmış görev).

## Bölge, rota, fiyat

| Tablo | Ana alanlar |
|---|---|
| regions | id, province (antalya, muğla), name, type (ilçe, havalimanı), location (PostGIS), is_active |
| pricing_rules | id, vehicle_type_id, base_price_per_km (1.10), minimum_price (30), rounding_step (5), valid_from, valid_to, is_active |
| round_trip_discounts | id, type (yüzde, sabit), value, valid_from, valid_to |
| cancellation_policies | id, hours_before_pickup, refund_percent, valid_from |
| commission_rules | id, scope (genel, bölge, araç tipi), scope_ref_id, rate (0.25), valid_from |

Fiyat ve komisyon geçmişi tutulur, eski rezervasyonların hangi kuralla hesaplandığı izlenir.

## Rezervasyon ve eşleştirme

| Tablo | Ana alanlar |
|---|---|
| bookings | id, booking_code, customer_id, booking_type (anlık, planlı), status, vehicle_type_id, passenger_count, luggage_count, is_round_trip, guarantee_fee, cancellation_policy_id (dondurulmuş), quoted_price, currency, quoted_at |
| booking_legs | id, booking_id, leg_order, pickup_region_id, dropoff_region_id, pickup_address, dropoff_address, pickup_at, distance_km, leg_price |
| flight_infos | id, booking_leg_id, flight_no, direction (geliş, gidiş), scheduled_at, estimated_at, actual_at, purge_at |
| dispatch_offers | id, booking_leg_id, driver_id, status (gönderildi, kabul, red, süre_doldu), offered_at, responded_at |
| trip_events | id, booking_leg_id, event_type (atandı, yola_çıktı, vardı, başladı, bitti), occurred_at |

- `flight_infos.purge_at` yolculuk bitiminden 24 saat sonrasına ayarlanır, zamanlanmış görev siler.
- Canlı sürücü konumu PostgreSQL'de tutulmaz. Redis'te kısa süreli saklanır.

## Ödeme, iade, finans

| Tablo | Ana alanlar |
|---|---|
| payments | id, booking_id, provider (paytr, iyzico), provider_ref, amount, currency, status, paid_at |
| payment_webhooks | id, provider, event_type, raw_payload (maskelenmiş), received_at, processed_at |
| refunds | id, payment_id, amount, reason, policy_id, status, provider_ref, created_at |
| driver_ledger | id, driver_id, booking_leg_id, gross_amount, commission_amount, net_amount_try, status (beklemede, ödendi), created_at |
| driver_payouts | id, driver_id, total_try, provider_ref, status, paid_at |
| invoices | id, booking_id, type (e-arşiv), gib_ref, status, issued_at |

## Operasyon ve sistem

| Tablo | Ana alanlar |
|---|---|
| notifications | id, recipient_type, recipient_id, channel (sms, email, push), template_code, status, sent_at |
| notification_templates | id, code, locale, body |
| audit_logs | id, actor_id, action, entity_type, entity_id, changes (hassas alan içermez), ip, created_at |
| system_settings | id, key, value, updated_by, updated_at |

- `audit_logs` yalnızca eklenebilir. Uygulama kullanıcısına güncelleme ve silme yetkisi verilmez.
- Kişisel veri alanları (telefon, e-posta, belge yolu) uygulama katmanında alan düzeyinde şifrelenir.

## Uygulamada yapılan ayrıntılandırmalar

Kod (`backend/app/models/`) yukarıdaki şemayı izler. Aşağıdaki farklar uygulama sırasında eklendi:

| Konu | Uygulama |
|---|---|
| Telefon tekrarı | Müşteri ve sürücü telefonu yalnızca `users.phone` alanında (şifreli) tutulur. `customers` ve `drivers` tablolarında `user_id` bulunur, telefon tekrarlanmaz. |
| Şifreli alanda arama | Şifreli alanlarda arama yapılamadığı için `users.phone_hash` ve `users.email_hash` (HMAC-SHA256 kör indeks) eklendi. |
| Ek şifreli alanlar | Ad soyad, yolcu adı, adresler, rezervasyon notu ve sürücü IBAN'ı da şifrelenir. |
| `otp_challenges` | Yeni tablo. SMS kodunun kendisi değil HMAC özeti, deneme sayısı ve geçerlilik süresi tutulur. |
| `sessions` | `refresh_token_hash` eklendi. Yenileme jetonu her kullanımda değişir. |
| İptal politikası | `cancellation_policies` başlık tablosu, kademeler `cancellation_policy_tiers` tablosunda. Rezervasyon tek bir politika kimliğini dondurur. |
| `exchange_rates` | Yeni tablo. EUR/TRY kuru burada tutulur, TRY rezervasyonda `bookings.exchange_rate_id` ile dondurulur. |
| `bookings` dondurulan alanlar | `pricing_rule_id`, `round_trip_discount_id`, `commission_rule_id`, `commission_rate`, `exchange_rate_id`, `price_eur`, `total_amount`. |
| `booking_legs` | Durum (`status`), atanan sürücü ve araç, koordinatlar ve süre eklendi. |
| `payments.merchant_oid` | Sağlayıcıya gönderilen sipariş numarası. Her ödeme denemesinde yeni üretilir. |
| `driver_ledger.net_amount_try` | EUR işlerde kur yoksa boş kalabilir. Hakediş ödemesi oluşturulurken o günün kuruyla doldurulur. |
| `audit_logs` | Değiştirilemezlik PostgreSQL tetikleyicisiyle sağlanır (`0002` migration). |
| Bölge konumu | `regions.location` alanı, enlem ve boylamdan türetilen PostGIS `geography` sütunudur. |
