# Web veri talebi (`/data-request`, `DataRequestPanel`): Impeccable geçişi (B-W10)

Tarih: 2026-11-03 · Dal: `ui/impeccable-pass` · Mod: **Operate** · North Star: "Kıyı Yolu" (`DESIGN.md`)
Yöntem: ⚠️ DEGRADED: single-context (görev kuralı alt ajan açmayı yasaklıyor; Assessment A önce, detector kanıtı B sonra). Impeccable adımları in-thread pass; soru sorulmadı, kararlar aşağıda.
Kapsam: KVKK m.11 / GDPR talep formu ve "Taleplerim" listesi. Sayfa başındaki metin (`dataRequest.text`) ve yasal hak metni (`legal.privacy.rights`) **değiştirilmedi**. Oturumsuz giriş (`RequireLogin`) B-W3/B-W7'de yapıldı.

## Puanlar

| Ölçüm | Önce | Sonra |
|---|---|---|
| critique (Nielsen, /40) | **21/40 (%53, Acceptable)** | **33/40 (%83, Good)** |
| audit | **13/20** | **18/20** |
| axe | 0 (sorunlar otomatik kural dışı: yutulan liste hatası, duyurulmayan sonuç) | **0** (alan hatası açık + iki talepli liste) |
| detector (`DataRequestPanel.tsx`, `data-request/page.tsx`) | 0 | 0 |
| lint (`DataRequestPanel.tsx`, `data-request.spec.ts`) | 0 | 0 |

### critique ayrıntısı

| # | Sezgisel | Önce | Sonra | Not |
|---|---|---|---|---|
| 1 | Sistem durumu | 1 | 4 | Liste yüklenirken/hata durumu yoktu; "Gönderiliyor…", sonuç `role="status"` ve son tarihiyle |
| 2 | Gerçek dünya | 3 | 3 | Hak adları sade; değişmedi |
| 3 | Kullanıcı kontrolü | 3 | 3 | Tür bilinçli seçilir; gönderilen talep geri alınamaz (backend) |
| 4 | Tutarlılık | 2 | 4 | Seçenek kartları sihirbazdaki `.option-card` ile aynı; ortak durum bileşenleri |
| 5 | Hata önleme | 1 | 4 | Önce "Verilerime erişim" önceden seçiliydi ve çift gönderim mümkündü; şimdi seçim zorunlu (silme talebi kazara gitmez), gönderim kilitli |
| 6 | Tanıma | 2 | 4 | Üç hak `select` içinde gizliydi; şimdi hepsi görünür radyo grubu |
| 7 | Esneklik | 2 | 2 | Değişmedi |
| 8 | Estetik ve sadelik | 3 | 3 | Liste satırları ayrımlı; boş liste tek cümle |
| 9 | Hata kurtarma | 1 | 3 | Liste hatası yutuluyordu (boş görünüyordu); şimdi `ErrorState` + "Tekrar dene"; gönderim hatası formda |
| 10 | Yardım | 3 | 3 | Hak metni yerinde; not alanında kalan karakter |
| **Toplam** | | **21/40** | **33/40** | |

### audit ayrıntısı

| Boyut | Önce | Sonra | Ana bulgu (sonra) |
|---|---|---|---|
| Erişilebilirlik | 2 | 4 | `fieldset` + `legend` radyo grubu, alan hatası gruba bağlı (`aria-describedby`, `role="alert"`), odak ilk seçeneğe; liste `ul` + `h2` adı; sonuç kalıcı canlı bölgede |
| Performans | 3 | 3 | Tek liste isteği; istemci bileşeni zorunlu |
| Tema | 3 | 4 | Yalnızca tokenlar; `.choice-group`, `.request-list` |
| Duyarlılık | 3 | 4 | 360–1440 px Almanca taşma/kesilme yok (test) |
| Uygulama bütünlüğü | 2 | 3 | Bilinmeyen durum kodu ham anahtar yerine kod olarak gösterilir (`t.has`); mantıksal özellikler (`border-block-start`, `padding-block`) |

## Bulgular ve durum

| Öncelik | Bulgu | Durum |
|---|---|---|
| P1 | Talep türü `select`: üç hak gizli; "Verilerime erişim" önceden seçili, silme talebi farkında olmadan yanlış türle gidebilir | **Kapandı**: radyo grubu (`fieldset`/`legend`), önceden seçim yok, seçmeden gönderimde "Talep türünü seçin." Test: "request type radio group; sent state" |
| P1 | Liste hatası yutuluyordu: ağ hatasında "talep yok" gibi boş görünüyordu (önceki notta "B-W9'a" ertelenmişti) | **Kapandı**: `ErrorState` + "Tekrar dene"; form kullanılabilir kalır. Test: "data-request error state" |
| P1 | Gönderim kilidi yok: çift tıklama iki yasal talep açar | **Kapandı**: "Gönderiliyor…", düğme kapalı, ref kilidi. Test: "data request submit is locked while sending" (iki tıklama → 1 POST) |
| P1 | "Talebiniz alındı." duyurulmuyordu (rolsüz) | **Kapandı**: `role="status"` + son tarih ("Talebiniz alındı. Son tarih: …") |
| P2 | Liste yüklenirken bölüm hiç yoktu; boşken de yoktu | **Kapandı**: "Talepleriniz yükleniyor…" ve "Henüz bir talebiniz yok." Testler: "data-request loading state", "data-request empty state" |
| P2 | Durum rozeti tek renk | **Kapandı**: tamamlandı yeşil, reddedildi kırmızı, diğerleri nötr (metin her zaman yazılı) |
| P3 | Not alanında sınır görünmüyordu (`maxLength` 1000 sessizce keser) | **Kapandı**: "Kalan karakter: N" |
| P3 | Tür seçeneklerinde hakların kısa açıklaması yok | Açık (P3): yasal metin uydurulmaz; hukukçu onaylı açıklama gelirse eklenebilir |

Kararlar: tür önceden seçilmez (Global Constraints'teki "önceden işaretli kutu yok" ilkesi burada da uygulandı: silme talebi bilinçli seçilmeli). Boş liste için `EmptyState` kutusu yerine bölüm başlığı altında tek cümle (eylem zaten hemen üstteki form; çift başlık olmasın). e2e'de talep oluşturma taklit edilir (admin KVKK kuyruğuna test talebi düşmez).

## Yapılanlar (Impeccable adımları)

- **harden**: yükleniyor, liste hatası, gönderim hatası, 401 (önceden vardı), çift gönderim, bilinmeyen durum kodu, uzun Almanca.
- **adapt**: 360/390/768/1024/1440 px Almanca testi; seçenek kartları tam genişlik dokunma hedefi.
- **clarify** (tr, en, de, ru): `dataRequest.typeRequired`, `noteHint`, `sending`, `sentDue`, `listLoading`, `empty`; kullanılmayan `sent` anahtarı dört dilden kaldırıldı (yerini `sentDue` aldı). Yasal metne dokunulmadı.
- **optimize**: görsel yok.
- **animate/delight**: eklenmedi (Operate, yasal talep formu).
- **polish**: liste satırları ince çizgiyle ayrılır, tarih satırı alt satırda.

## Değişen dosyalar

`web/components/DataRequestPanel.tsx`, `web/app/globals.css` (`.choice-group`, `.request-list`, `.request-type`), `web/messages/{tr,en,de,ru}.json`, `web/e2e/data-request.spec.ts` (yeni, 7 test).

## Uygulanamadı: neden

- Hak açıklamaları: yasal içerik uydurulmaz (yukarıda).
- Gönderilmiş talebi geri çekme: backend ucu yok.

## Doğrulama

- Kırmızı (önce, `npx playwright test data-request.spec --project=desktop --workers=1`): **7 başarısız, 0 geçti**. Tümü yeni öğeleri bulamadı: "Talep türü" grubu (`select` vardı), "Taleplerim" bölümü/başlığı (liste boşken yoktu), "Talepleriniz yükleniyor" durumu, liste hatası `alert`'i (yutuluyordu), Almanca liste adı.
- Sonra: `npx playwright test data-request.spec --workers=1` (iki proje): **13 geçti, 1 atlandı** (360 px yalnızca desktop).
- `npx tsc --noEmit` temiz; `npx eslint` 0; `impeccable detect` `[]`; dört dilde anahtar kümesi eşit (derin karşılaştırma).
- Görüntü: `node scripts/ui-shots/web.js --out after --only data-request,data-request-anon --locales tr,de`: ilk koşuda betiğin oturumlu akışı `tr-1440-pay` adımında zaman aşımına düştü (bu ekranla ilgisiz ödeme akışı adımı); `--locales tr` ile yeniden çekildi, kaçan yok.

## Görüntüler

- Önce: `screenshots/before/web/{tr,de}-{1440,390}-{data-request,data-request-anon}.png`
- Sonra: `screenshots/after/web/{tr,de}-{1440,390}-{data-request,data-request-anon}.png`

## Düzeltme turu 1 (2026-11-03, inceleme `task-B-W8-10-review.md`)

| Bulgu | Çözüm |
|---|---|
| Küçük 3: "Talebiniz alındı." yeni talebe başlanınca da kalıyordu | Tür seçimi veya not düzenlemesi önceki sonucu ve gönderim hatasını kaldırır. Test: "starting a new request clears the sent message" |
| Küçük 4 (kontrolcü kararı): geri çekilemeyen "silme" talebi tek tıklamayla gidiyordu | Satır içi onay (rezervasyon iptaliyle aynı desen): "Silme talebini onaylayın" başlığı (odak buraya), nötr UX metni "Hesabınızdaki kişisel verilerin silinmesi talebini göndermek üzeresiniz. Gönderdikten sonra bu ekrandan geri çekemezsiniz.", kırmızı **Silme talebini gönder** (`btn danger`) ve eşit boyutta çerçeveli **Vazgeç** (`btn outline`; odak gönder düğmesine döner). Tür değişince onay kapanır; erişim/düzeltme onaysız gider. Yasal hak metni eklenmedi. Yeni anahtarlar `dataRequest.deleteConfirmTitle`, `deleteConfirmText`, `deleteConfirm`, `keep` (4 dil). Test: "deletion request asks for confirmation before sending" (POST yok → Vazgeç → odak → tür değişimi → onayla → tek POST `silme`); axe testi onay paneli açıkken de çalışır |
| Küçük 6: kararsızlık | `beforeAll` ısınması (`/tr/legal/cookies`, `/tr/data-request`, `/de/data-request`); `toPass` döngüleri kaldırıldı (form istemcide çizilir) |

### Yeniden critique (in-thread, dürüst puan)

| # | Sezgisel | Tur 0 | Tur 1 | Gerekçe |
|---|---|---|---|---|
| 1 | Sistem durumu | 4 | 4 | Eski sonuç artık yeni talebe taşınmaz (tur 0'da bu yüzden gerçekte 3'tü) |
| 2 | Gerçek dünya | 3 | 3 | |
| 3 | Kullanıcı kontrolü | 3 | 4 | Geri çekilemeyen adımda "Vazgeç"; tür değişimi onayı kapatır |
| 4 | Tutarlılık | 4 | 4 | Onay, iptal paneliyle aynı sınıflar ve davranış |
| 5 | Hata önleme | 4 | 4 | Önceden seçimsiz tür + silme onayı + kilit (tur 0'da onay yokken 4 iyimserdi) |
| 6 | Tanıma | 4 | 4 | |
| 7 | Esneklik | 2 | 2 | |
| 8 | Estetik | 3 | 3 | Onay paneli kırmızı ince çerçeve, yumuşak zemin, metin tam kontrastlı (360 px görüntüye bakıldı) |
| 9 | Hata kurtarma | 3 | 3 | |
| 10 | Yardım | 3 | 3 | Onay metni sonucu söyler; hak açıklamaları hâlâ yok (yasal metin uydurulmaz) |
| **Toplam** | | 33/40 | **34/40 (%85)** | Tur 0 puanı dürüst ölçüldüğünde 31/40 olurdu (madde 1 ve 5 iyimser) |

Doğrulama: `npx playwright test data-request.spec --workers=1` **17 geçti, 1 atlandı**; `tsc`, `eslint` temiz. Onay paneli telefon genişliğinde Almanca görüntüyle denetlendi (düğmeler tam genişlik, taşma yok).
