# VIP Transfer — getawaytransfers.com

Antalya ve Muğla'da havalimanı, otel ve şehirlerarası özel şoförlü transfer platformu. Monorepo.
Ürün kararları, fiyatlandırma, veri modeli ve yasal konular `docs/` klasöründe.

```
backend/   FastAPI (Python), PostgreSQL + PostGIS, Redis, ARQ        http://localhost:8000/docs
web/       Müşteri web sitesi (Next.js, 4 dil: tr, en, de, ru)         http://localhost:3000
admin/     Admin paneli (Next.js, 2FA, rol bazlı)                       http://localhost:3001
mobile/    Expo SDK 58: müşteri ve sürücü uygulaması (tek kod tabanı)
docs/      Kararlar, fiyatlandırma, veritabanı, ekranlar, yasal, test senaryoları
```

Her uygulamanın ayrıntılı kurulumu kendi `README.md` dosyasında (`backend/`, `web/`, `admin/`, `mobile/`).

## Geliştirme ortamını açma (VS Code önerilir)

Ön koşullar: Docker Desktop, Python 3.10+ (`backend/.venv`), Node 20+, Android SDK (emülatör için).

1. `Ctrl+Shift+P` → **Tasks: Run Task**
2. İlk kez: **Getaway: Veritabanını hazırla (migration + seed + demo)**
3. Her oturumda: **Getaway: Tümünü başlat** (veritabanı, backend, iş kuyruğu, web, admin, mobil önizlemeler)
4. Emülatörler: **Getaway: Android emülatörünü aç** (müşteri, `getaway_pixel7`) ve sürücü için ikinci emülatör (`getaway_driver`, bağlantı noktası 5556)
5. Mobil uygulamalar emülatörde: **Getaway: Mobil müşteri (Android emülatör)** ve **Getaway: Mobil sürücü (Android emülatör)**

Ekranları VS Code içinde açmak için `Ctrl+Shift+P` → **Simple Browser: Show**:

| Ekran | Adres |
|---|---|
| Müşteri web sitesi | http://localhost:3000 |
| Admin paneli | http://localhost:3001 |
| Mobil müşteri (web önizleme) | http://localhost:8081 |
| Mobil sürücü (web önizleme) | http://localhost:8082 |

Adım adım senaryolar, test hesapları ve demo sürücüler: `docs/test_senaryolari.md`.

## Komut satırıyla

```
docker compose up -d

cd backend
.venv\Scripts\alembic upgrade head
.venv\Scripts\python -m app.cli seed
.venv\Scripts\python -m app.cli seed-demo
.venv\Scripts\python -m pytest

cd ../web    && npm install && npm run dev
cd ../admin  && npm install && npm run dev
cd ../mobile && npm install && npm run web       # ya da: npm run start:driver / npm start (Expo Go)
```

Ön yüz denetimleri ve testleri (K-40):

```
cd web    && npm run lint                       # taban ihlalleri nedeniyle şimdilik sıfırdan farklı çıkar
cd web    && npm run test:e2e                   # 3000'de çalışan sunucuya karşı (Playwright + axe)
cd admin  && npm run lint                       # taban ihlalleri nedeniyle şimdilik sıfırdan farklı çıkar
cd admin  && npm run test:e2e                   # 3001'de çalışan sunucuya karşı; yerel e2e admin için admin/.env.e2e.local
cd mobile && npm run lint                       # taban ihlalleri nedeniyle şimdilik sıfırdan farklı çıkar
cd mobile && npm test                           # jest-expo + React Native Testing Library

node --test "scripts/*.test.mjs"                # kök betik testleri
node scripts/sync-tokens.mjs --check            # renk tokenı kaynakla uyumlu mu

cd scripts/ui-shots && npm ci                   # önce/sonra ekran görüntüsü betikleri: node web.js --out after
```

`npm run lint`, taban çizgisindeki bilinen ihlaller (web 4, admin 3, mobil 9) giderilene kadar sıfırdan farklı kodla çıkar; bu yüzden lint ve testler `&&` ile zincirlenmez, ayrı çalıştırılır; kaynak ve sayılar `docs/ui-review/lint-taban.md`. Ekran görevleri ilgili dosyaya dokundukça giderilir; yeni ihlal eklenmez.

Renk tokenları tek kaynaktan (kök `DESIGN.md` `colors` bloğu) üretilir: `node scripts/sync-tokens.mjs` (kontrol: `--check`, test: `node --test "scripts/*.test.mjs"`). Üretilmiş `tokens.css` / `tokens.ts` dosyaları elle düzenlenmez.

Geliştirmede SMS kodları backend konsoluna yazılır ve uygulamalarda ekranda gösterilir; ödemeler sahte sağlayıcıyla yapılır.

Tek yerden özet: `docs/proje_rehberi.md`. Değişiklik kaydı: `docs/degisiklik_gunlugu.md`.

## Durum (2026-11-09)

| Alan | Durum |
|---|---|
| Backend | Tamamlandı; 94 test geçiyor. Kur TCMB'den otomatik, gidiş-dönüş %5, fiyatlar 5'in katı. Adres (Google Places, şimdilik örnek veri), ilçe bazlı fiyat (K-28), PayTR (test mağazası bekliyor); 2026-11-08: sürücü iş havuzu, bitirme kuralları, ETA bildirimleri, müşteri–sürücü sohbeti (K-47..K-52); admin manuel rezervasyon ve elle tahsilat (K-54); admin şikâyet incelemesi uçları (K-55); 2026-11-09: FCM push (K-56), redis 5.3.1 ile temiz `pip install -r` çalışıyor, 127 test |
| Müşteri web sitesi | Tamamlandı; 4 dil, adres arama, rezervasyon, ödeme, iptal, KVKK sayfaları, mobil uyumlu. 2026-10-31: yeni tasarım, Motion/Lenis animasyonları, 4 araçlı filo (VIP Minibüs, K-35). 2026-11-02: ana sayfa Impeccable geçişi (rota rayı "Nasıl çalışır", koyu güven şeridi, JS'siz/hareket azaltmada görünür bölümler, axe 0); rezervasyon sihirbazı geçişi (adım göstergesi yolda değişmez, alan düzeyi hatalar, ağ hatasında yeniden dene, onayda iptal kademeleri, axe 0); SMS doğrulama geçişi (duyurulan hatalar, alan adında ülke kodu, tekrar gönder sayacı, axe 0); ödeme ekranı geçişi (yükleniyor/hata/yeniden dene durumları, duyurulan ödeme reddi, kod-güzergâh-tarih özeti, açık ödemede tekrar dene yok, iptal edilmiş rezervasyon açıklaması, axe 0); rezervasyon detayı ve iptal geçişi (yükleniyor/hata/bulunamadı durumları, API'nin iade önizlemesi + K-14 kademeleri, eşit görünür "Vazgeç", klavyeyle iptal ve duyurulan sonuç, eskiyen canlı konum canlı gösterilmez (K-44), axe 0). 2026-11-03: yüzey 1 incelemesi düzeltmeleri (ağ/5xx/süre aşımında giriş formu yerine hata ve yeniden dene, 15 sn istek sınırı, ortak yoklama, ödeme sayfası açıkken oturum düşerse iFrame korunur ve yeni ödeme açılmaz (K-45), "oturumunuz sona erdi" notu); Rezervasyonlarım geçişi (kod alanında biçim ipucu ve alan hatası, boş liste durumu, axe 0); Hesabım geçişi (yükleniyor/hata durumları, kaydedilemeyen pazarlama onayı işaretli kalmaz, duyurulan kayıt, axe 0); veri talebi geçişi (önceden seçimsiz tür radyo grubu, gönderim kilidi, liste yükleniyor/hata/boş durumları, axe 0); yasal sayfalar geçişi (70ch okuma ölçüsü, iptal kademeleri ayrı liste, KVKK metninde içindekiler, baskı stili; metin değişmedi, axe 0); 404 geçişi (Rezervasyonlarım bağlantısı, kendi sekme başlığı, axe 0); 2026-11-08: rezervasyon sayfasında Google rota haritası (solda harita, ortada araçlar, sağda özet; mobilde harita üstte); 2026-11-08: rezervasyon detayında kalan süre, sürücüyle mesajlaşma ve yolculuğu bitirme (K-55) |
| Admin paneli | Tamamlandı; 24 rota (ekran), 2FA, rol bazlı menü, parola değiştirme; 2026-11-08: WhatsApp/telefon müşterisi için müşteri ekleme ve manuel rezervasyon (ödeme bağlantısı veya elle tahsilat, K-54); gerekçeli sohbet görüntüleme ve müşteri bitirişleri listesi (K-55) |
| Mobil (müşteri + sürücü) | Tamamlandı; 2026-10-31 Uber tarzı yeni tasarım (Reanimated). Harita: telefonda `react-native-maps` gerçek harita (rezervasyon detayı ve sürücü yolculuğunda rota ve sürücü işaretçisi; Android emülatörde doğrulandı), web önizlemede SVG. Android push (FCM, K-56) 2026-11-09 eklendi, iOS APNs ve mağaza derlemesi bekliyor; 2026-11-08: Android emülatöründe gerçek Google haritası, rezervasyonda kesikli önizleme ve gerçek rota; 2026-11-08: Uber tarzı akış: iş havuzu ve kabul öncesi ayrıntı, aşamalı navigasyon, arka plan konum (sürücü geliştirme derlemesi), kalan süre bildirimleri, sohbet, yolculuğu bitirme |
| Ön yüz testleri | Altyapı kuruldu (K-40): web ve admin ESLint + Playwright + axe (smoke), mobil ESLint + jest-expo + RNTL, kök betik testleri, ekran görüntüsü betikleri. Lint taban ihlalleri kısmen giderildi (web 4); ekran bazlı testler arayüz taramasında yazılıyor (web ortak dosyalar B-W0: `web/e2e/shared.spec.ts`, yerel 404, odak halkası, durum bileşenleri; ana sayfa B-W1: `web/e2e/home.spec.ts`, axe 0, klavye, hareket azaltma, 360 px Almanca; rezervasyon sihirbazı B-W2: `web/e2e/book.spec.ts`, dört adımda axe 0, onay kutuları, uçuş no hatası, TRY tek satır, ağ hatası; SMS doğrulama B-W3: `web/e2e/otp.spec.ts`, yanlış kod, tekrar gönder sayacı, ülke kodu; ödeme B-W4: `web/e2e/pay.spec.ts`, yükleniyor, ödeme reddi, ağ hatası, axe 0, 360 px Almanca; ödeme sonucu B-W5: `web/e2e/payment-result.spec.ts`, bekleme durumu, iFrame'den çıkış, axe 0, 360 px Almanca; rezervasyon detayı B-W6: `web/e2e/booking-detail.spec.ts`, iptal önizlemesi, klavye, bulunamadı, canlı takip eskimesi, axe 0, 360 px Almanca; yasal sayfalar B-W11–14: `web/e2e/legal.spec.ts`, K-14 kademeleri birebir, içerik değişmedi, taslak notu, 65–75ch, içindekiler, baskı; 404 B-W15: `web/e2e/not-found.spec.ts`) |
| Geliştirme süreci | Claude ajanları (K-53): `code-reviewer`, `qa-tester`, `ui-auditor`; yalnızca orta ve riskli değişiklikte çağrılır (`CLAUDE.md`). GitHub CI: backend pytest, mobil jest, tsc ve lint tabanı her PR'da (`.github/workflows/ci.yml`); Playwright CI'da yok |
| Yasal metinler | Taslak; hukukçu onayı bekliyor (`web/lib/site.ts` içinde yer tutucular) |

Araç tipleri: Minivan, VIP Van, Minibüs, VIP Minibüs (K-35). Sedan hizmetten kaldırıldı.

Kararı verilmiş, geliştirmesi bekleyen: günlük araç kiralama (K-29), on dil (K-34, uygulaması K-36). Mobil gerçek harita (K-37) uygulandı; Android Maps anahtarı ve iOS doğrulaması bekliyor. Arayüz taraması (Impeccable) planlandı (K-38, K-39; `docs/plans/2026-11-impeccable-tarama.md`); ön yüz test altyapısı kuruldu (K-40, aşağıda).

## Mimari notlar

- Web ve admin, backend'e tarayıcıdan doğrudan değil kendi sunucu vekilleri (`app/bff`) üzerinden bağlanır. Jetonlar `httpOnly` çerezde tutulur.
- Mobil uygulama jetonları cihazın güvenli deposunda (Keychain / Keystore) tutar ve backend'e doğrudan bağlanır.
- Fiyat istemcide hesaplanmaz; backend hesaplar ve rezervasyonda yeniden doğrular. Adres, backend'in imzaladığı bir jetonla taşınır; ilçe istemci tarafından değiştirilemez.
- Ortam değişkenleri `GETAWAY_` önekiyle okunur. Gerçek anahtarlar `.env` dosyasında tutulur ve commit edilmez; örnek için `backend/.env.example`.

## Güvenlik ve veri

- Kart verisi sistemde tutulmaz; ödeme sağlayıcının sayfası kullanılır.
- Kişisel alanlar (telefon, e-posta, adres, IBAN) alan düzeyinde şifrelenir; admin panelinde maskelenir.
- Denetim kayıtları (`audit_logs`) değiştirilemez (PostgreSQL tetikleyicisi).
- Uçuş verisi yolculuk tamamlanınca silinir (K-31; K-18'in 24 saatlik süresinin yerini aldı).

## Açık konular

`docs/acik_konular.md`. Hukuki ve ödeme maddeleri doğrulanmadan ilgili özellikler canlıya alınmaz.
