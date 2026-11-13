# Güvenlik kontrol listesi (PR ve yayın öncesi)

Kısa ve işaretlenebilir tutulur. PR açıklamasına ilgili bölümler kopyalanır; ilgisiz bölüm "yok" diye geçilir.
Ayrıntılı bulgular: `docs/security/findings.md`, plan: `docs/security/remediation-plan.md`.
Büyük/riskli değişiklikte (ödeme, giriş, konum, kişisel veri, migration, yeni altyapı) K-53 gereği `code-reviewer` incelemesi de yapılır.

## Otomatik denetimler (kendiliğinden çalışır, sonucuna bakılır)

- [ ] `CI` ve `Güvenlik taraması` iş akışları yeşil (`.github/workflows/ci.yml`, `.github/workflows/security.yml`).
- [ ] gitleaks temiz. Bulgu gerçekse istisna **yazılmaz**: anahtar iptal edilir/döndürülür, sonra geçmiş temizliği değerlendirilir.
- [ ] bandit yeni Medium/High bulgu vermiyor. Taban çizgisi (`backend/.bandit-baseline.json`) yalnızca bulgu düzeltildiğinde ya da kabul gerekçesi `docs/security` altına yazıldığında yenilenir; satır içi `# nosec` gerekçesiz eklenmez.
- [ ] pip-audit temiz; npm audit uyarısı (web, admin, mobile) yeni bir high/critical içermiyor.
- [ ] CodeQL (Security -> Code scanning) yeni uyarı açmadı ya da uyarı gerekçesiyle kapatıldı.

## Kimlik ve yetki

- [ ] Yeni backend ucu `backend/app/api/deps.py` bağımlılıklarından biriyle korunuyor: `CurrentCustomer`, `CurrentDriver`, `AnyStaff`, `OpsStaff`, `OpsOrSupport`, `FinanceStaff`, `OpsOrFinance`, `AdminOnly`. Kimliksiz uç yalnızca bilinçli olarak `public.py`'de.
- [ ] Nesne düzeyi yetki: kayıt kimliğiyle gelen her sorgu sahiplik/atama koşuluyla (müşteri kendi rezervasyonu, sürücü kendi seferi) filtreleniyor; başka kullanıcının kimliğiyle 404 dönüyor ve bunun testi var.
- [ ] Rol değişikliği gerekiyorsa en dar `require_staff(...)` kümesi seçildi; `AdminOnly` gereksiz yere geniş kullanılmadı.
- [ ] Jeton, oturum, OTP, MFA veya parola akışı değiştiyse: tek kullanımlık jeton, yeniden kullanım tespiti ve kilitleme testleri koşuldu (`backend/tests/test_auth_phase1.py`).
- [ ] Web/admin BFF: yeni yol `web/app/bff/[...path]/route.ts` ya da `admin/app/bff/[...path]/route.ts` içindeki `ALLOWED` listesine **dar ve `^...$` ile çapalı** desenle eklendi; yol doğrulaması `lib/bffPath.ts` (`resolveBffPath`) üzerinden geçiyor. `web/lib/bffPath.ts` ve `admin/lib/bffPath.ts` aynı kalıyor; `web/e2e/bff-security.spec.ts` geçiyor.
- [ ] CSP/güvenlik başlıkları (`web/lib/csp.ts`, `admin/lib/csp.ts`, `middleware.ts`) gevşetildiyse gerekçesi yazıldı.

## Girdi doğrulama ve çıktı

- [ ] İstek gövdesi Pydantic şemasıyla doğrulanıyor (uzunluk, aralık, enum); serbest `dict` kabul edilmiyor.
- [ ] SQL yalnızca SQLAlchemy ifadeleriyle; `text()` içine kullanıcı girdisi birleştirilmiyor.
- [ ] Dosya yükleme: boyut sınırı (`body_limit.py`, `document_upload_max_body_bytes`) ve içerik türü denetimi korunuyor.
- [ ] CSV/Excel dışa aktarımında hücreler `app/csv_safe.py` (`csv_safe`) ile kaçışlanıyor.
- [ ] Harici XML/HTML ayrıştırılıyorsa güvenli ayrıştırıcı kullanılıyor (bkz. bandit B314, `app/providers/fx.py`).
- [ ] Yönlendirme ve geri dönüş adresleri izin listesine karşı denetleniyor (açık yönlendirme yok).

## Gizli bilgi

- [ ] Repoya parola, anahtar, jeton, servis hesabı JSON'u, `google-services.json`, `GoogleService-Info.plist`, `.p12/.jks/.keystore` eklenmedi.
- [ ] Yeni ayar `backend/app/config.py`'de; varsayılanı yalnızca geliştirme değeri, `.env.example`'da sahte değerle belgelendi.
- [ ] `.gitleaks.toml`'a istisna eklendiyse: dosya yolu **ve** değer/satır deseniyle (`condition = "AND"`) sınırlı, gerekçesi yazılı. Yalnızca yol hariç tutma yok.
- [ ] CI'da gizli değişken workflow düzeyinde değil, yalnızca ihtiyaç duyan adımın `env`'inde (INF-06).

## Kişisel veri ve KVKK

- [ ] Yeni kişisel veri alanı (telefon, e-posta, ad, belge, konum) `EncryptedString` ile şifreli; aranması gerekiyorsa `blind_index` sütunu var (`app/security/crypto.py`).
- [ ] Admin/sürücü yanıtlarında telefon ve e-posta gerekmedikçe `mask_phone` / `mask_email` ile maskeli.
- [ ] Silme talebi: yeni tablo/alan `app/services/privacy.py` (`anonymize_customer`) kapsamına eklendi ve testi var.
- [ ] Konum verisi yalnızca aktif sefer süresince ve yetkili tarafa açılıyor; saklama süresi belirli.
- [ ] Log, hata iletisi ve analitikte kişisel veri yok (telefon/e-posta maskeli, belge içeriği yok).

## Ödeme

- [ ] Webhook imzası doğrulanmadan durum değişmiyor; geçersiz imza sayaçları korunuyor (`app/services/payments.py`).
- [ ] Tutar ve para birimi sunucuda hesaplanıyor; istemciden gelen tutara güvenilmiyor.
- [ ] İade/iptal işlemleri idempotent ve kilitli (`backend/tests/test_payments_hardening.py`); aynı webhook iki kez işlense de çift kayıt olmuyor.
- [ ] Kart verisi hiçbir yerde saklanmıyor ve loglanmıyor.

## Veritabanı ve migration

- [ ] Migration hem `upgrade` hem `downgrade` ile yerelde denendi; veri kaybeden adım açıkça yazıldı.
- [ ] Testler yalnızca adı `_test` içeren yerel veritabanında koşuyor (`backend/tests/conftest.py` `assert_safe_test_database`); bu koruma gevşetilmedi.
- [ ] Şifreli sütun eklendiyse mevcut veri için dönüştürme/yeniden şifreleme adımı planlandı.

## Bağımlılık

- [ ] Yeni paket gerçekten gerekli; bakımı süren, yaygın kullanılan bir paket; sürüm `==` (pip) ya da lock dosyasıyla sabit.
- [ ] Mobilde Expo paketleri `npx expo install` ile eklendi (SDK uyumu); `npm audit fix --force` kullanılmadı.
- [ ] Yeni GitHub Action tam commit SHA'sıyla ve sürüm yorumuyla (`@<sha> # vX.Y.Z`) sabitlendi; SHA `git ls-remote` ile doğrulandı.

## Log ve izleme

- [ ] Güvenlik olayları (giriş hatası, kilitleme, yetki reddi, webhook imza hatası, admin işlemleri) `app/services/audit.py` (`record`) ile kayıtlı.
- [ ] Loglarda jeton, parola, OTP, tam telefon/e-posta yok.

## Hız sınırı ve kötüye kullanım

- [ ] Kimliksiz ya da maliyetli uç (OTP, fiyat teklifi, adres arama, uçuş takibi) Redis tabanlı hız sınırına bağlı (`quotes.check_rate_limit`, `places.check_rate_limit` örnekleri).
- [ ] İstemci IP'si yalnızca `deps.client_ip` ile alınıyor (güvenilir proxy listesi `GETAWAY_TRUSTED_PROXIES`); başlık doğrudan okunmuyor.

## Prod yapılandırması (yayın öncesi)

- [ ] `GETAWAY_ENV=prod` ile uygulama açılıyor; `Settings._prod_checks` hiçbir geliştirme varsayılanına (JWT, alan şifreleme, blind index anahtarı, yerel DB/Redis, `console` SMS/push, `fake` ödeme) izin vermiyor. Yeni gizli ayar eklendiyse `_prod_checks`'e de eklendi.
- [ ] Veritabanı bağlantısı TLS (`sslmode=require` ya da daha sıkı), Redis parolalı.
- [ ] Mobil production/preview derlemelerinde http adresi ve cleartext bayrağı yok.
- [ ] Admin ve web için güvenlik başlıkları (CSP, HSTS, frame-ancestors) canlı ortamda doğrulandı.

## Yerel kurulum: pre-commit kancaları

İsteğe bağlı ama önerilir. Aynı denetimler CI'da da çalışır.

```bash
pip install pre-commit
pre-commit install            # .git/hooks/pre-commit kurulur
pre-commit run --all-files    # ilk kurulumda bir kez tüm dosyalar
```

Yapılandırma `.pre-commit-config.yaml`: özel anahtar ve birleştirme çakışması tespiti, 1 MB üstü yeni dosya engeli, gitleaks (hazırlanan değişiklikler), bandit (`backend/app`, yalnızca High). gitleaks kancası ilk çalışmada Go araç zincirini indirir. Kanca bilinçli olarak atlanacaksa (`git commit --no-verify`) nedeni PR açıklamasına yazılır.

Yerelde tam tarama (Windows'ta `-r` yolları ters eğik çizgiyle üretildiği için taban çizgisindeki 3 bilinen bulgu
da listelenir: `app/api/deps.py` ve `app/config.py` B104, `app/providers/fx.py` B314; yenilere bakın):

```bash
backend/.venv/Scripts/python.exe -m pip install bandit pip-audit
backend/.venv/Scripts/python.exe -m bandit -r backend/app -c backend/.bandit.yml -ll -b backend/.bandit-baseline.json
backend/.venv/Scripts/python.exe -m pip_audit -r backend/requirements.txt
cd web && npm audit --omit=dev --audit-level=high
```
