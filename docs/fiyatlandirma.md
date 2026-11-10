# Fiyatlandırma

## Temel formül

```
ham_fiyat = mesafe_km x 1,10 x araç_tipi_çarpanı
ham_fiyat = max(ham_fiyat, 30)          # minimum 30 €
indirimli = ham_fiyat - gidiş_dönüş_indirimi (varsa)
fiyat = 5'in katına yukarı yuvarlama(indirimli)
```

Örnek: 167,30 → 170 €. Minimum fiyat 30 € olduğu için yuvarlama ile çakışmaz.

## Parametreler

| Parametre | Değer | Değiştirilebilir |
|---|---|---|
| Km birim fiyatı | 1,10 € | Evet (`pricing_rules`) |
| Minimum ücret | 30 € | Evet |
| Yuvarlama adımı | 5 | Evet |
| Gidiş-dönüş indirimi | %5 (K-30), yüzde veya sabit tutar olarak değiştirilebilir | Evet (`round_trip_discounts`) |
| Araç tipi çarpanı | Araç tipine göre | Evet (`vehicle_types`) |

## Adres ve ilçe (K-28, K-58)

- Müşteri alış ve bırakış adresini serbestçe arar: otel, cadde ve kapı numarası, mahalle, marina, havalimanı (yalnızca ilçe değil). Sağlayıcı yalnızca Google Places API (New); koordinat imzalı adres jetonundan gelir, istemcinin gönderdiği ham koordinat yok sayılır.
- Backend, seçilen adresin ilçesini (`administrative_area_level_2`) bulur ve hizmet bölgesine eşler. Havalimanı olarak işaretli yerler 8 km içindeki havalimanı bölgesine eşlenir. İlçe adı gelmezse en yakın ilçe merkezi seçilir.
- Antalya ve Muğla dışındaki adresler reddedilir (`region_not_served`).
- Backend çözdüğü bölge ve koordinatı imzalı bir **adres jetonu** ile döner. Fiyat teklifi bu jetonla istenir, böylece istemci ilçeyi değiştirip fiyatı düşüremez.
- Havalimanı veya ilçe doğrudan da seçilebilir (adres araması olmadan, bölge merkezi kullanılır).

## Mesafe (K-58)

- Fiyat mesafesi, müşterinin seçtiği **gerçek alış ve bırakış noktaları** arasındaki karayolu mesafesidir (2026-11-10'dan önce farklı ilçeler arasında ilçe merkezleri kullanılıyordu). Aynı ilçedeki iki farklı otel farklı fiyat alabilir. Yalnızca ilçe veya havalimanı seçilirse o bölgenin merkezi kullanılır. 300 m'den yakın noktalar aynı yer sayılır.
- Fiyat yine 5'in katına yukarı yuvarlanır (K-32); km değeri ekranda bir ondalıkla gösterilir.
- Karayolu mesafesi ve rota çizgisi yalnızca Google Routes API'den gelir; yedek yoktur (Google'a ulaşılamazsa teklif "mesafe hesaplanamadı" hatası verir). Aynı iki nokta için sonuç 10 dakika süreç belleğinde tutulur: rota adımındaki önizleme (`POST /routes/preview`, girişsiz, IP başına dakikalık sınır) ve araç tiplerinin teklifleri Routes API'ye tek çağrıyla gider.
- Google'a yalnızca koordinat gönderilir. Adres aramasında kullanıcının yazdığı metin gider, kimlik bilgisi gitmez.
- Gerçek adres ve koordinat sürücünün navigasyonu için rezervasyonda saklanır.
- Hesaplanan mesafe ve fiyat rezervasyonla birlikte kaydedilir (`quoted_price`, `distance_km`).

## Para birimi

| Müşteri ülkesi | Gösterilen ve tahsil edilen para birimi |
|---|---|
| Türkiye | TRY |
| Avrupa ülkeleri | EUR |
| Diğer ülkeler | EUR |

Ödeme sağlayıcısı müşteriye gösterilen para biriminde tahsilat yapar. Şirket hesabına geçiş ayrıntısı için bkz. odeme.md.

## İptal ve iade

| Kalkışa kalan süre | İade oranı |
|---|---|
| 48 saat ve üzeri | %100 |
| 24 ile 48 saat arası | %50 |
| 24 saatten az | %0 |

- Politika rezervasyon anında dondurulur. Sonradan yapılan değişiklikler mevcut rezervasyonları etkilemez.
- İade tutarı `bookings` üzerindeki politikaya göre hesaplanır.
- İade, PayTR iade API'si ile yapılır. Her iade `refunds` tablosunda kayıt altına alınır.

## Tam iade garantisi (ürün)

- Rezervasyona isteğe bağlı ek kalem olarak eklenir. Ücret 5 € veya 10 € gibi 5'in katıdır.
- Garanti seçilirse iptal politikası devre dışı kalır ve tam iade yapılır.
- Garanti ücreti iade edilmez, iade yalnızca yolculuk fiyatı üzerinden hesaplanır.
- Hukuki yapı doğrulanmadan satışa açılmaz (bkz. yasal_ve_guvenlik.md).
- Muhasebe karşılığı (gelir mi, prim mi) muhasebeci ile netleştirilir.
