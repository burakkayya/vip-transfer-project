# VIP Transfer (getawaytransfers.com): Claude Code'a taşıma ve tüm ekranların Impeccable taraması

Bu projenin geliştiricisi sensin. Benimle Türkçe konuş. Kod, commit mesajı ve teknik adlar İngilizce olabilir.

Bu sıfırdan bir proje değil. Backend, müşteri web sitesi, admin paneli ve mobil uygulamalar (müşteri ve sürücü) yazıldı ve çalışıyor. Görevin şu iki iş:

1. Projeyi Claude Code'da devral. Mevcut durumu kanıtla doğrula.
2. Tüm ekranları Impeccable ile baştan sona tara ve iyileştir.

Çalışma yöntemi Superpowers'tır. Aşağıdaki sırayı izle, adım atlama.

---

## 0. Kaynaklar ve kurallar

- Proje kökü `C:\Projects\VIPTransferProject` (Windows). Kök `CLAUDE.md` kurallarına her zaman uy:
  - Türkçe yanıt ver.
  - Her değişiklikten sonra ilgili `docs/*.md` dosyalarını ve `docs/degisiklik_gunlugu.md`'yi güncelle.
  - Sedan yok. Araç tipleri: minivan, vip_van, minibus, vip_minibus (K-35).
  - Sırları repoya yazma.
- Başlangıç noktası `docs/proje_rehberi.md`. Ardından `docs/` altındaki her dosyayı oku: `kararlar.md` (K-01 ... K-35), `ekranlar.md`, `fiyatlandirma.md`, `odeme.md`, `veritabani.md`, `teknoloji.md`, `yasal_ve_guvenlik.md`, `mvp_plani.md`, `acik_konular.md`, `test_senaryolari.md`, `hesap_kurulumu.md`, `degisiklik_gunlugu.md`. Son olarak kök `README.md` ve her uygulamanın kendi `README.md`'sini oku.
- `CLAUDE_CODE_BASLANGIC_PROMPTU.md` eskidi; "web, mobil ve admin'de yalnızca README var" diyor. Onu yönerge olarak kullanma. Taşıma bitince başına "Eskidi, yerine CLAUDE_CODE_TASIMA_PROMPTU.md" notunu ekle.
- Bilgisayardaki diğer klasörlere sormadan dokunma: `C:\Projects\HotelSaasProject`, `VIPTransferProjectUI` (Angular), Masaüstündeki `VIPTransferProject`, `Documents\vip-transfer`.

### Bu iş boyunca değişmez kurallar

1. **Bu bir arayüz taraması.** İş kurallarını değiştirme: fiyat formülü, iptal kademeleri, komisyon, para birimi, API sözleşmeleri, veritabanı şeması. Bir ekran iyileştirmesi için backend değişikliği gerekiyorsa dur, bana sor. Onay gelirse TDD ile yap.
2. **Fiyat istemcide hesaplanmaz.** Arayüz yalnızca backend'in döndürdüğü fiyatı gösterir. Adres jetonu ve ilçe kilidi korunur.
3. **Yasal metinler taslak, hukukçu onayı bekliyor** (`web/lib/site.ts` yer tutucuları). `clarify` adımında yasal içerik uydurma. Fiyat, iptal ve iade metinleri `fiyatlandirma.md` ve K-14 ile birebir uyumlu olmalı.
4. **KVKK/GDPR ekranlarında karanlık desen yok.** Aydınlatma, açık rıza ve pazarlama onayı ayrı kalır. Önceden işaretli kutu olmaz. Reddet seçeneği kabul kadar görünür olur.
5. **Kapalı kalan özellikler.** PayTR canlı tahsilat, split aktarımı ve tam iade garantisi satışı açılmaz (`acik_konular.md`). Arayüz bunları "yakında" veya gizli tutabilir ama satışa açamaz.
6. **Erişilebilirlik hedefi WCAG 2.2 AA.** Sürücü uygulamasında dokunma hedefleri en az 48 dp olur. Sürücü uygulaması araç içinde, tek elle ve güneş altında kullanılır.
7. **Kanıtsız "bitti" yok** (verification-before-completion). Her iddianın yanında komut çıktısı, test sonucu veya ekran görüntüsü olmalı.

---

## 1. Kurulum kontrolü (kod yazmadan)

1. Superpowers'ın kurulu olduğunu doğrula. Kurulu değilse bana şu komutu söyle, kendin kurma:
   `/plugin install superpowers@claude-plugins-official`
2. Impeccable'ın nerede olduğunu kontrol et. Projede yerel bir kopya var: `.claude/skills/impeccable`, `.claude/agents/impeccable-*.md`, `.impeccable/config.local.json`. Plugin olarak da kuruluysa çakışmayı bana bildir, ikinci kez kurma. `/impeccable doctor` çalıştır ve çıktısını göster.
3. **using-superpowers**: bu oturumda hangi skill'leri hangi adımda kullanacağını tek listede yaz.

## 2. Taban çizgisi (Superpowers: verification-before-completion)

Hiçbir dosyayı değiştirmeden şunları yap:

1. `git status`, `git branch -a` ve son 15 commit. Değişiklik günlüğünde `redesign/web-mobile-ui` dalı geçiyor. Bu dal `main`'e birleştirildi mi? Commit'lenmemiş iş var mı? Rapor et, karar bana ait.
2. Backend: `docker compose up -d`, ardından `backend` içinde `.venv\Scripts\python -m pytest`. Beklenen sonuç 78 test geçmesi. Farklıysa **systematic-debugging** ile kök nedeni bul; tahminle düzeltme yapma.
3. `web`, `admin`, `mobile`: `npm ci` (gerekiyorsa), `npx tsc --noEmit`, lint, `web` ve `admin` için `npm run build`.
4. Uygulamaları başlat. Adresler: web 3000, admin 3001, mobil müşteri web önizlemesi 8081, mobil sürücü web önizlemesi 8082. Playwright ile her ekranın "önce" ekran görüntüsünü al:
   - masaüstü 1440 px, telefon 390 px;
   - web için `tr` ve `de` dilleri (uzun Almanca metin taşma testi);
   - görüntüleri `docs/ui-review/screenshots/before/` altına kaydet.
   - Giriş ve demo verisi için `docs/test_senaryolari.md`'deki hesapları kullan: müşteri OTP kodu ekranda görünür; demo sürücüler +90 530 000 00 01 ve 02. Admin parolasını bana sor, hiçbir yere yazma.
5. **Ekran envanteri**: rota dosyalarından gerçek listeyi çıkar ve `docs/ekranlar.md` ile karşılaştır. Benim tahminim aşağıda; koddan doğrula:
   - **Web** (`web/app/[locale]`): ana sayfa, `book` (rezervasyon sihirbazı ve OTP girişi), `bookings` (liste ve sorgulama), `bookings/[code]` (detay, iptal), `bookings/[code]/pay`, `booking/payment-result`, `account`, `data-request`, `legal/[slug]` (her slug ayrı sayılır), `not-found`.
   - **Admin** (`admin/app`): `login` (2FA dahil), panel ana sayfa, bookings, bookings/[id], dispatch, drivers, drivers/[id], documents, vehicles, regions, pricing, commission, exchange-rates, payments, payouts, invoices, customers, templates, data-requests, users, audit-logs, settings, account.
   - **Mobil** (`mobile/app`): login, driver-register, müşteri: book, bookings, profile, booking/[code], trip/[legId] (canlı takip). Sürücü: home (GO düğmesi, teklif kartı, yolculuk akışı, karşılama tabelası), documents, earnings.
   - Ekran içi durumları ayrı satır olarak listele: teklif kartı, karşılama tabelası, ödeme hatası, boş liste, yükleniyor, hata.
6. Taban raporu ver: test, build ve lint sonuçları, envanter sayısı, `ekranlar.md` ile farklar ve dokümanlar arası çelişkiler.

**Burada dur ve onayımı bekle.**

## 3. Tasarım bağlamı (Superpowers: brainstorming + Impeccable init/document)

1. **brainstorming**: soruları tek tek sor. En az şunları netleştir:
   - Mevcut görsel yön (siyah-beyaz premium web, Uber tarzı mobil, 2026-10-31 yenilemesi) korunacak mı, yoksa değişime açık mı?
   - Öncelik sırası: gelir akışı önce mi (web rezervasyon → ödeme → sonuç), yoksa yüzey yüzey mi?
   - 10 dil (K-34) bu taramada eklenecek mi? Eklenmeyecekse bile tüm düzenler RTL'ye (Arapça) ve uzun metne hazır hale getirilecek mi?
   - Animasyon seviyesi (motion, lenis, reanimated): artırılsın mı, sadeleştirilsin mi? `prefers-reduced-motion` zorunlu.
   - Admin yoğunluğu: tablo yoğunluğu ve klavye kullanımı.
   - Gerçek harita gelene kadar SVG harita kalacak mı?
2. `/impeccable init` ile `PRODUCT.md` oluştur. İçerik dokümanlardan gelsin, uydurma:
   - **Müşteri**: Antalya ve Muğla'ya (AYT, DLM, BJV) gelen, çoğunlukla Avrupa ve Rusya'dan turistler. Mobilden rezervasyon yapar, uçaktan yorgun iner. Önceden belli sabit fiyat, güven ve hızlı rezervasyon ister. Ton: sade ve premium "VIP".
   - **Sürücü**: araç içinde, tek elle, kısa dikkat süresiyle kullanır. Büyük hedef, yüksek kontrast, az metin gerekir.
   - **Admin**: yoğun veri, hızlı tarama, denetlenebilirlik. Hassas alanlar maskeli kalır.
   - **Kısıtlar**: 4 dil (tr, en, de, ru) ve gelecek 10 dil, RTL, düşük bağlantı, WCAG AA, KVKK/GDPR onayları, taslak yasal metinler.
3. `/impeccable document` ile mevcut görsel sistemi `DESIGN.md`'ye yaz: renk, tipografi (mobilde Inter), boşluk, bileşenler. Web, admin ve mobil ayrı bölümler olsun. Ortak tokenları belirt.
4. Tekrar eden desenleri tespit et: `web/components`, `admin/components/ui.tsx`, `mobile/components/ui.tsx`. `/impeccable extract` uygun mu, değerlendir.

## 4. Plan (Superpowers: writing-plans)

`docs/plans/2026-11-impeccable-tarama.md` dosyasına planı yaz:

- Her ekran bir görev olsun. Görevde şunlar yazsın: dosya yolları, uygulanacak Impeccable komutları, kabul kriteri (critique puanı hedefi, P0/P1 sıfır, axe ihlali sıfır) ve doğrulama komutu.
- Önerilen sıra (brainstorming sonucuna göre güncelle):
  1. Web gelir akışı: ana sayfa → book → OTP → pay → payment-result → bookings/[code] (iptal).
  2. Mobil müşteri: login → book → booking/[code] → trip (canlı takip) → bookings → profile.
  3. Mobil sürücü: login/driver-register → home (teklif, yolculuk, tabela) → documents → earnings.
  4. Admin operasyon: login/2FA → panel → dispatch → bookings ve detay → drivers ve detay → documents.
  5. Admin geri kalanı ve web'in sabit ve yasal sayfaları.
  6. İkinci tam tarama.
- Planı bana göster. **Onaylamadan uygulamaya başlama.**

## 5. Uygulama (Superpowers: using-git-worktrees + subagent-driven-development)

1. **using-git-worktrees**: güncel `main`'den `ui/impeccable-pass` dalını ve worktree'sini aç. Taban testlerini worktree'de yeniden çalıştır.
2. **subagent-driven-development**: her ekran için ayrı bir alt ajan çalıştır. Aynı dosyalara dokunan ekranları paralel çalıştırma; özellikle ortak `ui.tsx` ve `globals.css`. Ortak bileşen değişikliklerini önce ve tek başına yap.
3. **Her ekran için Impeccable döngüsü.** Kapsamı dar tut; komutlara hedef olarak tek ekranı ver:
   1. `/impeccable critique <ekran>` ve `/impeccable audit <ekran>`: "önce" puanını kaydet.
   2. P0 ve P1 bulgularını düzelt. Gerekirse `typeset`, `layout`, `colorize`, `quieter`, `bolder` veya `distill` kullan.
   3. `/impeccable harden`: hata, boş ve yükleniyor durumları, ağ hatası, uzun Almanca metin, RTL hazırlığı (mantıksal CSS özellikleri), çok uzun adres ve isimler, büyük sayılar ve para biçimi (EUR/TRY).
   4. `/impeccable adapt`: 360, 390, 768, 1024 ve 1440 px. Mobilde küçük telefon ve tablet.
   5. `/impeccable clarify`: 4 dildeki metinler (`web/messages/*.json`, `mobile/lib/i18n.ts`). Anahtarlar tüm dillerde eksiksiz olmalı. Yasal metinlere dokunma (kural 3).
   6. `/impeccable optimize`: görseller (webp, boyut), LCP, gereksiz istemci JS'i, liste performansı.
   7. `/impeccable onboard`: yalnızca ilk kullanım ve boş durumları olan ekranlarda. Özellikle müşterinin ilk rezervasyonu ve sürücü kaydı ile belge tamamlama.
   8. `/impeccable animate`, `delight` ve `overdrive`: yalnızca brainstorming'de onaylandıysa. `prefers-reduced-motion` desteği zorunlu.
   9. `/impeccable polish`.
   10. Tekrar `critique` ve `audit` çalıştır, "sonra" puanını kaydet.
4. **test-driven-development**: davranış değiştiren her düzeltmeden önce kırmızı test yaz. Örnekler: form doğrulama, hata durumu, boş durum, erişilebilirlik etiketi. Web ve admin için Playwright + `@axe-core/playwright`, mobil için mevcut test altyapısı (yoksa önce sor). Salt görsel değişiklikte test yerine ekran görüntüsü karşılaştırması yeterli.
5. **Mobil (Expo/React Native) notu**: Impeccable web odaklıdır. Önizlemeyi 8081 ve 8082'deki Expo web üzerinden yap, bulguları RN'ye uyarla. Web'e özgü öneriler (CSS, `live`) RN'de geçerli değilse uygulama, raporda "uygulanamadı: neden" diye yaz. Android emülatörde (`getaway_pixel7`, `getaway_driver`) en az ana akışları doğrula.
6. **requesting-code-review**: her yüzey bittiğinde inceleme iste. Kritik bulgu varsa sonraki yüzeye geçme. Geri bildirimleri **receiving-code-review** ile değerlendir; körü körüne uygulama.
7. Her ekran ayrı commit olsun: `ui(<yuzey>/<ekran>): impeccable pass - <özet>`.

## 6. Raporlama

- Her ekran için `docs/ui-review/<yuzey>-<ekran>.md`:
  - önce ve sonra critique puanı,
  - audit bulguları (P0–P3) ve her birinin durumu,
  - yapılan değişiklikler (dosya listesi),
  - uygulanamayanlar ve nedeni,
  - önce ve sonra ekran görüntüleri (`docs/ui-review/screenshots/`).
- `docs/ui-review/README.md`: tüm ekranların durum tablosu (ekran, önce puanı, sonra puanı, açık P0/P1, durum).
- `CLAUDE.md` gereği: `degisiklik_gunlugu.md`, `proje_rehberi.md` durum matrisi, kök `README.md` durum tablosu; akış değiştiyse `test_senaryolari.md`, ekran eklendi veya çıktıysa `ekranlar.md`. Yeni karar varsa `kararlar.md`'ye K-36'dan itibaren yaz; açık kalanları `acik_konular.md`'ye ekle.
- Her yüzey sonunda bana Türkçe ve kısa bir özet ver: ne yapıldı, nasıl doğrulandı (komut ve sonuç), açık kalanlar, benim karar vermem gerekenler.

## 7. Kapanış

1. **İkinci tam tarama**: tüm ekranlarda `critique` ve `audit`. Kalan P0/P1 sıfır olmalı. Sıfır değilse nedenini raporla.
2. Tam doğrulama: backend pytest, `web` ve `admin` build, tüm tsc ve lint, Playwright ve axe testleri, ana akışların uçtan uca tekrarı (`test_senaryolari.md`).
3. CI: GitHub Actions varsa `npx impeccable detect` ve axe adımını ekle. Yoksa bana sor.
4. **finishing-a-development-branch**: merge, PR, dalı tutma veya atma kararını bana sor. Kendin merge etme.

---

## Şimdi yapılacak ilk adım

Bölüm 1 ve 2'yi uygula. Taban raporunu ve ekran envanterini ver, sonra dur. Onayım gelmeden dosya değiştirme.
