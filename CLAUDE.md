# Çalışma kuralları

- Yanıtlar Türkçe.
- Her değişiklikten sonra ilgili `.md` dosyaları güncellenir: `docs/kararlar.md` (karar varsa), `docs/acik_konular.md`, `docs/proje_rehberi.md` (durum matrisi), `docs/test_senaryolari.md` (kullanıcıya görünen akış değiştiyse), kök `README.md` (durum tablosu) ve her zaman `docs/degisiklik_gunlugu.md` (tarihli satır).
- Proje bilgisi, kararlar ve durum `docs/` altında eksiksiz tutulur. Başlangıç noktası: `docs/proje_rehberi.md`.
- Sedan araç tipi geri eklenmez. Araç tipleri: minivan, vip_van, minibus, vip_minibus (K-35).
- Proje ayağa kaldırıldığında (servisler açıldıktan sonra) müşteri, onaylı sürücü ve admin giriş bilgileri adresleriyle birlikte sohbette özet tablo olarak verilir. Kaynak: `docs/test_senaryolari.md` "Test hesapları". Parolalar yalnızca sohbette verilir, repoya yazılmaz.
- Parolalar, anahtarlar ve gizli bilgiler repoya yazılmaz.

# Ajan kullanımı (K-53)

Ajanlar her işte çalıştırılmaz; yalnızca işin riskine göre çağrılır. Her işin sonunda değişiklik aşağıdaki sınıflardan birine konur. Tanımlar `.claude/agents/` altındadır.

| Sınıf | Örnek | Yapılacak | Ajan |
|---|---|---|---|
| Küçük | Metin, renk, tek satırlık düzeltme, yalnızca doküman | Kendi kontrolün, ilgili test varsa koşturulur | Yok |
| Orta | Yeni ekran, mevcut bir akışın değişmesi | İlgili testler ve kendi kontrolün | Gerekirse tek ajan: ekran değiştiyse `ui-auditor`, akış değiştiyse `qa-tester` |
| Büyük / riskli | Ödeme, giriş ve kimlik, konum, kişisel veri, migration, yeni altyapı (ör. FCM), PR öncesi büyük iş | İlgili testler, sonra bağımsız inceleme | `code-reviewer` (güvenlik dahil); kullanıcıya görünen akış da değiştiyse `qa-tester` |

- Kullanıcı "incelet" derse sınıfa bakılmaksızın çağrılır; "ajan çalıştırma" derse çağrılmaz.
- Ajanlar kod değiştirmez, rapor verir; düzeltmeyi ana oturum yapar. Ajana yalnızca değişen kapsam verilir (dosyalar, commit aralığı, test edilecek akış).
- Doküman güncelleme denetimi ajansız, ana oturumda yapılır.
- Ajan çağrıldıysa sonucu kullanıcıya kısaca bildirilir (bulgu sayısı, düzeltilenler).
