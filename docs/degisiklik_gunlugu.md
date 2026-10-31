# Değişiklik Günlüğü

En yeni üstte. Her değişiklikte ilgili `.md` dosyaları da güncellenir.

## 2026-10-31 (düzeltmeler, dal `redesign/web-mobile-ui`)

- **VIP Minibüs** ayrı araç tipi (K-35): `backend/app/seed.py` (`vip_minibus`, çarpan 2,40), web ve mobil görsel eşlemesi, VIP etiketi. Test `test_api_customer.py` güncellendi; backend 78 test geçti.
- **Filo görselleri** yeniden üretildi: dört araç aynı tuvalde, gövde genişliği ve tekerlek çizgisi eşit (`web/public/images/fleet-*.webp`, `mobile/assets/images/*.jpg`). Web filosu masaüstünde 4 sütun, telefonda 2×2 ızgara (yatay kaydırma kaldırıldı).
- **Telefon giriş görseli**: kaynak çözünürlükte, aracı ortalayan dikey kırpma; görsel üst bantta kalır, form koyu zemine geçer, telefonda paralaks kapalı. Masaüstü görseli tam çözünürlükte.
- **Hizmetler**: dördüncü kart ("Özel günler") tam genişlik bant.
- **Admin**: yatay formlarda ipucu ("Boş: hemen") alanın altına taşındı, tüm girişler aynı hizada; tarih alanı genişletildi (fiyat, komisyon, kur, denetim kaydı ekranları).
- **Mobil**: yolcu/bagaj sayacı yeniden düzenlendi (etiket üstte, − sayı + altta).
- **Sürücü girişi hatası**: kod hatası değildi; önizleme sunucusu, önceki testten kalan önbellekte 8010 portlu geçici API adresini sunuyordu. Sunucular `--clear` ile yeniden başlatıldı, sürücü girişi doğrulandı.

## 2026-10-31 (tasarım yenilemesi, dal `redesign/web-mobile-ui`)

- **Web sitesi** yeniden tasarlandı: kenardan kenara giriş görseli (uçaklı yol), geniş kapsayıcı (1440 px + orantılı kenar boşluğu), mobil menü, bento hizmet ızgarası, kıyı yolu çağrı bandı, SSS animasyonu. Animasyon: `motion` (Framer Motion) ve `lenis` (yumuşak kaydırma). Yeni dosyalar: `web/app/home.css`, `web/components/Motion.tsx`, `SiteHeader.tsx`, `FleetCard.tsx`.
- **Rota kutusu düzeltildi**: "Nereden–Nereye" arasındaki çizgi artık iki alanın tam ortasından geçen nokta–kesikli çizgi–kare rayı (`.route-rail`); seçili adres ipucu tek satır.
- **Filo**: minibüs kartında beyaz (standart) ve siyah seçenek; beyaz Sprinter eklendi. Grup bandında yandan Vito görseli kaydırdıkça yola giriyor. Görseller masaüstündeki `project images` klasöründen üretildi (`web/public/images`, `mobile/assets/images`).
- **Rezervasyon sihirbazı**: Uber tarzı araç kartları, fiyat hesaplanırken iskelet yükleme (eskiden "uygun değil" yazıyordu), adım değişince sayfa başına kayma.
- **Mobil uygulamalar** baştan tasarlandı: Inter yazı tipi, `react-native-reanimated`, `react-native-svg`, `expo-linear-gradient`, `expo-haptics`. Harita sağlayıcısı anahtarı gelene kadar stilize SVG harita (`components/MapCanvas.tsx`) ve harita + alt panel düzeni (`MapSheet.tsx`). Müşteri: fotoğraflı giriş ve 6 kutulu SMS kodu, "Nereye?" ana sayfası, rota kutusu, araç seçimi, canlı takip ekranı, yaklaşan/geçmiş listesi, hesap ekranı. Sürücü: GO düğmesi, teklif kartı ve geri sayım halkası, yolculuk akışı, tam ekran karşılama tabelası, haftalık kazanç grafiği, belge tamamlama halkası.
- **EAS**: `mobile/eas.json` derleme profilleri eklendi. **Hesap kurulum rehberi**: `docs/hesap_kurulumu.md`.
- **Test**: web rezervasyon + ödeme (Chrome), mobil müşteri planlı ve anlık rezervasyon + ödeme, sürücü teklif kabulü, yolda/vardı/başladı/bitti, canlı konum (WebSocket), hakediş kaydı. Backend testleri: 78 geçti.

## 2026-10-31

- **Kararlar** K-29 ... K-34 eklendi (`kararlar.md`); K-08, K-09, K-18, K-26, K-04 güncellendi.
- **Gidiş-dönüş indirimi %5** (K-30): `backend/app/seed.py` indirim kaydını ekler; geliştirme veritabanına işlendi.
- **Yuvarlama** (K-32): `try_rounding_step` varsayılanı 10'dan 5'e (`currency.py`, `system_settings.py`).
- **Kur otomatik** (K-33): yeni `backend/app/providers/fx.py` (TCMB `today.xml`), `jobs.refresh_exchange_rate`, `worker.py` saatlik çağırır. Test: `test_tcmb_eur_try_parse`.
- **Uçuş verisi** (K-31): `dispatch._on_leg_finished` `purge_at`'i yolculuk tamamlanınca şimdiye ayarlar; test güncellendi.
- **Dokümantasyon**: `proje_rehberi.md`, `degisiklik_gunlugu.md`, kök `CLAUDE.md` eklendi; `mvp_plani.md`, `yasal_ve_guvenlik.md`, `veritabani.md`, `fiyatlandirma.md`, `acik_konular.md`, `test_senaryolari.md` güncellendi.
- **Bekleyen geliştirme**: günlük araç kiralama (K-29), on dil (K-34), kuruma uçuş bildirimi.
- Backend testleri: 78 geçti.

## 2026-10-30

- Backend, web, admin ve mobil uygulamalar tamamlandı, tasarım siyah-beyaz yenilendi, sedan hizmetten çıkarıldı (2026-10-29). Bkz. kök `README.md` durum tablosu.
