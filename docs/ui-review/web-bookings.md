# Web Rezervasyonlarım (`/bookings`, `BookingsHome`): Impeccable geçişi (B-W8)

Tarih: 2026-11-03 · Dal: `ui/impeccable-pass` · Mod: **Operate** · North Star: "Kıyı Yolu" (`DESIGN.md`)
Yöntem: ⚠️ DEGRADED: single-context (görev kuralı alt ajan açmayı yasaklıyor; Assessment A önce, detector kanıtı B sonra, aynı bağlamda). Impeccable adımları in-thread pass. Skill'in soru adımları yerine görev brifi kullanıldı (soru sorulmadı; kararlar aşağıda).
Kapsam: oturumsuz sorgulama (kod + SMS girişi), oturumlu kodla bulma formu, rezervasyon listesi, boş liste. Yükleniyor, liste ağ hatası ve 401 durumları B-W6/B-W7'de yapıldı; yeniden yapılmadı (testleri `booking-detail.spec.ts` sonunda, yeşil).

## Puanlar

| Ölçüm | Önce | Sonra |
|---|---|---|
| critique (Nielsen, /40) | **22/40 (%55, Acceptable)** | **35/40 (%88, Good)** |
| audit | **14/20** | **18/20** |
| axe (wcag2a/2aa/21a/21aa/22aa) | 0 (oturumsuz sayfa, taban) | **0** (oturumsuz + alan hatası açık, oturumlu liste, boş liste) |
| detector (`BookingsHome.tsx`) | 0 | 0 |
| lint (`BookingsHome.tsx`, `bookings.spec.ts`) | 0 | 0 |

### critique ayrıntısı

| # | Sezgisel | Önce | Sonra | Not |
|---|---|---|---|---|
| 1 | Sistem durumu | 3 | 4 | Yükleniyor/hata (B-W7) + boş durum artık `EmptyState`; alan hatası `role="alert"` |
| 2 | Gerçek dünya | 3 | 4 | Kodun nerede yazdığı söylenir ("onay SMS'inizde yazar") |
| 3 | Kullanıcı kontrolü | 3 | 3 | Değişmedi; çıkış/yeni rezervasyon bağlantıları yerinde |
| 4 | Tutarlılık | 2 | 4 | Boş durum ortak `EmptyState`; devre dışı düğme yerine alan hatası (OTP ile aynı desen, B-W3) |
| 5 | Hata önleme | 2 | 3 | Yapıştırılan "GA7K-3P9Q" / "ga 7k3p9q" temizlenir (önce `maxLength` ayraçlarla kesiyordu) |
| 6 | Tanıma | 2 | 4 | Biçim yalnızca yer tutucudaydı; şimdi görünür ipucu alana bağlı (`aria-describedby`) |
| 7 | Esneklik | 2 | 3 | Enter gönderir, yapıştırma ayraçları kabul; geçmiş/son kod yok |
| 8 | Estetik ve sadelik | 3 | 3 | Liste başlığı ve `ul`; telefonda tam genişlik düğme |
| 9 | Hata kurtarma | 1 | 4 | Yanlış biçim önce sessizdi (düğme gri, açıklama yok); şimdi örnekli hata, odak alana |
| 10 | Yardım | 1 | 3 | Bağlamsal ipucu; detaydaki `notFoundHint` ile tutarlı |
| **Toplam** | | **22/40** | **35/40** | |

### audit ayrıntısı

| Boyut | Önce | Sonra | Ana bulgu (sonra) |
|---|---|---|---|
| Erişilebilirlik | 2 | 4 | Alan hatası/ipucu bağlı, `aria-invalid`; liste `ul` + `h2` (adet okunur); "Görüntüle" görsel etiketi `aria-hidden` (bağlantı adı tekrarsız) |
| Performans | 3 | 3 | Değişiklik yok; istemci bileşeni zorunlu (oturum, yönlendirme) |
| Tema | 3 | 4 | Yalnızca tokenlar; yeni sınıflar `globals.css` |
| Duyarlılık | 3 | 4 | 360–1440 px Almanca + `12.345,00 TRY` taşma/kesilme yok (test); telefonda düğme alt satırda tam genişlik |
| Uygulama bütünlüğü | 3 | 3 | `legs[0]` korumalı; mantıksal özellikler (`margin-inline-start`, `margin-block-start`, `inline-size`) |

## Bulgular ve durum

| Öncelik | Bulgu | Durum |
|---|---|---|
| P1 | Yanlış biçimli kod sessizce yutuluyor: oturumluyken "Bul" gri ve nedensiz; oturumsuzken girişten sonra kod yok sayılıp listeye gidiliyor | **Kapandı**: alandan çıkınca veya gönderimde "Rezervasyon kodu GA ile başlar ve 8 karakterdir (ör. GA7K3P9Q)." (`role="alert"`, `aria-invalid`), gönderimde odak alana; düğme her zaman etkin. Girişten sonra hatalı kod alanında hatasıyla kalır. Test: "lookup code validates format", "… (signed out)" |
| P1 | Biçim bilgisi yalnızca yer tutucuda (yazınca kaybolur) | **Kapandı**: görünür ipucu (`#code-hint`); oturumsuzken "İsterseniz boş bırakın." eki |
| P2 | Boş liste düz kart + metin, başlıksız | **Kapandı**: `EmptyState` (h2 "Henüz rezervasyonunuz yok.", açıklama, "Yeni rezervasyon"). Test: "empty list EmptyState" |
| P2 | `maxLength=8` yapıştırılan "GA7K-3P9Q"yu ayraç atılmadan kesiyordu ("GA7K3P9") | **Kapandı**: sınır temizlemeden sonra uygulanır (test: "ga-zz 0000" → "GAZZ0000") |
| P2 | Liste anlamı yok (ayrı bağlantılar), başlıksız | **Kapandı**: `section` + h2 "Rezervasyonlarınız" + `ul.booking-list`. Test: "bookings list is a list with a heading" |
| P2 | Telefonda düğme alta sarınca etiket payı kadar boşluk; alan hatası düğmeyi kaydırınca dokunuş boşa gidiyordu (test telefonda yakaladı) | **Kapandı**: ≤560 px düğme tam genişlik, pay yok; düğmeye geçerken (blur → buton) hata gösterilmez, gönderimde gösterilir |
| P3 | `b.legs[0]` bacaksız kayıtta çöker | **Kapandı**: koşullu |
| P3 | Satırın tamamı bağlantı; durum rozeti yalnız renk değil metin de taşır | Değişmedi (zaten metinli) |
| P3 | Listede sayfalama/sanallaştırma yok | Açık (P3): müşteri başına kayıt sayısı küçük; API sayfalamıyor |

Kararlar (soru sorulmadı): kod alanı oturumsuzken isteğe bağlı kalır (boşsa giriş sonrası liste); hata yazarken değil alandan çıkınca/gönderimde gösterilir.

## Yapılanlar (Impeccable adımları)

- **harden**: boş/hata/yükleniyor (B-W7 korundu), yapıştırma temizliği, bacaksız kayıt, uzun Almanca ipucu ve hata, `₺12.345,00` tek satır tabular; `dir="ltr"` kod alanı ve kod metni.
- **adapt**: 360/390/768/1024/1440 px Almanca taşma + kesilme testi; telefonda tam genişlik düğme.
- **clarify** (tr, en, de, ru): yeni `bookings.codeHint`, `codeHintOptional`, `codeInvalid`, `emptyText`, `listTitle`; dört dilde eşit.
- **optimize**: görsel yok; `"use client"` gerekli; liste küçük (sanallaştırma gereksiz).
- **onboard**: görevde istenmedi. **animate/delight**: eklenmedi (Operate; liste ekranında hareket gereksiz).
- **polish**: kod `strong` + rozet satırı, güzergâh `overflow-wrap`, fiyat + "Görüntüle" sağda (`margin-inline-start: auto`).

## Değişen dosyalar

`web/components/BookingsHome.tsx`, `web/app/globals.css` (`.booking-list`, `.bookings-list-title`, `.booking-row-*`, `.lookup-form`), `web/messages/{tr,en,de,ru}.json`, `web/e2e/bookings.spec.ts` (yeni, 8 test).

## Uygulanamadı: neden

- Sayfalama: API desteklemiyor (backend değişikliği yok kuralı).

## Doğrulama

- Kırmızı (önce, `npx playwright test bookings.spec --project=desktop --workers=1`): **7 başarısız, 1 geçti**. "signed out": `#code-hint` yok; "validates format": "Bul" `disabled`; "empty list EmptyState" ve boş axe: h2 başlıklı `.state-empty` yok; axe testi: `#code-error` yok; liste testi: `list` adı yok; 360 px testi: "Suchen" devre dışı (zaman aşımı). Geçen: "bookings error state" (B-W7 davranışı, gerileme koruması).
- Ara FAIL'ler: telefonda `ga-zz 0000` → "GAZZ00" (`maxLength`), telefonda odak kaybı (blur hatası düğmeyi kaydırıyordu); ikisi düzeltildi.
- Sonra: `npx playwright test bookings.spec --workers=1` (iki proje): **15 geçti, 1 atlandı** (360 px testi yalnızca desktop). `booking-detail.spec` + `shared.spec` Rezervasyonlarım testleri (`-g "bookings|booking code"`): **7 geçti**.
- `npx tsc --noEmit` temiz; `npx eslint` 0; `impeccable detect` `[]`.
- Görüntü: `node scripts/ui-shots/web.js --out after --only bookings-anon,bookings-list --locales tr,de`: 8 görüntü, kaçan yok.

## Görüntüler

- Önce: `screenshots/before/web/{tr,de}-{1440,390}-{bookings-anon,bookings-list}.png`
- Sonra: `screenshots/after/web/{tr,de}-{1440,390}-{bookings-anon,bookings-list}.png`

## Düzeltme turu 1 (2026-11-03, inceleme `task-B-W8-10-review.md`)

| Bulgu | Çözüm |
|---|---|
| Önemli 1: oturumluyken boş kodla **Bul** sessizce hiçbir şey yapmıyordu | Gönderimde "Rezervasyon kodunu girin." alan hatası (`role="alert"`, `aria-invalid`), odak alana; yazmaya başlayınca kalkar. Oturumsuzken boş kod hâlâ isteğe bağlı (girişten sonra boş kod hata vermez, liste açılır). Yeni anahtar `bookings.codeRequired` (4 dil). Test: "lookup with an empty code asks for the code" |
| Küçük 7: blur'da `relatedTarget instanceof HTMLButtonElement` Safari'de güvenilmez (düğmeye odak verilmez) | Hata yalnızca odak formun **dışındaki başka bir alana** geçince gösterilir; `relatedTarget` boşsa (Safari dokunuşu, boş alana tıklama) veya hedef bir düğme/aynı formdaysa gösterilmez. Gönderimde ve girişten sonra her durumda denetlenir. Testte: Tab ile düğmeye geçiş ve başlığa tıklama hata göstermez, ülke seçimine Tab gösterir |
| Küçük 6: test kararsızlığı | `beforeAll` ısınması (`warmUp`, `e2e/session.ts`: `/tr/bookings`, `/de/bookings` 180 sn ile bir kez açılır); boş liste ve hata testleri `route.fetch()` yerine durağan yanıt; `toPass` tıklama döngüleri kaldırıldı (alan istemcide oturum denetiminden sonra çizilir, göründüğünde hidrasyon bitmiştir) |
| Küçük 8: `_log-only.json` gürültüsü | `9461a81` içeriğine geri alındı |

Puan değişmedi (35/40): "Hata önleme" ve "Hata kurtarma" zaten 3/4 idi; boş gönderim boşluğu, P1 sayılmadan kapanmış oldu. Doğrulama: `npx playwright test bookings.spec --workers=1` **17 geçti, 1 atlandı**; `tsc` ve `eslint` temiz.
