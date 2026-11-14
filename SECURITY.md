# Güvenlik Politikası / Security Policy

Getaway Transfers (backend API, müşteri web sitesi, yönetim paneli, müşteri ve sürücü mobil uygulamaları)
için güvenlik açığı bildirme süreci. English summary below.

## Desteklenen sürümler

| Bileşen | Desteklenen |
|---|---|
| `main` dalından yayımlanan güncel sürüm (backend, web, admin) | Evet |
| Mağazadaki en güncel mobil sürüm | Evet |
| Daha eski mobil sürümler, `ci/*` ve özellik dalları | Hayır |

## Açık nasıl bildirilir

- **Herkese açık GitHub issue, PR veya tartışma AÇMAYIN.**
- Tercih edilen yol: GitHub'ın özel bildirim özelliği. Depo sayfasında
  **Security -> Report a vulnerability** (Private vulnerability reporting).
- Alternatif: `<GUVENLIK_ILETISIM_EPOSTASI>` adresine e-posta.
  <!-- Yer tutucu: depo sahibi gerçek ve izlenen bir güvenlik adresiyle değiştirmelidir. -->

Bildirimde mümkünse şunlar olsun:

1. Etkilenen bileşen ve uç nokta/ekran (ör. `POST /api/...`, sürücü uygulaması sürüm X).
2. Açığın türü ve olası etkisi.
3. Yeniden üretme adımları veya kavram kanıtı (yalnızca kendi test hesaplarınızla).
4. Bildirimde size nasıl ulaşacağımız.

Bildirime gerçek kişisel veri, ödeme kartı bilgisi, erişim anahtarı veya parola eklemeyin. Eriştiğiniz böyle
bir veri varsa yalnızca türünü belirtin.

## Süreç ve hedef süreler

| Adım | Hedef süre |
|---|---|
| Alındı bildirimi | 3 iş günü |
| İlk değerlendirme ve önem derecesi | 10 iş günü |
| Kritik/Yüksek açık için düzeltme veya hafifletme | 30 gün |
| Orta/Düşük açık için düzeltme | Sonraki planlı sürüm |

Düzeltme yayımlandıktan sonra, bildiren kişi isterse teşekkür notunda adı anılır. Koordineli açıklama
tarihi bildiren kişiyle birlikte belirlenir.

## Güvenli liman (iyi niyetli araştırma)

Aşağıdaki kurallara uyan iyi niyetli araştırmalar için hukuki yola başvurulmaz:

- Yalnızca kendi oluşturduğunuz hesaplar ve kendi verilerinizle test edin.
- Başka kullanıcıların (müşteri, sürücü) verisine erişmeyin, değiştirmeyin, silmeyin; yanlışlıkla erişirseniz
  durun ve bildirin.
- Gerçek ödeme işlemi, gerçek SMS/OTP gönderimi tetikleyecek otomasyon ve canlı yolculuk/konum akışlarını
  bozacak testler yapmayın.
- Hizmet engelleme (DoS), yük testi, sosyal mühendislik ve fiziksel saldırılar kapsam dışıdır.
- Açığı düzeltme yayımlanmadan kamuya açıklamayın.

## Kapsam dışı

- Otomatik tarayıcı çıktısı olup somut etki gösterilmeyen bulgular.
- Sürüm bilgisi gösterimi, eksik ama etkisiz başlıklar, oturum açmış kullanıcının kendine yönelik CSRF'i.
- Üçüncü taraf hizmetlerdeki (ödeme sağlayıcı, harita, SMS) açıklar: ilgili sağlayıcıya bildirin.

---

## English summary

Please **do not** open public issues for security problems. Report privately via GitHub
**Security -> Report a vulnerability**, or by e-mail to `<SECURITY_CONTACT_EMAIL>` (placeholder, to be set by the
repository owner). We aim to acknowledge within 3 business days and to fix critical/high issues within 30 days.
Test only with your own accounts, do not access other users' data, do not trigger real payments or SMS, and no
DoS. Good-faith research following these rules will not be pursued legally.
