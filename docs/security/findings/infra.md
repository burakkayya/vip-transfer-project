# Alan 9: Altyapı ve tedarik zinciri

- Tarih: 2026-11-12
- Dal: `claude/security-audit-hardening-5c0e1f`, taban `0f13f2b`
- Kapsam: bağımlılık açıkları (npm, pip), docker-compose, GitHub Actions, secret yönetimi, ortam ayrımı, Dependabot.
- Kod değiştirilmedi. Secret değerleri yazılmadı.
- Etiketler: `verified: <komut veya dosya:satır>` doğrudan görüldü; `belief` çıkarımdır, bağımsız doğrulanmalı.

## Özet

| Önem | Sayı | ID |
|---|---|---|
| Kritik | 0 | |
| Yüksek | 0 | |
| Orta | 5 | INF-01, INF-02, INF-03, INF-06, INF-08 |
| Düşük | 8 | INF-04, INF-05, INF-07, INF-09, INF-10, INF-11, INF-12, INF-13 |
| Bilgi | 1 | INF-14 |

### Audit komutları

| Komut | Sonuç |
|---|---|
| `cd web && npm audit --json` | çalıştı: 9 (1 high, 8 moderate). `--omit=dev`: 3 (1 high, 2 moderate) |
| `cd admin && npm audit --json` | çalıştı: 8 (1 high, 7 moderate). `--omit=dev`: 2 (1 high, 1 moderate) |
| `cd mobile && npm audit --json` | çalıştı: 36 (2 high, 33 moderate, 1 low). `--omit=dev`: 27 (2 high, 24 moderate, 1 low) |
| `cd scripts/ui-shots && npm audit --json` | çalıştı: 0 |
| `py -m pip_audit -r backend/requirements.txt` | sistemde kurulu değildi; scratchpad içindeki ayrı venv'e `pip-audit 2.10.1` kuruldu, `pip_audit -r backend/requirements.txt -f json` çalıştı: 50 çözümlenmiş paket, "No known vulnerabilities found" |

npm "prod" sınıflaması paketin `devDependencies` dışında olduğunu gösterir, uygulama paketine gömüldüğünü göstermez. Mobilde "prod" görünen açıkların tamamı Expo CLI / build araçlarındadır (INF-05).

---

## Bulgular

### INF-01 Üretim korumaları yalnızca `env == "prod"` tam eşleşmesine bağlı; `env` serbest metin

- OWASP: A05 Security Misconfiguration. CWE-1188 (güvensiz varsayılan), CWE-693.
- Önem: Orta. Gerekçe: koşullu (yanlış ortam adı gerekir), ama koşul oluşursa sessizce gerçekleşir ve etki yüksektir. Repoda ortam adı listesi zorlanmıyor, staging tanımı yok (INF-13); `production`, `staging`, `Prod` gibi bir değer verildiğinde hiçbir uyarı çıkmaz. Dev anahtarları repoda düz metin olduğundan (`config.py:14-16`), koruma kaçarsa anahtarlar fiilen herkese açıktır.
- Konum: `backend/app/config.py:24` (`env: str = "dev"`), `config.py:116` (tek prod kontrolü), `backend/app/main.py:24-26` (docs), `backend/app/services/otp.py:78` (`dev_code`), `backend/app/api/payments.py:64` (sahte ödeme sayfası), `backend/app/demo.py:77` (demo seed).
- Kavramsal etki: `GETAWAY_ENV=production` ile açılan bir sunucu (a) repodaki dev JWT/Fernet/blind-index anahtarlarını kabul eder: veritabanı sızarsa PII çözülür, blind index tersine hesaplanabilir; (b) `sms_provider=console` ise OTP kodu API yanıtında döner, herhangi bir telefonla giriş yapılabilir; (c) `/docs` ve `/openapi.json` açılır; (d) `payment_provider=fake` ise `/payments/fake/{oid}/complete` ile ödeme yapmadan rezervasyon onaylanır (FakeProvider imza anahtarı `jwt_secret`, `backend/app/providers/payments.py:224`); (e) demo seed çalışır.
- Öneri: `env: Literal["dev", "test", "prod"]` (bilinmeyen değerde açılmama). Staging gerekecekse `stage` değeri prod ile aynı korumaları alsın (kontrolü `env in {"stage","prod"}` veya "dev/test değilse sıkı" şeklinde ters çevirin: izin listesi yerine yasak varsayılan).
- verified: `backend/app/config.py:24,114-130`; `grep -rn -E 'settings\.env|env ==|env !=' backend/app`

### INF-02 Prod validator kapsamı eksik: SMS, PayTR test modu, DB/Redis kimlik bilgisi, CORS, URL

- OWASP: A05. CWE-1188, CWE-16.
- Önem: Orta. Gerekçe: `env=prod` doğru verilse bile aşağıdaki dev varsayılanları açılışta reddedilmiyor; bazıları doğrudan iş/kimlik etkisi taşıyor (OTP'nin SMS yerine loga yazılması, test modunda ödeme).
- Konum ve eksikler (`backend/app/config.py`):
  - `:49` `sms_provider="console"` prod'da reddedilmiyor. Etki: SMS gitmez, OTP kodu ve telefon WARNING seviyesinde loga yazılır (`backend/app/providers/sms.py:30`); log erişimi olan herkes giriş yapabilir. `dev_code` prod'da dönmez (`otp.py:78`), bu yüzden etki log sınırlıdır.
  - `:95` `paytr_test_mode=True` varsayılanı prod'da kontrol edilmiyor. Etki: canlıda test modunda işlem; PayTR panel ayarına bağlı olarak test kartıyla "başarılı" bildirim ve ücretsiz rezervasyon. belief (PayTR test modu davranışı doğrulanmadı).
  - `:92-94` `payment_provider=paytr` iken merchant id/key/salt boşluğu kontrol edilmiyor. Boş anahtarla HMAC hesaplanır; imza doğrulaması bilinen (boş) anahtarla yapılırsa callback sahtelenebilir. belief (boş anahtarla `providers/payments.py` davranışı uçtan uca denenmedi).
  - `:25` `database_url` varsayılanı yerel kullanıcı/parola; `:26` `redis_url` parolasız, TLS'siz. Prod'da varsayılanla açılmayı engelleyen kontrol yok.
  - `:28-33` `cors_origins` localhost/http varsayılanı ve `:96` `public_web_url=http://localhost:3000` prod'da kontrol edilmiyor (`public_web_url` sahte ödeme CSP `frame-ancestors` değerinde ve bağlantılarda kullanılıyor).
- Öneri: prod (ve stage) dalına ekleyin: `sms_provider != "console"`; `paytr_test_mode is False`; `payment_provider=="paytr"` iken üç PayTR alanı dolu; `database_url`/`redis_url` dev varsayılanına eşit değil (Redis için `rediss://` veya parola zorunlu); `cors_origins` ve `public_web_url` yalnızca `https://`. Her kural için açılmama testi.
- verified: `backend/app/config.py:25-33,49,91-96,114-139`, `backend/app/providers/sms.py:30,65-69`

### INF-03 `next-intl@4.3.12` açık yönlendirme (GHSA-8f24-v5vv-gm5j)

- OWASP: A06 Vulnerable and Outdated Components; açığın türü A01/CWE-601 (Open Redirect).
- Önem: Orta. Gerekçe: doğrudan bağımlılık, müşteri web'inin tüm sayfa yollarında çalışan middleware (`web/middleware.ts` `createMiddleware(routing)`); düzeltme aynı major içinde (4.15.0) ve kolay. İstismar edilebilirlik bu projede doğrulanmadı: matcher noktalı yolları hariç tutuyor (`.*\..*`), bu bazı yükleri engelleyebilir. doğrulanmadı.
- Aynı paketteki ikinci advisory GHSA-4c35-wcg5-mm9h (prototype pollution) yalnızca `experimental.messages.precompile` ile etkili; web'de bu ayar yok, bu proje için sahte pozitif. verified: `grep -rn precompile web/next.config.ts web/i18n` boş.
- Konum: `web/package.json` (next-intl 4.3.12), `web/package-lock.json`, `web/middleware.ts:1-4`.
- Kavramsal etki: kurban, güvenilir alan adındaki bir bağlantıya tıklayıp saldırgan sitesine yönlendirilir (oltalama, OTP/kimlik bilgisi toplama).
- Öneri: `next-intl` >= 4.15.0'a yükseltin; yönlendirme regresyon testi (`//evil`, `/\evil`, kodlanmış varyantlar) ekleyin.
- verified: `cd web && npm audit --json` (next-intl, isDirect=true, fixAvailable 4.15.0 isSemVerMajor=false)

### INF-04 `next@15.5.28` içindeki `postcss@8.4.31` (4 advisory, npm "high")

- OWASP: A06. CWE-79 / CWE-22 (advisory türleri).
- Önem: Düşük (npm: high). Gerekçe: advisory'ler (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849) saldırgan kontrollü CSS veya `sourceMappingURL` işlenmesini gerektirir. postcss Next içinde build zamanında, repodaki güvenilir CSS üzerinde çalışır; çalışma anında kullanıcı CSS'i işlenmiyor. Pratikte sahte pozitif. belief (çalışma anında postcss çağrısı olmadığı web/admin kodunda tek tek doğrulanmadı).
- Konum: `web/package-lock.json` ve `admin/package-lock.json` `node_modules/postcss` 8.4.31 (next'in sabitlediği sürüm).
- Öneri: npm'in önerdiği düzeltme Next 16 (major). Acil değil; Next 15.5.x yeni yamalarını izleyin, major geçiş planına bağlayın. `overrides` ile postcss zorlamak Next ile uyumsuzluk riski taşır, denenmeden önerilmez.
- verified: `npm audit --json` (web, admin); lock dosyası sürüm okuması

### INF-05 Geliştirme/build araç zinciri açıkları (çalışma anında sahte pozitif)

- OWASP: A06. CWE-1395.
- Önem: Düşük. Gerekçe: hepsi lint, test veya Expo CLI/build araçlarında; uygulama paketine (web/admin sunucu çıktısı, mobil JS bundle) girmez. Etki geliştirici makinesi/CI ile sınırlı ve çoğu DoS.
- Paketler:
  - web/admin/mobile: `minimatch` 7.0.0-11.0.0 (GHSA-g3hv-75wg-m249, ReDoS) ve onu çeken `@typescript-eslint/*` 6.16.0-8.72.2 (eslint-config-next / eslint-config-expo üzerinden, dev).
  - mobile: `zod@3.25.76` (GHSA-mrhx-c7xc-m3w5, npm high; ebeveyn `@expo/cli` 58.1.17 ve `eslint-plugin-react-hooks`), `node-forge@1.4.2` (GHSA-6889-vf6x-f3g5, GHSA-w4xr-hqv8-ch44, GHSA-6cv4-p8m7-4r25, GHSA-j8rw-jp99-435v; ebeveyn `@expo/cli`, `@expo/code-signing-certificates`), `deepmerge@4.3.1` (GHSA-gcqx-w48m-w2h4, low; `@expo/config`, `jest-config`), `glob` 9.0.0-14.0.1 (GHSA-3g3m-2fjr-6pw4), jest 30 zinciri.
- Sahte pozitif notu: npm `expo` için "fix: expo@52.0.49" ve `jest` için "29.7.0" öneriyor; bunlar sürüm düşürmedir, uygulanmamalı.
- Öneri: `@expo/cli` 58.1.19 sonrası bir SDK 58 yamasına (`npx expo install --fix`) geçin; zod/glob/minimatch için yeni yamalar geldikçe lock yenileyin. `npm audit fix --force` kullanılmamalı.
- verified: `npm audit --json` (mobile); `package-lock.json` ebeveyn çıkarımı (`py -I -c ...` ile `dependencies` taraması)

### INF-06 CI: Google anahtarları workflow düzeyi env'de; `curl | bash` kurulumu ve üçüncü taraf action tüm adımlarda erişebiliyor

- OWASP: A08 Software and Data Integrity Failures. CWE-829 (güvenilmeyen kaynaktan işlev dahil etme), CWE-494 (bütünlük kontrolsüz indirme).
- Önem: Orta. Gerekçe: tetikleyici yalnızca push (`ci/ios-*`, `ci/android-*`) ve workflow_dispatch, yani yazma yetkisi olan biri gerekir; fork PR'ı secret almaz. Ancak (a) `GETAWAY_GOOGLE_MAPS_API_KEY` workflow düzeyinde `env` olduğundan her adım ve her alt süreç görür; (b) Maestro `curl -fsSL https://get.maestro.mobile.dev | bash` ile sürüm/özet doğrulamasız kurulur; (c) `reactivecircus/android-emulator-runner@v2` değiştirilebilir etiketle sabitli. Bu üç dış kaynaktan biri ele geçirilirse sunucu tarafı Google anahtarı (Places/Routes, ücretli) dışarı sızar; ayrıca derlenen uygulamaya gömülen iOS/Android anahtarları da süreç ortamında.
- Konum: `.github/workflows/android-emulator.yml:30` (workflow env), `:57-58,109` (adım env), `:140` (curl|bash), `:143` (üçüncü taraf action); `.github/workflows/ios-simulator.yml:30`, `:47-48,112`, `:169` (curl|bash).
- Öneri: sunucu anahtarını yalnızca backend'i başlatan adımın `env`'ine taşıyın; Maestro'yu sabit sürümle indirip SHA-256 doğrulayın (veya sürüm sabitli resmi release zip'i); üçüncü taraf action'ı commit SHA ile sabitleyin; bu iş akışları için ayrı, kota ve API kısıtlı (yalnızca test) Google anahtarı kullanın.
- verified: `grep -n -E 'secrets\.|uses:|curl' .github/workflows/*.yml`; ilgili satırlar okundu

### INF-07 GitHub Actions SHA yerine etiketle sabitli

- OWASP: A08. CWE-1357 (yetersiz güvenilir bileşen), CWE-829.
- Önem: Düşük. Gerekçe: birinci taraf action'lar (`actions/checkout@v4`, `setup-python@v5`, `setup-node@v4`, `setup-java@v4`, `cache/restore@v4`, `cache/save@v4`, `upload-artifact@v4`) GitHub'a ait, risk düşük; tüm iş akışlarında `permissions: contents: read` var ve `ci.yml` secret kullanmıyor, bu yüzden etiket ele geçirilse de yazma yetkisi yok. Üçüncü taraf olan tek action INF-06 kapsamında.
- Konum: `.github/workflows/ci.yml:45,46,64,65,90,91,107,108`; `android-emulator.yml:54,66,83,88,95,126,143,158`; `ios-simulator.yml:44,62,93,102,140,227`.
- Öneri: SHA sabitleme + yorumla sürüm (`@<sha> # v4.x.y`) ve Dependabot `github-actions` ekosistemi (INF-08) ile güncel tutma.
- verified: `grep -n uses: .github/workflows/*.yml`

Olumlu (negatif bulgular):
- Tehlikeli tetikleyici yok: aramam `pull_request_target`, `workflow_run`, `issue_comment` bulamadı (`grep -rn "pull_request_target\|workflow_run\|issue_comment" .github`).
- Üç iş akışında da `permissions: contents: read` (`ci.yml:15-16`, `android-emulator.yml:17-18`, `ios-simulator.yml:17-18`).
- `ci.yml` (PR'da çalışan tek iş akışı) `secrets.` kullanmıyor; `${{ }}` ifadeleri yalnızca `github.ref`, `matrix.app` (sabit liste), `hashFiles` ve `env`. Komut içine saldırgan kontrollü bağlam (PR başlığı, dal adı) enjekte edilmiyor. verified: `ci.yml` tamamı okundu.
- CI'da `npm ci` (lock dosyasına bağlı) kullanılıyor.

### INF-08 Dependabot/Renovate yok; CI'da bağımlılık açık taraması yok

- OWASP: A06. CWE-1104 (bakımsız üçüncü taraf bileşen kullanımı).
- Önem: Orta. Gerekçe: bu denetimde bulunan bilinen açıklar (INF-03 dahil, düzeltmesi küçük sürüm) otomatik bir mekanizma olmadığı için fark edilmemiş; dört npm projesi, bir pip projesi ve Actions için güncelleme sinyali yok.
- Konum: aramam bulamadı (`git ls-files | grep -iE 'dependabot|renovate'`; `.github` altında yalnızca `scripts/` ve `workflows/`). CI'da `npm audit` / `pip-audit` adımı yok (`ci.yml` okundu). `SECURITY.md` ve `CODEOWNERS` de yok.
- Öneri: `.github/dependabot.yml` ile `npm` (web, admin, mobile, scripts/ui-shots), `pip` (backend), `github-actions` ekosistemleri, haftalık; Expo için SDK uyumu nedeniyle mobilde major güncellemeleri yok sayın. CI'ya `npm audit --omit=dev --audit-level=high` ve `pip-audit -r backend/requirements.txt` adımı (başta uyarı modunda). Branch koruması ve zorunlu kontroller GitHub ayarındadır, repodan doğrulanamadı (belief).
- verified: yukarıdaki `git ls-files` ve `ls -a .github`

### INF-09 Python bağımlılıkları: geçişli paketler sabitsiz, hash yok, test aracı çalışma bağımlılıklarıyla aynı dosyada

- OWASP: A08. CWE-1357, CWE-494.
- Önem: Düşük. Gerekçe: doğrudan paketler `==` ile sabit (iyi); ancak 50 çözümlenmiş paketin yaklaşık 33'ü geçişli ve her kurulumda en güncel uyumlu sürüm gelir (tekrarlanamaz kurulum, ele geçirilmiş bir yeni sürümün otomatik alınması). `--require-hashes` yok. `pytest` üretim imajına da girer (saldırı yüzeyi küçük artış).
- Konum: `backend/requirements.txt:1-17` (pytest: satır 17); CI kurulumu `ci.yml:52`, `android-emulator.yml:74`, `ios-simulator.yml:81`.
- Öneri: `pip-tools`/`uv` ile `requirements.in` -> hash'li `requirements.txt` (lock); `requirements-dev.txt` ile pytest ayrımı.
- verified: `pip-audit` çıktısı (50 bağımlılık çözümlendi), `backend/requirements.txt` okundu

### INF-10 Yerel geliştirme: Postgres ve Redis tüm arayüzlerde, zayıf/boş parola; backend `0.0.0.0`

- OWASP: A05. CWE-1188, CWE-306 (Redis kimlik doğrulaması yok), CWE-521.
- Önem: Düşük (yalnızca geliştirme bağlamı). Gerekçe: `"5432:5432"` ve `"6379:6379"` host IP'si belirtilmeden yayımlandığı için Docker tüm arayüzlere bağlar; aynı ağdaki (ofis, kafe Wi-Fi) biri repoda yazılı kullanıcı/parola ile DB'ye, parolasız Redis'e (canlı sürücü konumu `leg_loc:*`, ARQ kuyruğu) erişebilir. VS Code görevi backend'i `--host 0.0.0.0` ile açar; dev modda `/docs` açık ve OTP `dev_code` API yanıtında döner, yani LAN'daki biri herhangi bir test hesabına girebilir. Geliştirme verisi gerçek kişisel veri içeriyorsa (örn. `docs/test_senaryolari.md` içindeki gerçek e-postalı admin) önem Orta'ya çıkar. İşletim sistemi güvenlik duvarının engelleyip engellemediği doğrulanmadı (belief).
- Konum: `docker-compose.yml:6-10,18-21`; `.vscode/tasks.json:42-43`.
- Öneri: `"127.0.0.1:5432:5432"`, `"127.0.0.1:6379:6379"`; Redis'e `--requirepass` (değeri `.env`'den) ve `GETAWAY_REDIS_URL`'de parola; uvicorn görevinde `--host 127.0.0.1` (Android emülatör `10.0.2.2` üzerinden yine erişir; fiziksel cihaz testi için ayrı görev).
- verified: `docker-compose.yml` okundu, `grep -n host .vscode/tasks.json`

### INF-11 Container image'ları değiştirilebilir etiketle; CI ile yerel arasında sürüm kayması; prod container tanımı yok

- OWASP: A08 / A06. CWE-1357.
- Önem: Düşük. Gerekçe: yalnızca geliştirme ve CI image'ları; `redis:7-alpine` ve `postgis/postgis:16-3.4` etiketleri digest'siz, yerelde eski bir çekim yamasız kalabilir (Redis 7.x'in yakın dönem Lua kaynaklı CVE'leri için yerel imajın yamalı olup olmadığı doğrulanmadı, belief). Android CI `postgis/postgis:17-3.5` ve `redis:7` kullanıyor, backend CI ve compose `16-3.4` / `7-alpine`: testler farklı major Postgres'te koşuyor.
- Dockerfile: aramam bulamadı (`git ls-files | grep -iE 'dockerfile|\.dockerignore'`). Backend/web/admin için üretim imajı, base image ve dağıtım yapılandırması repoda yok; prod sertleştirmesi (root olmayan kullanıcı, read-only fs, base image yamaları) denetlenemedi.
- Konum: `docker-compose.yml:4,19`; `ci.yml:25,36`; `android-emulator.yml:41-52` (image satırları).
- Öneri: image'ları `@sha256:` digest ile sabitleyin ve Dependabot `docker` ekosistemine ekleyin; CI ve compose'da aynı Postgres major'ı; prod Dockerfile yazıldığında ayrıca incelensin.
- verified: dosyalar okundu

### INF-12 `.gitignore` Firebase/FCM kimlik dosyası desenlerini kapsamıyor

- OWASP: A05 / A02. CWE-540 (kaynakta hassas bilgi), CWE-312.
- Önem: Düşük. Gerekçe: şu an izlenen böyle bir dosya yok ve git geçmişinde de eklenmemiş; ancak `GETAWAY_FCM_CREDENTIALS_FILE` (servis hesabı JSON'u, özel anahtar içerir) ve `GETAWAY_GOOGLE_SERVICES_FILE` (`google-services.json`, `GoogleService-Info.plist`) için yol repoda tutulursa yanlışlıkla commit edilebilir. `.env`, `*.pem`, `*.key`, `secrets/` kapsanıyor.
- Konum: `.gitignore:27-32`; `backend/app/config.py:57`; `mobile/app.config.ts:25,140`.
- Öneri: `google-services.json`, `GoogleService-Info.plist`, `*firebase-adminsdk*.json`, `*service-account*.json`, `*.p12`, `*.jks`, `*.keystore` desenlerini ekleyin; ek olarak pre-commit secret taraması (gitleaks vb.) değerlendirilsin.
- verified: `git check-ignore -v mobile/google-services.json mobile/GoogleService-Info.plist fcm-sa.json` eşleşme döndürmedi (yoksayılmıyor); `backend/.env`, `admin/.env.e2e.local`, `web/.env.local`, `mobile/.env`, `backend/var/...` yoksayılıyor. Geçmiş: `git log --all --diff-filter=A --name-only` içinde yalnızca dört `.env.example`.

### INF-13 Ortam ayrımı: staging yok, mobil "preview" profilleri canlı API'ye bağlanıyor

- OWASP: A05. CWE-1188.
- Önem: Düşük. Gerekçe: `env` değerleri `dev | test | prod` (`config.py:24` yorumu); staging ortamı, ayrı staging API adresi veya staging yapılandırması repoda yok. `mobile/eas.json` `preview` ve `preview-driver` (dahili dağıtım APK) profilleri `https://api.getawaytransfers.com` canlı API'yi kullanıyor; test sürümleri canlı veriyle çalışır. Prod dağıtım topolojisi (TLS, reverse proxy, Cloudflare) repoda tanımlı değil (recon §1).
- Konum: `mobile/eas.json:13-28`; `backend/app/config.py:24`.
- Öneri: `stage` ortamı ve ayrı API alan adı; preview profillerini staging'e yönlendirin; stage için INF-01/INF-02'deki prod korumalarının aynısı.
- verified: `mobile/eas.json` okundu; staging için `grep` bulgusu: aramam bulamadı (`grep -n -i -E 'stag(e|ing)' backend/app/config.py mobile/eas.json mobile/app.config.ts */.env.example`)

### INF-14 CI artefaktları backend logunu 14 gün saklıyor

- OWASP: A09 Security Logging and Monitoring Failures. CWE-532.
- Önem: Bilgi. Gerekçe: `backend.log` artefakta giriyor; konsol SMS sağlayıcısı OTP kodlarını ve telefon numaralarını loga yazıyor (`sms.py:30`). CI yalnızca test verisi ve tek seferlik kodlar kullandığı için etki yok; ancak aynı desen ileride gerçek veriyle koşan bir iş akışına taşınırsa veri sızar. Repo erişimi olan herkes artefaktı indirebilir.
- Konum: `android-emulator.yml:78,158-164`; `ios-simulator.yml:88,227-233`.
- Öneri: mevcut haliyle kabul edilebilir; logu artefakta koymadan önce maskeleme veya yalnızca hata durumunda yükleme.
- verified: ilgili satırlar okundu

---

## Kapsam dışı kalanlar / doğrulanmayanlar

- `next-intl` açık yönlendirmesinin bu matcher ile gerçekten istismar edilip edilemediği (INF-03) dinamik test edilmedi.
- PayTR test modu ve boş merchant anahtarı davranışı (INF-02) uçtan uca denenmedi; ödeme alanının ayrıntılı incelemesi ilgili alan raporuna aittir.
- GitHub repo ayarları (branch koruması, Actions "fork PR onayı", secret kapsamı, environment koruması) repodan görülemez.
- `scripts/ui-shots` yalnızca `npm audit` ile tarandı (0 açık), içerik okunmadı.
- `.github/scripts/android-flows.sh` yalnızca artefakt yolları için tarandı.
- Mobil uygulama paketine gömülen Google anahtarlarının API/uygulama kısıtları Google Cloud konsolunda; repodan doğrulanamaz.
