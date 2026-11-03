# Web Hesabım (`/account`, `AccountPanel`): Impeccable geçişi (B-W9)

Tarih: 2026-11-03 · Dal: `ui/impeccable-pass` · Mod: **Operate** · North Star: "Kıyı Yolu" (`DESIGN.md`)
Yöntem: ⚠️ DEGRADED: single-context (görev kuralı alt ajan açmayı yasaklıyor; Assessment A önce, detector kanıtı B sonra). Impeccable adımları in-thread pass; soru sorulmadı, kararlar aşağıda.
Kapsam: profil formu, pazarlama onayı (KVKK: ayrı, önceden işaretsiz, geri alınabilir), çıkış. Oturumsuz giriş (`RequireLogin`) B-W3/B-W7'de yapıldı, dokunulmadı.

## Puanlar

| Ölçüm | Önce | Sonra |
|---|---|---|
| critique (Nielsen, /40) | **22/40 (%55, Acceptable)** | **33/40 (%83, Good)** |
| audit | **13/20** | **18/20** |
| axe | 0 (oturumlu sayfa; sorunlar otomatik kural dışı: duyurulmayan sonuç, boş yükleniyor) | **0** (profil + "Kaydedildi." açık) |
| detector (`AccountPanel.tsx`) | 0 | 0 |
| lint (`AccountPanel.tsx`, `account.spec.ts`) | 0 | 0 |

### critique ayrıntısı

| # | Sezgisel | Önce | Sonra | Not |
|---|---|---|---|---|
| 1 | Sistem durumu | 1 | 4 | Profil yüklenirken boş alan (`null`) → `LoadingState`; kayıt "Kaydediliyor…"; onay ve profil sonucu `role="status"` ile duyurulur |
| 2 | Gerçek dünya | 3 | 4 | Onay sonucu açık/kapalı diye söylenir; telefonun neden değişmediği yazılı |
| 3 | Kullanıcı kontrolü | 3 | 3 | Onay her an geri alınabilir (ipucu); çıkış yerinde |
| 4 | Tutarlılık | 2 | 4 | Ortak `LoadingState`/`ErrorState`; diğer ekranlarla aynı hata deseni |
| 5 | Hata önleme | 2 | 3 | Kayıt ve onay sırasında ikinci gönderim kilitli; çıkış çift tıklanmaz |
| 6 | Tanıma | 3 | 3 | `autocomplete` (`name`, `email`) |
| 7 | Esneklik | 2 | 2 | Değişmedi |
| 8 | Estetik ve sadelik | 3 | 3 | Salt okunur telefon düzenlenebilir alanlardan ayrışır |
| 9 | Hata kurtarma | 1 | 4 | Profil hatası yeniden denemesizdi; onay hatası profil kartına yazılıyor ve kutu işaretli kalıyordu; onay listesi hatası yutuluyor ve "işaretsiz" gösteriliyordu |
| 10 | Yardım | 2 | 3 | Telefon ve onay ipuçları |
| **Toplam** | | **22/40** | **33/40** | |

### audit ayrıntısı

| Boyut | Önce | Sonra | Ana bulgu (sonra) |
|---|---|---|---|
| Erişilebilirlik | 2 | 4 | Kalıcı canlı bölgeler (boşken akışta yer kaplamaz), hatalar `role="alert"`; telefon `disabled` yerine `readOnly` (odaklanır, okunur); onay kartı `section` + `aria-labelledby` |
| Performans | 3 | 3 | Profil ve onay paralel yüklenir; istemci bileşeni zorunlu |
| Tema | 3 | 4 | Yalnızca tokenlar (`--paper`, `--line`) |
| Duyarlılık | 3 | 4 | 360–1440 px Almanca + 120 karakter ad + uzun e-posta taşma yok (test) |
| Uygulama bütünlüğü | 2 | 3 | Ad/e-posta kırpılarak gönderilir; mantıksal özellikler |

## Bulgular ve durum

| Öncelik | Bulgu | Durum |
|---|---|---|
| P1 | Profil yüklenirken bileşen `null` çiziyordu (boş ekran, Review Focus 2) | **Kapandı**: "Hesap bilgileriniz yükleniyor…" (`LoadingState`). Test: "account loading state" |
| P1 | Profil ağ hatası `p.alert` (rolsüz), yeniden deneme yok | **Kapandı**: `ErrorState` + "Tekrar dene". Testler: "network error shows ErrorState with retry", "network error on every BFF call shows ErrorState, not the login" |
| P1 | Pazarlama onayı kaydedilemezse kutu işaretli kalıyordu (kayıtlı olmayan rıza verilmiş görünür, KVKK) ve hata profil kartında çıkıyordu | **Kapandı**: kutu yalnızca kayıt başarılı olunca değişir; hata onay kartında "Tercihiniz kaydedilemedi. …" (`role="alert"`). Test: "marketing consent failure keeps the previous value" |
| P1 | Onay ve profil kaydı duyurulmuyordu (onayda hiçbir geri bildirim yoktu) | **Kapandı**: "Tercihiniz kaydedildi. Kampanya iletileri açık/kapalı." ve "Kaydedildi." `role="status"`. Test: "marketing consent toggle not preselected; save announces" |
| P1 | Onay listesi alınamazsa hata yutuluyor, kutu "işaretsiz" gösteriliyordu (bilinmeyen durum yanlış gösterilir) | **Kapandı**: kartta `ErrorState` + "Tekrar dene", kutu çizilmez. Test: "account error state" |
| P2 | Kayıt düğmesi meşgul durumu yok, çift gönderim | **Kapandı**: "Kaydediliyor…", kilit |
| P2 | Eski "Kaydedildi." alan değişince kalıyordu | **Kapandı**: düzenlemede temizlenir (test) |
| P2 | Telefon `disabled` (soluk, odaklanmaz, nedeni yazmaz) | **Kapandı**: `readOnly` + "Giriş için kullanılır; buradan değiştirilemez." |
| P3 | `autocomplete` yok | **Kapandı**: `name`, `email` |
| P3 | E-posta yalnızca tarayıcının yerel doğrulamasıyla denetleniyor (iletisi tarayıcı dilinde) | Açık (P3): backend `validation_error` genel metin döndürüyor; alan düzeyi hata kodu backend değişikliği ister |

KVKK değişmezi: pazarlama kutusu önceden işaretli değildir (yeni hesapta işaretsiz, test); onay ayrı kartta, aydınlatma ve açık rızadan ayrı; geri alma kabul kadar kolay (aynı kutu).
Kararlar: "account empty state" = adı/e-postası ve onay kaydı olmayan hesap (form boş alanlarla, uyarısız, kutu işaretsiz); hesap ekranında "liste" olmadığı için `EmptyState` bileşeni kullanılmadı. Onay kaydı sürerken kutu eski değerinde kalır (iyimser güncelleme yok); KVKK'da kayıtsız rızayı göstermemek önceliklidir.

## Yapılanlar (Impeccable adımları)

- **harden**: yükleniyor, profil hatası, onay listesi hatası, onay kaydı hatası, tam BFF kesintisi, 401 (önceden vardı), çift gönderim; 120 karakter ad, uzun e-posta, Almanca.
- **adapt**: 360/390/768/1024/1440 px Almanca testi.
- **clarify** (tr, en, de, ru): `account.loading`, `saving`, `phoneHint`, `marketingHint`, `marketingSavedOn`, `marketingSavedOff`, `marketingFailed`, `consentLoading`.
- **optimize**: görsel yok; iki istek paralel.
- **animate/delight**: eklenmedi (Operate, ayar ekranı).
- **polish**: salt okunur alan stili, çıkış satırı iki uca yaslı.

## Değişen dosyalar

`web/components/AccountPanel.tsx`, `web/app/globals.css` (`input.readonly`, `.account-note`, `.account-actions`), `web/messages/{tr,en,de,ru}.json`, `web/e2e/account.spec.ts` (yeni, 9 test).

## Uygulanamadı: neden

- E-posta alan düzeyi hata: backend değişikliği gerekir (P3, yukarıda).

## Doğrulama

- Kırmızı (önce, `npx playwright test account.spec --project=desktop --workers=1`): **7 başarısız, 2 geçti**. "save announces": onay kartında `status` yok; "failure keeps the previous value": onay kartında `alert` yok; "network error shows ErrorState with retry": `alert` yok (rolsüz `p`); "loading state": `status` yok; "empty state": `#phone` `readonly` değil; "error state": kartta hata yok; axe testi: `.profile-card` yok (zaman aşımı). Geçenler: tam BFF kesintisi (`RequireLogin`, B-W7) ve 360 px testi.
- Sonra: `npx playwright test account.spec --workers=1` (iki proje): **17 geçti, 1 atlandı** (360 px testi yalnızca desktop). Bir ara koşuda "empty state" geliştirme derlemesi sırasında `route.fetch` süre aşımıyla düştü; taklit tümüyle yapay yanıta çevrildi (2 tekrar + tam koşu yeşil).
- `npx tsc --noEmit` temiz; `npx eslint` 0; `impeccable detect` `[]`.
- Görüntü: `node scripts/ui-shots/web.js --out after --only account,account-anon --locales tr,de`: kaçan yok.

## Görüntüler

- Önce: `screenshots/before/web/{tr,de}-{1440,390}-{account,account-anon}.png`
- Sonra: `screenshots/after/web/{tr,de}-{1440,390}-{account,account-anon}.png`

## Düzeltme turu 1 (2026-11-03, inceleme `task-B-W8-10-review.md`)

| Bulgu | Çözüm |
|---|---|
| Küçük 2: onay kaydı sürerken görünür geri bildirim yok, ikinci tıklama sessizce yutuluyor | Kayıt sürerken onay kartının durum satırında görünür ve duyurulan "Kaydediliyor…"; kutu `aria-busy` + `aria-disabled`, soluk ve `cursor: progress`. Karar: `disabled` yerine `aria-disabled` (odaklı kutu `disabled` olunca odak `body`'ye düşer); ikinci tıklama kayıt göndermez, "Kaydediliyor…" görünür kalır. Test: "consent save shows a visible in-progress state" (asılı POST, ikinci tıklama, 1 kayıt, odak kutuda) |
| Küçük 5: `check()/uncheck()` `toPass` içinde, yeniden denemede ikinci onay kaydı | Tek `click()` + `toBeChecked()`; onay POST'ları sayılır ve her tıklama için tam bir kayıt beklenir (`accepted: true`, sonra `false`) |
| Küçük 6: kararsızlık | `beforeAll` ısınması (`/tr/legal/cookies`, `/tr/account`, `/de/account`); 360 px testinde `route.fetch()` yerine tümüyle yapay profil; `toPass` döngüleri kaldırıldı |
| Ek (critique yeniden puanlama): e-posta yalnızca tarayıcının kendi dilindeki baloncuğuyla denetleniyordu (önceki açık P3) | Form `noValidate`; geçersiz e-postada alan hatası "E-posta adresini kontrol edin (ör. ad@ornek.com)." (`role="alert"`, `aria-invalid`), odak alana, PATCH gönderilmez; yazınca kalkar. Yeni anahtar `account.emailInvalid` (4 dil). Test: "invalid e-mail shows a field error and is not sent" |

### Yeniden critique (in-thread, dürüst puan)

| # | Sezgisel | Tur 0 | Tur 1 | Gerekçe |
|---|---|---|---|---|
| 1 | Sistem durumu | 4 | 4 | Onay kaydı artık görünür "Kaydediliyor…"; tur 0 puanı bu boşluğa rağmen 4 verilmişti, şimdi hak ediliyor |
| 2 | Gerçek dünya | 4 | 4 | |
| 3 | Kullanıcı kontrolü | 3 | 3 | |
| 4 | Tutarlılık | 4 | 4 | |
| 5 | Hata önleme | 3 | 4 | İstemcide e-posta denetimi, kayıt ve onay kilitleri, iyimser olmayan onay |
| 6 | Tanıma | 3 | 3 | |
| 7 | Esneklik | 2 | 2 | |
| 8 | Estetik | 3 | 3 | |
| 9 | Hata kurtarma | 4 | 4 | E-posta hatası artık alanında ve sitenin dilinde |
| 10 | Yardım | 3 | 3 | |
| **Toplam** | | 33/40 | **34/40 (%85)** | Tur 0'daki 33 puanda madde 1 iyimserdi (gerçekte 3 → 32/40) |

Doğrulama: `npx playwright test account.spec --workers=1`: desktop 11 geçti; phone ilk koşuda ilk test `goto` `net::ERR_ABORTED` (geliştirme sunucusu derlemesi) ile düştü, phone yeniden koşu 10 geçti + 1 atlandı. Isınmaya giriş sayfası (`/tr/legal/cookies`) eklendi. `tsc`, `eslint` temiz.
