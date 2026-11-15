# İş Modeli

## Genel yapı

getawaytransfers.com, müşteriye transfer hizmeti satan bir platformdur. Sürücüler ve araçlar, belgeleri onaylanmış bağımsız iş ortaklarıdır. Müşteri fiyatı ve ödemeyi platform üzerinden yapar; sürücü payı otomatik hesaplanıp aktarılır.

Uber'den farkı: taksimetre yoktur, fiyat önceden hesaplanır ve ödeme rezervasyon anında alınır.

## Roller

| Rol | Açıklama |
|---|---|
| Müşteri | Web veya mobil üzerinden rezervasyon yapar, OTP ile üye olur |
| Sürücü | Mobil uygulama üzerinden kayıt olur, belgeleri onaylanır, iş kabul eder |
| Admin | Yönetim paneli. İlk etapta tüm yetkilere sahip kullanıcılar |

## Sürücü kuralları

- Sürücü kaydında tüm belgeler (TÜRSAB ilgili belgeler, sürücü belgesi, yetki belgesi vb.) yüklenir ve admin tarafından onaylanır.
- Belge süresi dolduğunda sürücü otomatik olarak pasif duruma geçer.
- Her sürücünün bir veya birden fazla aracı olabilir, araç da belgeleriyle onaylanır.
- Sürücü, yalnızca geçerli belgeleri olduğunda iş alabilir.

## Komisyon

- Oran `commission_rules` tablosunda tanımlıdır.
- Genel, bölge veya araç tipi bazında farklı oran tanımlanabilir.
- Oranın değişmesi mevcut rezervasyonları etkilemez, yalnızca yeni rezervasyonlara uygulanır.
- Örnek: 60 € toplam fiyat, %20 komisyon, 48 € sürücü payı (K-75).
- Bahşiş toplam fiyata eklenir; komisyon bahşiş dahil toplamdan alınır (K-75).

## Eşleştirme

- Anlık: müşteri hemen talep eder, uygun sürücülere teklif gider, ilk kabul eden atanır.
- Planlı: müşteri ileri tarihe rezervasyon yapar, admin veya otomatik kural ile sürücü atanır.
- Sürücüye yalnızca karşılama için gerekli bilgiler (ad, uçuş numarası, karşılama noktası) gösterilir.

## Bölge

- İstanbul, Ankara, İzmir, Antalya, Muğla ve Kapadokya (Nevşehir, Kayseri) illerinin tüm ilçeleri (K-75).
- Havalimanları: Antalya (AYT), Gazipaşa-Alanya (GZP), Dalaman (DLM), Milas-Bodrum (BJV), İstanbul (IST), Sabiha Gökçen (SAW), Ankara Esenboğa (ESB), İzmir Adnan Menderes (ADB), Nevşehir Kapadokya (NAV), Kayseri Erkilet (ASR).
- Şehirlerarası transfer (hizmet verilen iller arası) dahildir.

## Araç

- Araçlar günlük kiralanabilir (MVP kapsamı için bkz. mvp_plani.md).
- Araç tipine göre fiyat çarpanı uygulanır.
