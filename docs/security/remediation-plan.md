# Güvenlik düzeltme planı

- Tarih: 2026-11-12
- Dal / taban: `claude/security-audit-hardening-5c0e1f` / `0f13f2b`
- Kaynak: `docs/security/findings.md` (94 kanonik bulgu). Fazlar yönetici tarafından atandı.
- Efor ölçeği: S = yarım gün ya da daha az, M = 1-3 gün, L = 3 günden fazla ya da birden çok katman.
- Test kuralı: Her madde için önce açığı gösteren kırmızı test yazılır ve başarısız olduğu görülür, sonra düzeltme yapılıp test yeşile çevrilir. Aşağıdaki test adları önerilen adlardır, henüz yoktur. Backend testleri `backend/tests/` altında pytest, web ve admin testleri mevcut test aracıyla, mobil testler jest ile yazılır.
- CLAUDE.md K-53'e göre bu maddelerin çoğu "Büyük / riskli" sınıfındadır (giriş ve kimlik, ödeme, kişisel veri, migration). Her maddeden sonra `code-reviewer` incelemesi yapılır, kullanıcıya görünen akış değiştiyse `qa-tester` da çalıştırılır.
- Madde sayıları: Faz 0'da 6, Faz 1'de 18, Faz 2'de 20 madde var. Ayrıca aksiyon gerektirmeyen 5 Bilgi kaydı listelendi.

---

## Faz 0: Acil

### F0-1: INF-01, env Literal ve sahte ödeme uçlarının yalnızca dev/test'te router'a eklenmesi
- İş: `env` alanı `Literal["dev","test","prod"]` yapılacak, bilinmeyen değerle uygulama açılmayacak. "prod değilse" koşulları izin listesine (`env in {"dev","test"}`) çevrilecek. Sahte ödeme router'ı yalnızca dev ve test'te `include_router` ile eklenecek. `dev_code` ve `/docs` için aynı izin listesi kullanılacak. Mobilde `dev_code` yalnızca `__DEV__` iken gösterilecek.
- Efor: M
- Bağımlılık: yok. F0-5 ile aynı dosyayı (`config.py`) değiştirdiği için ikisi birlikte yapılmalı.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_settings_rejects_unknown_env` (`production`, `staging`, `Prod`)
  - `test_fake_payment_routes_not_mounted_in_prod`
  - `test_dev_code_only_returned_in_dev_and_test`
  - `test_docs_disabled_outside_dev_test`
  - mobil `login.test.tsx`: "dev_code __DEV__ false iken gösterilmez"

### F0-2: AUTH-01, deneme sayacı, kilit ve MFA jetonu tek kullanımı
- İş: Hesap ve IP başına Redis sayacı eklenecek. MFA jetonuna `jti` eklenecek, jeton başına en fazla 5 deneme hakkı olacak ve başarılı kullanımdan sonra jeton iptal edilecek. Kullanıcı başına 15 dk'da 10 hatada geçici kilit ve artan bekleme uygulanacak, kilit olayı denetim kaydına ve bildirime gidecek. Argon2 doğrulaması semafor arkasında çalışacak.
- Efor: M
- Bağımlılık: Redis. IP bazlı sayaç ancak F1-2 (AUTH-05) tamamlandıktan sonra güvenilir olur. Hesap bazlı sayaç ve jeton tek kullanımı AUTH-05'ten bağımsız çalışır. AUTH-07'nin jeton kısmı da bu maddeyle kapanır.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_staff_2fa_mfa_token_revoked_after_5_failures`
  - `test_mfa_token_single_use`
  - `test_staff_login_locks_after_10_failures_in_15_min`
  - `test_staff_lockout_writes_audit_event`

### F0-3: AUTH-04, IP başına ve küresel OTP sınırı
- İş: `/auth/otp/request` için IP başına ve /24 (IPv6 için /64) blok başına dakikalık ve saatlik sınır, ayrıca küresel saatlik/günlük OTP bütçesi konacak. Ülke kodu izin listesi ya da TR dışı numaralar için ayrı bir kota tanımlanacak. Bütçe aşımında devre kesici ve alarm devreye girecek. Netgsm tarafındaki günlük limit operasyon görevi olarak not edilecek.
- Efor: M
- Bağımlılık: Redis. IP sınırının tam etkisi F1-2'ye (AUTH-05) bağlı. Küresel bütçe ondan bağımsız çalışır. Hız sınırının nerede olacağı iş kararı (1)'e bağlı.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_otp_request_limited_per_ip`
  - `test_otp_request_global_budget_enforced`
  - `test_otp_request_rejects_disallowed_country_code`

### F0-4: PRIV-01, silme talebi akışının anonimleştirmeye bağlanması ve kapsamının genişletilmesi
- İş: `silme` talebi ancak anonimleştirmeyle tamamlanabilecek (AdminOnly; destek rolü tamamlayamayacak). Anonimleştirme kapsamına `bookings.passenger_name/note`, bacak adres ve koordinatları (NULL ya da bölge merkezi), `push_token`, `sessions` IP/UA, `consents.ip` (hukuki karara göre), `trip_messages`, `trip_updates` ve `data_requests.note` eklenecek. Sürücü için eşdeğer akış ve erişim talebi için JSON dışa aktarım ucu ayrı alt görevler olarak açılacak.
- Efor: L
- Bağımlılık: Yasal olarak saklanacak alanlar için iş kararı (2) gerekiyor. Koordinat şeması DB-04 (F2-3) ile uyumlu tutulmalı.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_completing_deletion_request_requires_anonymization`
  - `test_support_role_cannot_complete_deletion_request`
  - `test_anonymize_customer_clears_booking_and_leg_pii`
  - `test_anonymize_customer_clears_session_ip_and_push_token`
  - Admin UI: talep ekranından anonimleştirme akışı (qa-tester)

### F0-5: PRIV-02 ve INF-02, konsol SMS loglarının maskelenmesi ve prod validator redleri
- İş: Konsol SMS sağlayıcısında telefon maskelenecek ve OTP kodu loglanmayacak. CI'da log artefaktı yalnızca hata durumunda ve maskeli yüklenecek. Prod validator'a şu redler eklenecek: konsol SMS, `paytr_test_mode`, PayTR seçiliyken boş merchant alanları, dev `database_url` ve `sslmode` eksikliği, parolasız ya da TLS'siz Redis (F0-6 ile ortak), localhost/http CORS ve `public_web_url`, 32 bayttan kısa `jwt_secret` ve `blind_index_key`.
- Efor: M
- Bağımlılık: F0-1 (aynı validator).
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_console_sms_log_masks_phone_and_omits_code`
  - `test_prod_rejects_console_sms`
  - `test_prod_rejects_paytr_test_mode`
  - `test_prod_rejects_empty_paytr_credentials`
  - `test_prod_rejects_dev_database_url_and_missing_sslmode`
  - `test_prod_rejects_localhost_cors_and_http_public_url`
  - `test_prod_rejects_short_secrets`

### F0-6: RT-01, ARQ JSON serializer, compose'a Redis parolası, prod validator'da Redis parolası ve TLS şartı
- İş: Worker ayarlarında ve `create_pool` çağrılarında `job_serializer` ve `job_deserializer` JSON olacak. Compose'da Redis `127.0.0.1:6379:6379` adresine bağlanacak ve `--requirepass ${REDIS_PASSWORD}` ile çalışacak, `.env.example` ve `redis_url` güncellenecek. Prod validator parolasız ya da `rediss://` olmayan Redis adresini reddedecek. Aynı compose değişikliğinde Postgres de `127.0.0.1`'e bağlanmalı (DB-10'u öne çeker, isteğe bağlı).
- Efor: M
- Bağımlılık: F0-5 (validator kuralı ortak).
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_worker_settings_use_json_serializer`
  - `test_worker_rejects_pickle_job_payload`
  - `test_prod_rejects_redis_without_password_or_tls`
- Elle doğrulama: parolasız `redis-cli PING` NOAUTH dönmeli. LAN erişimi için dinamik test yapılmalı.

---

## Faz 1: Kısa vade

### F1-1: AUTH-02, 2FA kurulum ve sıfırlamanın sertleştirilmesi
- İş: İlk kurulum tek kullanımlık davet bağlantısıyla yapılacak ve ilk girişte parola değişikliği zorunlu olacak. Her kurulum başlangıcında yeni sır üretilecek. `reset_2fa` ve rol değişikliğinde tüm oturumlar iptal edilecek.
- Efor: M
- Bağımlılık: yok (admin UI değişikliği var, qa-tester çalıştırılmalı).
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_reset_2fa_revokes_all_sessions`
  - `test_2fa_setup_generates_new_secret_each_time`
  - `test_role_change_revokes_sessions`

### F1-2: AUTH-05, güvenilir proxy listesi
- İş: `trusted_proxies` ayarı eklenecek (Cloudflare aralıkları ve BFF adresi). `client_ip` başlığı yalnızca güvenilir bir kaynaktan geldiğinde okuyacak ve değeri `ipaddress` ile doğrulayacak. BFF istemciden gelen IP başlığını aktarmayacak, backend'e paylaşılan sırla imzalı bir iç başlık gönderecek.
- Efor: M
- Bağımlılık: Kalıcı çözüm iş kararı (3)'e (dağıtım topolojisi) bağlı. F0-2 ve F0-3'ün IP sayaçları bu maddeye dayanıyor, bu yüzden Faz 0'ın hemen ardından yapılmalı.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_client_ip_ignores_header_from_untrusted_peer`
  - `test_client_ip_uses_header_from_trusted_proxy`
  - `test_client_ip_invalid_value_falls_back_to_socket`
  - BFF testi: "istemci `cf-connecting-ip` değeri aktarılmaz"

### F1-3: AUTH-06, askıdaki sürücünün atamalarının ve oturumlarının iptali
- İş: İş, yolculuk, konum ve sohbet uçları için `ApprovedDriver` bağımlılığı eklenecek. Askıya alma ve reddetmede ileri tarihli ve aktif bacaklar PENDING'e dönecek, operasyona uyarı gidecek ve sürücü oturumları iptal edilecek.
- Efor: M
- Bağımlılık: yok. MON-12'nin "onaylı sürücü" ön koşulunu da sağlar.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_suspended_driver_cannot_access_trips_location_chat`
  - `test_suspend_driver_returns_future_legs_to_pending`
  - `test_suspend_driver_revokes_sessions`

### F1-4: AUTH-08 (ve MON-11), refresh yeniden kullanım tespiti
- İş: `previous_refresh_hash` saklanacak. Eski jeton gelirse oturum ailesi iptal edilecek, `security.refresh_reuse` kaydı yazılacak ve alarm üretilecek. Personel oturumları için 12 saatlik mutlak ömür ve boşta kalma süresi konacak.
- Efor: M
- Bağımlılık: Bu madde bir migration içeriyor. Alarm kısmı MON-09'a (F2-4) bağlı, kayıt kısmı bağımsız.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_refresh_reuse_revokes_session_family`
  - `test_refresh_reuse_writes_audit_event`
  - `test_staff_session_absolute_lifetime_12h`

### F1-5: MON-03, quotes ve places hız sınırı
- İş: `/quotes` ve `me/bookings` teklif hesabı için IP başına ve küresel sınır konacak, `places` uçlarının sınırı korunacak. Rota önbelleği Redis'e taşınabilir (isteğe bağlı alt görev). Google Cloud kota ve bütçe alarmı operasyon görevi olarak not edilecek.
- Efor: S (önbellek taşıması dahil edilirse M)
- Bağımlılık: Etkinlik için F1-2 gerekli. Hız sınırının yeri iş kararı (1)'e bağlı.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_quotes_rate_limited_per_ip`
  - `test_quotes_global_limit`

### F1-6: API-06, geçersiz imzalı webhook kaydının sınırlanması
- İş: Saklanacak yük bilinen PayTR alanlarına indirilecek ve değerler kırpılacak. Geçersiz imzada tam satır yerine sayaç, özet log ve kaynak IP tutulacak. Uca gövde boyutu ve hız sınırı konacak.
- Efor: S
- Bağımlılık: yok. Alarm kısmı F2-4'e bağlı.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_invalid_signature_callback_does_not_store_full_payload`
  - `test_callback_payload_trimmed_to_known_fields`

### F1-7: API-07, yükleme kotası
- İş: Gövde boyutu middleware'i eklenecek (yükleme ucu için yaklaşık 12 MB, diğer uçlar için 1 MB). Sürücü, araç ve `doc_type` başına kota ve tek bir bekleyen belge kuralı getirilecek. Yükleme ucuna hız sınırı konacak.
- Efor: M
- Bağımlılık: yok. Reddedilen belgelerin silinmesi F2-3'te.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_request_body_over_limit_rejected_413`
  - `test_document_upload_quota_per_doc_type`
  - `test_document_upload_rate_limited`

### F1-8: BIZ-02, zaman ve durum kontrolleri
- İş: DEPARTED ve STARTED adımlarında `pickup_at` ile tolerans penceresi uygulanacak. FINISHED için asgari süre aranacak. Son konumlar üzerinde hız ve sıçrama makullük kontrolü yapılacak. Sürücü erken bitişleri admin raporuna eklenecek. Hakediş için itiraz bekleme süresi ayrı bir alt görev olarak açılacak.
- Efor: M
- Bağımlılık: F1-3 (onaylı sürücü kontrolü). Mobil `mocked` alanı F2-17'de.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_trip_cannot_depart_before_window`
  - `test_trip_finish_requires_min_duration_after_start`
  - `test_trip_finish_rejects_impossible_speed_jump`
  - `test_early_driver_finish_listed_in_admin_report`

### F1-9: BIZ-03, iade idempotency ve kilit
- İş: Outbox deseni uygulanacak: Refund önce PENDING olarak commit edilecek, sağlayıcı işlem dışında çağrılacak, sonuç ayrı bir işlemle yazılacak. Zaman aşımında UNKNOWN durumu ve mutabakat kullanılacak. `retry_refund` Payment satırını kilitleyip kalan tutarı yeniden kontrol edecek. Benzersiz iade referansı gönderilecek.
- Efor: L
- Bağımlılık: PayTR iade API'sinin davranışı belgeyle ve test ortamında doğrulanmalı (dinamik test).
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_refund_timeout_marks_unknown_not_failed`
  - `test_retry_refund_locks_payment_and_rechecks_remaining`
  - `test_concurrent_retry_and_staff_refund_do_not_exceed_paid`
  - `test_cancel_commit_failure_does_not_double_refund`

### F1-10: PRIV-03, teklif koordinatlarının kırpılması
- İş: `list_offers` yanıtında koordinatlar `None` olacak ya da `job_preview_trim_m` ile kırpılacak.
- Efor: S
- Bağımlılık: yok (mobil teklif ekranı kontrol edilmeli).
- Kabul: Kırmızı test önce yazılır, sonra yeşile çevrilir: `test_offer_response_has_no_exact_coordinates`.

### F1-11: PRIV-04, push içeriğinin en aza indirilmesi
- İş: `new_message` için sabit "Yeni mesaj" metni kullanılacak, mesaj metni `trip_updates.body`'ye ve push yüküne yazılmayacak. Uçuş bildirimlerinde uçuş numarası yer almayacak. `docs/yasal_ve_guvenlik.md:27` koda göre düzeltilecek.
- Efor: S
- Bağımlılık: yok (mobilde bildirim metni değişiyor, qa-tester çalıştırılmalı).
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_new_message_update_body_has_no_message_text`
  - `test_push_payload_has_no_message_text`
  - `test_flight_update_has_no_flight_number`

### F1-12: WEB-01, BFF yol normalizasyonu ve dinamik test
- İş: Web ve admin BFF'de `.`, `..`, `/`, `\`, `?`, `#`, `%` ve kontrol karakteri içeren segmentler 400 ile reddedilecek. Segmentler `encodeURIComponent` ile kodlanacak. Upstream `new URL()` ile kurulacak ve kanonik `pathname` yeniden izin listesinden geçirilecek.
- Efor: S
- Bağımlılık: yok. WEB-06'nın ikinci savunma katmanını da sağlar.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `bff rejects dot segments`
  - `bff rejects encoded slash in segment`
  - `bff upstream pathname stays under allowlist`
- Dinamik test: `next start` ve `curl --path-as-is` ile `/bff/me/..%2Fdriver%2Fme` isteği 400/404 dönmeli.

### F1-13: WEB-04 ve WEB-05, CSP nonce ve HSTS
- İş: Middleware'de istek başına nonce üretilecek ve `script-src 'self' 'nonce-...' 'strict-dynamic'` kullanılacak. Admin öncelikli. Prod'da HSTS başlığı eklenecek ya da CDN'de açık olduğu belgelenecek.
- Efor: M
- Bağımlılık: HSTS kararı iş kararı (3)'e bağlı.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `csp header contains nonce and no unsafe-inline` (web ve admin)
  - `hsts header present in production`

### F1-14: DB-03, test DB adı koruması
- İş: Fikstür yalnızca `GETAWAY_TEST_DATABASE_URL` değişkenini okuyacak. DB adı `_test` ile bitmiyorsa ya da host localhost değilse `pytest.exit` çağrılacak.
- Efor: S
- Bağımlılık: yok (CI ortam değişkenleri güncellenmeli).
- Kabul: Kırmızı test önce yazılır, sonra yeşile çevrilir: `test_conftest_refuses_non_test_database`.

### F1-15: MON-08, denetim kaydı kapsamı
- İş: `security.*` olayları eklenecek: `otp.request`, `otp.verify_failed`, `auth.refresh_failed`, `auth.forbidden` (örneklenmiş), `webhook.invalid_signature`, `session.revoke`. Admin PII okuma uçlarına `*.view` kaydı eklenecek (PRIV-07'nin denetim kısmı dahil).
- Efor: M
- Bağımlılık: Yüksek hacimli olaylar için F2-4. F1-4'teki `refresh_reuse` olayıyla birlikte yapılabilir.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_otp_verify_failure_audited`
  - `test_forbidden_response_audited_sampled`
  - `test_admin_booking_detail_read_audited`
  - `test_invalid_webhook_signature_audited`

### F1-16: RT-03, RT-04 ve RT-05, WebSocket periyodik yeniden doğrulama, async çalışma ve sınırlar
- İş: Oturum ve `exp` her ~30 sn'de yeniden kontrol edilecek. Tüm bacaklar terminal duruma geçince bağlantı kapatılacak ve mutlak ömür konacak. DB ve Redis çağrıları threadpool'a ya da `redis.asyncio`'ya taşınacak, Redis istemcisine zaman aşımı eklenecek. Ön zaman aşımı 3-5 sn'ye inecek, ilk mesaj için 4 KiB sınırı ve oturum başına bağlantı sınırı konacak. İstisnalar loglanacak.
- Efor: M
- Bağımlılık: yok.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_ws_closes_after_session_revoked`
  - `test_ws_closes_after_token_expiry`
  - `test_ws_closes_when_all_legs_terminal`
  - `test_ws_rejects_oversized_first_message`
  - `test_ws_connection_limit_per_session`
  - `test_live_location_redis_client_has_timeouts`

### F1-17: INF-03, next-intl 4.15 sürümüne yükseltme
- İş: `next-intl` 4.15.0 ya da üstüne yükseltilecek ve yönlendirme regresyon testi eklenecek.
- Efor: S
- Bağımlılık: yok.
- Kabul: Kırmızı test önce yazılır (mevcut sürümde istismar yolu yoksa test baştan yeşil olabilir; bu durum not edilmeli), sonra yükseltme yapılır. Test adı: `middleware does not redirect off-origin` ve yükleri `/%09/evil`, `/%5C%5Cevil`, `//evil`, `/en/%09/evil`.

### F1-18: EXT-01, CSV kaçışlama
- İş: Hakediş CSV'sinde `=`, `+`, `-`, `@`, sekme ve CR ile başlayan hücrelerin başına `'` eklenecek. Aynı yardımcı fonksiyon diğer CSV dışa aktarımlarında da kullanılacak.
- Efor: S
- Bağımlılık: yok.
- Kabul: Kırmızı test önce yazılır, sonra yeşile çevrilir: `test_payout_csv_escapes_formula_prefix`.

---

## Faz 2: Yapısal

### F2-1: DB-01, en az yetkili DB rolleri
- İş: Migration ile `getaway_owner`, `getaway_app` ve isteğe bağlı salt okunur rol oluşturulacak. `REVOKE ALL FROM PUBLIC` yapılacak ve `audit_logs` üzerinde yalnızca SELECT ve INSERT verilecek. Ayrı bir `GETAWAY_MIGRATION_DATABASE_URL` tanımlanacak. Prod açılışında `rolsuper` kontrolü yapılacak. CI'daki SUPERUSER rolü kaldırılacak.
- Efor: L
- Bağımlılık: Bu madde bir migration. Dağıtım topolojisi için iş kararı (3) gerekiyor.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_app_role_is_not_superuser`
  - `test_app_role_cannot_update_or_delete_audit_logs`

### F2-2: DB-02, audit log sertleştirme
- İş: `created_at` INSERT tetikleyicisiyle `now()` değerine zorlanacak. `prev_hash/row_hash` ile hash zinciri kurulacak ve son özet periyodik olarak DB dışına yazılacak. Doküman ifadesi düzeltilecek.
- Efor: M
- Bağımlılık: F2-1.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_audit_created_at_forced_by_trigger`
  - `test_audit_hash_chain_detects_deleted_row`

### F2-3: DB-04, PRIV-05 ve PRIV-06, koordinat saklama ve anonimleştirme kapsamı, saklama süresi cron'ları
- İş: Koordinatlar şifreli saklanacak. Tamamlanmış bacaklarda koordinatlar N gün sonra bölge merkezine indirgenecek. Süresi geçen oturumlar silinecek. Reddedilen ve süresi dolan belge dosyaları silinecek (`storage.delete`). `audit_logs.ip` için süre belirlenecek. Sürücü geçmiş yolculuklarında PII gizlenecek. Aydınlatma metnine IP işleme amacı eklenecek.
- Efor: L
- Bağımlılık: Bu madde bir migration. Saklama süreleri için iş kararı (2) gerekiyor. F0-4 ile aynı alanlara dokunuyor.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_leg_coordinates_encrypted_at_rest`
  - `test_completed_leg_coordinates_coarsened_after_retention`
  - `test_purge_expired_sessions`
  - `test_rejected_documents_deleted_after_retention`
  - `test_driver_past_trip_hides_passenger_pii`

### F2-4: MON-09, Sentry ve log
- İş: Backend, worker ve Next.js için Sentry kurulacak (AB bölgesi, PII temizliği). JSON log ve istek kimliği eklenecek. Bulgudaki alarm listesi tanımlanacak.
- Efor: M
- Bağımlılık: Hangi Sentry projesinin kullanılacağı açık konu (`docs/acik_konular.md:28`).
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_unhandled_exception_reported_to_error_tracker` (stub ile)
  - `test_log_records_are_json_with_request_id`

### F2-5: MON-10, olay müdahale runbook'u, anahtar rotasyonu ve `kid`
- İş: `docs/olay_mudahale.md` yazılacak. `revoke-sessions` CLI'si eklenecek. Amaca göre anahtar ayrımı yapılacak, `kid` ve çoklu doğrulama anahtarı desteklenecek. Blind index sürüm alanı ve yeniden indeksleme komutu (DB-09 ile birlikte) ve Fernet yeniden şifreleme komutu yazılacak.
- Efor: L
- Bağımlılık: DB-09 (F2-14).
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_cli_revoke_sessions_all_and_by_kind`
  - `test_jwt_verifies_with_previous_kid_during_rotation`
  - `test_place_token_not_valid_as_access_token_after_key_split`

### F2-6: INF-05 ve INF-08 (ayrıca INF-06, INF-07, INF-09, INF-12), tedarik zinciri
- İş: Dependabot eklenecek (npm x4, pip, github-actions, docker). CI'ya `npm audit --omit=dev --audit-level=high` ve `pip-audit` adımları eklenecek (başta uyarı modunda). gitleaks pre-commit kurulacak ve `.gitignore` desenleri genişletilecek. Action'lar SHA ile sabitlenecek. Maestro sabit sürüm ve SHA-256 doğrulamasıyla kurulacak, Google anahtarı adım düzeyindeki env'e taşınacak. Hash'li `requirements` lock dosyası oluşturulacak ve `requirements-dev.txt` ayrılacak. Expo SDK 58 yaması uygulanacak.
- Efor: M
- Bağımlılık: yok.
- Kabul:
  - CI denetim adımı mevcut lock dosyasında bulguları raporlamalı (kırmızı), güncellemeden sonra yeşil olmalı.
  - gitleaks örnek bir sahte anahtar desenini yakalamalı (kırmızı test fikstürü).
  - `git check-ignore mobile/google-services.json` eşleşme döndürmeli.

### F2-7: Mobil sertleştirme (MOB-03, MOB-04, MOB-06, MOB-11)
- İş: `app.config.ts` production ve preview profillerinde http adresini ve cleartext bayrağını reddedecek. Sertifika sabitleme kararı ve rotasyon planı netleşecek. App Links ve Universal Links kurulacak. `expo-screen-capture` değerlendirilecek. Prebuild çıktısında `allowBackup` kontrol edilecek.
- Efor: L
- Bağımlılık: Mağaza öncesi takvim. Pinning için iş kararı (3) (Cloudflare sertifika rotasyonu) gerekiyor.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `app.config throws for http apiUrl in production profile`
  - `app.config throws when GETAWAY_ANDROID_CLEARTEXT set for store profile`
  - Prebuild manifest kontrol betiği (`allowBackup=false` ya da hariç tutma kuralları)

### F2-8: BIZ-04, fiyat ezme sınırı ve görev ayrılığı
Bu Orta bulgu yönetici faz atamasında yoktu, burada ele alındı.
- İş: Ezme oranına yapılandırılabilir bir sınır konacak. Sınır dışı ezmelerde ve elle tahsilatlarda FinanceStaff onayı aranacak. `reference` zorunlu olacak. Ezilmiş rezervasyonun hakedişi onaya düşecek ya da `min(system, override)` üzerinden hesaplanacak.
- Efor: M
- Bağımlılık: Onay akışı için iş kararı gerekebilir (rol tanımları).
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_override_total_outside_ratio_requires_finance_approval`
  - `test_manual_payment_requires_reference`
  - `test_overridden_booking_earning_capped`

### F2-9: PRIV-07, admin rezervasyon detayında maskeleme
Bu Orta bulgu yönetici faz atamasında yoktu. Okuma denetimi kısmı F1-15'te karşılanıyor.
- İş: Destek rolü için yolcu adı ve not maskelenecek ya da tam gösterim bilinçli bir karar olarak `docs/kararlar.md`'ye yazılacak.
- Efor: S
- Bağımlılık: F1-15.
- Kabul: Kırmızı test önce yazılır, sonra yeşile çevrilir: `test_admin_booking_detail_masks_passenger_for_support_role`.

### F2-10: Kimlik kalanları (AUTH-07, AUTH-10)
- İş: `users.totp_last_step` alanı eklenecek ve tekrar kullanılan kod reddedilecek. 2FA adımında ACTIVE olmayan kullanıcı reddedilecek.
- Efor: S
- Bağımlılık: F0-2 (MFA jetonu tek kullanımı zaten yapılmış olacak).
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_totp_code_reuse_rejected`
  - `test_2fa_rejects_disabled_user`

### F2-11: API girdi hijyeni (API-08, API-09, API-10, API-11)
- İş: UA alanı kırpılacak ve IP doğrulanacak. Jeton ve kod alanlarına `max_length` ve desen konacak, `pickup_at` ve `expected_total` aralıkları tanımlanacak. PayTR `reason` istemciye dönmeyecek. `merchant_oid` güvenli biçimde loglanacak.
- Efor: S
- Bağımlılık: F1-2 (IP doğrulaması).
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_long_user_agent_does_not_500`
  - `test_quote_rejects_far_future_pickup`
  - `test_payment_error_hides_provider_reason`
  - `test_merchant_oid_log_strips_crlf`

### F2-12: Ödeme ve iş mantığı kalanları (BIZ-05, BIZ-06, BIZ-07, BIZ-08, BIZ-09, BIZ-10)
- İş: Serbest adres için "konum doğrulanmadı" işareti eklenecek. Para birimi profil ülkesine bağlanacak. `total_amount` yoksa ödeme reddedilecek ve `currency` karşılaştırılacak. Kilit sırası birleştirilecek ve deadlock 409 dönecek. Ödeme sayfası penceresi 31 dk olacak. Tam iadede hakediş iptali sorulacak.
- Efor: M
- Bağımlılık: BIZ-08 için dinamik test. BIZ-10 admin UI değişikliği içeriyor.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_callback_without_total_amount_rejected`
  - `test_callback_currency_mismatch_rejected`
  - `test_quote_currency_ignores_request_country`
  - `test_accept_job_and_offer_concurrent_no_deadlock`
  - `test_payment_page_reuse_window_exceeds_provider_timeout`

### F2-13: Dayanıklılık kalanları (MON-12, MON-13, MON-14, MON-15)
- İş: `approach` için sürücü başına sınır ve önbellek eklenecek. `offset` üst sınırı ve sınırsız uçlara limit konacak, N+1 sorgular düzeltilecek. Worker işleri ayrı try/except içinde çalışacak ve "son başarılı çalışma" metriği eklenecek. Yalnızca iç ağdan erişilen `/ready` ucu eklenecek.
- Efor: M
- Bağımlılık: F1-3, F2-4.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_approach_rate_limited_per_driver`
  - `test_admin_list_offset_capped`
  - `test_worker_job_failure_does_not_skip_next_job`
  - `test_ready_checks_db_and_redis`

### F2-14: Veri ve şifreleme kalanları (DB-07, DB-08, DB-09, DB-12, DB-13)
- İş: Serbest metinler şifrelenecek ve `reason`/`reference` maskelenecek. Plaka hash'lenecek. IP'leri 90 gün sonra maskeleyen iş eklenecek. Kritik alanlar AAD ile bağlanacak. Blind index için HKDF alt anahtar ve sürüm alanı eklenecek. Yedekleme prosedürü belgelenecek. LIKE autoescape açılacak.
- Efor: L
- Bağımlılık: Bu madde bir migration. F2-5 (rotasyon araçları) ile birlikte yapılmalı.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_audit_masks_reason_and_reference`
  - `test_iban_ciphertext_swapped_between_rows_fails_to_decrypt`
  - `test_blind_index_domain_separated_from_otp_hash`
  - `test_audit_action_filter_escapes_wildcards`

### F2-15: Gizlilik kalanları (PRIV-08, PRIV-10, PRIV-12, PRIV-13)
- İş: Netgsm POST veya Basic Auth API'sine geçilecek. İptalde `purge_at = now` atanacak ve docstring'ler düzeltilecek. Konsol push gövdesi loglanmayacak. Veri talebi notu şifrelenecek ve müşteri ile personel notları ayrılacak. Loglarda uçuş numarası maskelenecek.
- Efor: M
- Bağımlılık: Netgsm API belgesi.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_netgsm_request_has_no_credentials_in_query`
  - `test_cancel_sets_flight_purge_now`
  - `test_console_push_log_has_no_body`
  - `test_data_request_staff_note_does_not_overwrite_customer_note`

### F2-16: Web kalanları (WEB-03, WEB-06, WEB-07, WEB-08)
- İş: Sabit `ALLOWED_ORIGINS` eşleşmesi kullanılacak. Admin `[id]` için UUID doğrulaması ve kodlama eklenecek. Yan etkili GET'ler POST'a taşınacak ya da `Sec-Fetch-Site` kontrol edilecek. `__Secure-` öneki değerlendirilecek.
- Efor: S
- Bağımlılık: F1-12.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `bff rejects origin not in allowlist even with matching x-forwarded-host`
  - `admin booking page returns notFound for non-uuid id`
  - `messages read marking requires POST`
- Dinamik test: hazırlanmış bağlantıyla WEB-06 denenmeli.

### F2-17: Mobil kalanları, mağaza öncesi (MOB-01, MOB-02, MOB-05, MOB-07, MOB-10 ve BIZ-02'nin `mocked` kısmı)
- İş: Çıkışta konum görevi durdurulacak. Derin bağlantı parametreleri doğrulanacak ve kodlanacak, `pay=1` yok sayılacak. Maps anahtar kısıtlamaları konsolda yapılıp kayda geçirilecek. Başarısız logout kuyruklanacak. Web önizleme kararı yazılacak. Konum olaylarına `coords.mocked` eklenecek.
- Efor: M
- Bağımlılık: Cihazda dinamik test. Backend tarafında `mocked` işaretlemesi F1-8 ile birlikte yapılmalı.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `signOut stops background location updates`
  - `booking screen does not fetch with traversal code`
  - `deep link pay=1 ignored`
  - `logout retried after network failure`

### F2-18: Gerçek zamanlı kalanları (RT-07, RT-08, RT-10)
- İş: Devirden sonra sürücü sohbet görünümü sınırlanacak. Push jeton biçimi doğrulanacak, jeton taşınması denetlenecek ve jeton oturuma bağlanacak. Sohbet sınırı Redis `INCR` ile atomik hale getirilecek.
- Efor: M
- Bağımlılık: RT-07 için iş kuralı onayı gerekiyor.
- Kabul: Kırmızı testler önce yazılır, sonra yeşile çevrilir:
  - `test_reassigned_driver_cannot_read_previous_driver_messages`
  - `test_push_token_format_validated`
  - `test_message_rate_limit_atomic_under_concurrency`

### F2-19: Altyapı kalanları (DB-10, INF-04, INF-11, INF-13)
- İş: Postgres `127.0.0.1`'e bağlanacak ve parola `.env`'den gelecek, uvicorn görevi `--host 127.0.0.1` ile çalışacak (F0-6'ya öne çekilebilir). Image'lar digest ile sabitlenecek ve tek bir Postgres major sürümü kullanılacak. `stage` ortamı tanımlanacak ve preview profilleri staging'e yönlendirilecek. Next yamaları izlenecek.
- Efor: M
- Bağımlılık: `stage` ortamı için iş kararı (3) ve INF-01'deki `Literal` değerinin genişletilmesi gerekiyor.
- Kabul:
  - `docker compose config` çıktısında port bağlamaları 127.0.0.1 olmalı (elle doğrulama).
  - `test_stage_env_applies_prod_validators` (kırmızı, sonra yeşil).

### F2-20: EXT-02, belge geçerlilik tarihinin onayı
- İş: Belge onayında `valid_until` alanını inceleyen kişi açıkça teyit edecek. Tarih değişikliği denetim kaydına yazılacak.
- Efor: S
- Bağımlılık: Admin UI değişikliği içeriyor, qa-tester çalıştırılmalı.
- Kabul: Kırmızı test önce yazılır, sonra yeşile çevrilir: `test_document_approval_requires_reviewer_confirmed_valid_until`.

### Aksiyon gerektirmeyen kayıtlar
API-14, API-15, API-16, BIZ-11 ve PRIV-11 olumlu tespitler. Bu kayıtlar regresyon referansı olarak tutulur. API-14'ün sertleştirme önerisi (`attachment` ve `CSP: sandbox`) isteğe bağlı olarak F2-16 ile birlikte yapılabilir.

---

## İş kararı gereken konular

1. **Hız sınırı uygulama içinde mi, altyapıda mı olacak?** Plan uygulama içi (Redis sayacı) varsayıyor: F0-2, F0-3, F1-5, F1-6, F1-7, F1-16, F2-13. Cloudflare veya WAF kuralları seçilirse uygulama içi sınırlar ikinci katman olarak kalır, ama öncelik ve efor değişir. Karar `docs/kararlar.md`'ye yazılmalı.
2. **KVKK saklama süreleri hukukçu teyidi gerektiriyor.** F0-4 (anonimleştirmede hangi alanların yasal olarak saklanacağı: fatura, tutar, tarih, `consents.ip`) ve F2-3 (oturum, koordinat, belge, `audit_logs.ip` süreleri) bu teyide bağlı. Teyit gelene kadar en kısıtlayıcı varsayımla ilerlenmeli ve süreler ayardan okunmalı.
3. **Üretim dağıtım topolojisi bilinmiyor** (Cloudflare var mı, origin doğrudan erişilebilir mi, reverse proxy, TLS sonlandırma noktası). AUTH-05'in kalıcı çözümü (F1-2: güvenilir proxy listesi, Authenticated Origin Pulls ya da firewall) buna bağlı. AUTH-05'in önemi (origin doğrudan erişilebilirse Yüksek), WEB-05 HSTS'in nerede açılacağı, MOB-03 pin rotasyonu ve DB-01/DB-11 rol ve TLS yapılandırması da bu karara bağlı. Kararla birlikte staging ortamının olup olmayacağı da netleşmeli (INF-13).
