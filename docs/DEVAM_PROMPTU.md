# Devam promptu: Impeccable arayüz taraması (kalan işler)

Bu dosyanın tamamını yeni bir Claude Code oturumuna yapıştır. Hazırlandığı tarih: 2026-11-03, `main` (tarama dalları merge edildikten sonra).

---

Sen bu projede (getawaytransfers.com VIP transfer, `C:\Projects\VIPTransferProject`) yarım kalan **Impeccable arayüz taramasını** sürdüreceksin. Çalışma kuralları `CLAUDE.md`'de; başlangıç noktası `docs/proje_rehberi.md`.

## Okunacaklar (bu sırayla)

1. `CLAUDE.md`, `docs/proje_rehberi.md`, `docs/kararlar.md` (K-01 … K-46), `docs/acik_konular.md`.
2. Spec: `docs/superpowers/specs/2026-11-02-impeccable-tarama-design.md`.
3. Plan: `docs/plans/2026-11-impeccable-tarama.md`. Global Constraints, Review Focus, "Ortak prosedür: Ekran döngüsü" ve kalan görevler.
4. Durum tablosu: `docs/ui-review/README.md`. Ekran raporları da `docs/ui-review/*.md` altında.
5. `PRODUCT.md` ve `DESIGN.md` (kökte; mobil için `mobile/` altında), `.impeccable/design.json`.

## Bağlayıcı kurallar (özet; tamamı planda)

- Yanıtlar Türkçe. Her değişiklikten sonra `docs/degisiklik_gunlugu.md` güncellenir; ayrıca ilgili `.md` dosyaları da güncellenir (kararlar, açık konular, proje rehberi, test senaryoları, kök README).
- Sedan yok. Araç tipleri: minivan, vip_van, minibus, vip_minibus (K-35).
- Sır, parola veya anahtar repoya yazılmaz. Admin parolası kullanıcıya sorulur, hiçbir yere yazılmaz. Admin e2e hesabı `e2e-ui-admin@getaway-e2e.dev`; değerleri yalnızca git-ignored `admin/.env.e2e.local` dosyasında durur.
- Fiyat istemcide hesaplanmaz veya yuvarlanmaz. İptal kademeleri (K-14: 48 saat ve üstü %100, 24–48 saat %50, 24 saatten az %0) metinlerde birebir korunur.
- Yasal metin içeriği değişmez; taslak uyarısı kalır. Önceden işaretli onay kutusu olmaz (KVKK).
- PayTR canlı tahsilat, split ödeme ve tam iade garantisi satışı kapalı kalır.
- WCAG 2.2 AA. Sürücü uygulamasında dokunma hedefleri en az 48 dp.
- Animasyon artışı yalnızca web ve müşteri mobil içindir. Admin yoğun düzende kalır ve klavye desteği alır. Sürücü uygulaması Türkçe kalır.
- Her ekran ayrı commit: `ui(<yuzey>/<ekran>): impeccable pass - <özet>`.
- Kanıtsız "bitti" denmez.
- Diğer klasörlere (`C:\Projects\HotelSaasProject`, `VIPTransferProjectUI`, Desktop `VIPTransferProject`, `Documents\vip-transfer`) sormadan dokunulmaz.

## İş akışı

- Yeni dal aç: `ui/impeccable-pass-2` (`main`'den).
- `superpowers:subagent-driven-development` ile görev başına bir uygulayıcı alt ajan, ardından görev incelemesi ve gerekirse düzeltme turu (en çok 5) yürüt.
- Defteri `.superpowers/sdd/2026-11-impeccable-tarama/progress.md` içinde tut. Bu klasör git-ignored; önceki defter aynı makinede duruyorsa ilk satırını ve son girdilerini oku.
- Impeccable komutlarını alt ajan içinde **in-thread** çalıştır; uygulayıcı alt ajan açmaz. Ayrıntılar planda.
- Sunucular:
  - Backend: `backend` klasöründe `.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000`. Postgres ve Redis Docker'da çalışır. Migration: `alembic upgrade head` (son sürüm 0003).
  - Web ve admin: `npm run dev` (:3000 / :3001).
  - Mobil önizleme: `npm run web -- --clear` (:8081) ve `npm run web:driver -- --clear` (:8082). Android emülatörde native harita için `GETAWAY_GOOGLE_MAPS_ANDROID_KEY` gerekir.
- Testler:
  - Web ve admin: `npx playwright test --workers=1`. Dev sunucuda paralel işçilerde ilk derleme zaman aşımına düşüyor, bu yüzden tek işçi kullan.
  - Mobil: `npx jest`.
  - Backend: `.venv\Scripts\python -m pytest -q`.
  - Kökte: `node --test "scripts/*.test.mjs"`.
- Ekran görüntüleri: `node scripts/ui-shots/<web|mobile|driver|admin>.js --out after --only <ekran>`.

## Tamamlananlar (yeniden yapma)

- Hat A: test altyapısı ve token boru hattı.
- Hat D: native harita ve backend polyline.
- Yüzey 1 (web gelir akışı): B-W0 – B-W7. Her görev incelendi, yüzey incelemesi 15 bulguyla kapandı (K-41 … K-45).
- B-W8 – B-W10: `/bookings`, `/account`, `/data-request`. İncelendi, düzeltme turu temiz.
- B-W11 – B-W15: yasal sayfalar ve 404. Uygulandı (commit'ler `8fa4066`, `ffd8f37`, `9b17e06`, `e404eeb`). **İncelenmedi.**
- Backend çift ödeme önlemi (K-46): açık ödeme 25 dakika içinde yeniden kullanılıyor (migration 0003).

## Kalan işler (sırayla)

1. **B-W11 – B-W15 görev incelemesi.** Commit'leri `e404eeb` üzerinde incele. Bulgu varsa bir düzeltme turu yap. Kontrol listesi:
   - yasal metin değişmemiş olmalı;
   - K-14 kademeleri birebir olmalı;
   - taslak uyarısı görünmeli;
   - okuma ölçüsü 65–75ch olmalı;
   - 404'te ana sayfa ve rezervasyonlarım bağlantıları olmalı;
   - axe 0 olmalı.
2. **C-W1: web 6 dil + RTL.** Diller fr, es, it, zh, ja, ar. Plan "Hat C" bölümünü izle:
   - `web/i18n/routing.ts` 10 dil içermeli.
   - `ar` dilinde `dir="rtl"` olmalı.
   - `defaultCountry` eşlemesi: fr→FR, es→ES, it→IT, zh/ja/ar→GB. Para birimi kuralı değişmez.
   - Yasal metinler taslak olarak çevrilir ve `legal.translationNotice` ("çeviri doğrulanmadı") eklenir.
   - Testler: `web/e2e/i18n.spec.ts` ve `web/scripts/check-messages.mjs`.
   - Web bileşenleri mantıksal CSS özellikleri kullanıyor, ama RTL'de `→` okları ayrıca ele alınmalı.
3. **Web yüzeyi kapanışı (B-Z5'in web kısmı).** Tam web e2e paketini koştur, ardından kullanıcıya Türkçe kısa bir özet ver.
4. **Yüzey 2: mobil müşteri, B-M0 – B-M6.** Ardından **C-M1**: mobil müşteri 6 dil + RTL. Anahtar denetimi `driver.*` anahtarlarını dışarıda bırakır.
5. **Yüzey 3: mobil sürücü, B-D0 – B-D6.** Türkçe kalır; metinler sözlüğe taşınır; dokunma hedefi en az 48 dp.
6. **Yüzey 4: admin, B-A0 – B-A7.** Ardından **Yüzey 5'in admin satırları B-A8 – B-A22** ve **B-Z5**. Admin değerleri ve parola için kullanıcıya sor.
7. **Kapanış:**
   - **Z1:** ikinci tam tarama.
   - **Z2:** tam doğrulama. `web/next.config.ts` ve `admin/next.config.ts` içindeki `eslint.ignoreDuringBuilds: true` kaldırılır; lint 0 olmalı.
   - **Z3:** CI. GitHub Actions yok; ekle.
   - **Z4.**
   - Ardından en yetenekli modelle tüm dal incelemesi.

## Kullanıcı kararı bekleyenler

- **"Uçuş takibi" metni:** ana sayfada "sürücünüz iniş saatinizi takip eder" yazıyor. Kod uçuş takibi yapmıyor; metin değiştirilmedi.
- **"Ödenmeyen rezervasyonlar 30 dakika sonra iptal edilir" metni:** süre admin ayarı (`pending_payment_minutes`), metin ise sabit. Çözüm için API'nin süreyi döndürmesi gerekir.
- **Admin değerleri ve admin parolası:** kullanıcı sonra verecek.
- **e2e testleri geliştirme veritabanında kayıt bırakıyor:** hesaplar, ödenmemiş rezervasyonlar, ödeme kayıtları. Temizleme stratejisi kararı gerekiyor.

## Ertelenmiş küçük bulgular (son tüm dal incelemesinde ele al)

- **Web, rezervasyon ve ödeme akışı:**
  - `FLIGHT_RE` yalnızca rakamdan oluşan girişi kabul ediyor.
  - Rusya ve Kazakistan'da başa yazılan yurt içi "8" öneki silinmiyor.
  - Telefon kontrolü (`international()`) en az 8 haneyi denetlemiyor.
  - UA/FR/PL gibi kısa ulusal numaralarda ülke kodu iki kez ekleniyor.
- **Web, ödeme ekranları:**
  - Ödeme yoklaması 2,5 sn zaman aşımında yavaş mobil ağda erken "durdu" diyebilir.
  - Ödeme sonucu ekranındaki gecikme bağlantısı `target=_top`.
  - `ui-shots/web.js` içinde `unroute` bir `finally` bloğunda değil.
- **Web, canlı takip ve oturum:**
  - İlk kez görülen eski konum (`at`) 15 sn boyunca canlı görünebiliyor.
  - Tüm ayaklar tek bir canlı kutuyu paylaşıyor (P3).
  - Detay sayfası durumu kendiliğinden yenilemiyor (P3).
- **Web, hesap ve veri talebi:**
  - Silme talebi onaylanınca odak `body`'ye düşüyor.
  - Gönderim sürerken "Vazgeç" aktif kalıyor.
  - Space tuşu ve IDN e-posta testleri yok.
- **Altyapı:**
  - `sync-tokens` biçimsiz satırları sessizce atlıyor.
  - Hata bağlamı dosyası (`error-context.md`) parola içerebilir.
  - `eslint-config-next` sürümü sabitlenmeli.
- **Mobil ve harita (cihazda doğrulanmalı):**
  - `driverDrawn` sıfırlanmıyor; Android'de boş bitmap riski.
  - Koyu harita etiket kontrastı yaklaşık 4,4:1.
  - Sürücü konum izni metinleri İngilizce.
  - Rota çizgisi durum çubuğuna yakın.
  - Sürücü yolculuk hata ekranında "tekrar dene" yok.

Başlarken `git log --oneline -15` ile durumu doğrula. İlk iş olarak B-W11 – B-W15 incelemesini başlat.
