# Teknoloji Yığını

Ana altyapı Türkiye'de tutulur (K-19). Yurt dışı servisler yalnızca gerekli minimum veriyle kullanılır.

| Katman | Seçim | Not |
|---|---|---|
| Web (müşteri) | Next.js, TypeScript, next-intl | 10 dil, SEO için sunucu tarafı render |
| Admin paneli | Next.js (monorepo içinde ayrı uygulama) | Rol bazlı yetki, denetim kaydı |
| Mobil (müşteri ve sürücü) | Expo (React Native), EAS Build | Tek kod tabanı, iOS ve Android |
| Backend | Python, FastAPI, Pydantic | Tek geliştirici ve Claude ile hızlı ilerleme |
| Veritabanı | PostgreSQL + PostGIS | Bölge ve mesafe sorguları |
| Migration | Alembic, SQLAlchemy | Şema sürümleme |
| Önbellek ve konum | Redis | Sürücü konumu, eşleştirme kuyruğu |
| Arka plan işleri | ARQ veya Celery | Mutabakat, hatırlatma, veri silme |
| Gerçek zamanlı | WebSocket (FastAPI) | Sürücü konumunun müşteriye iletilmesi |
| Kimlik doğrulama | Kendi altyapı: Argon2, JWT, OTP | Kullanıcı verisi dışarı çıkmaz |
| SMS ve OTP | Netgsm veya Verimor | Yerli sağlayıcı, uluslararası gönderim kontrolü gerekli |
| E-posta | Yerli SMTP veya Amazon SES (bölge kararı netleşince) | Transactional e-posta |
| Push | Firebase Cloud Messaging | Expo ile entegre |
| Harita ve mesafe | Google Routes API | Yalnızca koordinat ve rota gönderilir |
| Uçuş takibi | AeroDataBox veya FlightAware AeroAPI | Uçuş numarası ile iniş saati |
| Ödeme | PayTR (birincil), iyzico (yedek) | Bkz. odeme.md |
| Fatura | GİB onaylı e-Arşiv entegratörü (Paraşüt, Logo veya Uyumsoft) | Yasal zorunluluk |
| Belge depolama | Türkiye'deki S3 uyumlu depolama (Turkcell Bulut veya Türk Telekom Bulut) | Şifreli saklama |
| Hata izleme | Sentry, OpenTelemetry | Hata ve performans takibi |
| Altyapı | Docker, Türkiye'deki bulut sağlayıcı, MVP için tek sunucu | İhtiyaç doğunca yatay ölçekleme |
| CI/CD | GitHub, GitHub Actions | Test, build, dağıtım |
| Güvenlik | Cloudflare (WAF, DDoS, SSL), KMS ile alan düzeyi şifreleme, admin 2FA | Hassas veri koruması |
| Domain | Turhost (kayıt), Cloudflare (DNS, zamanı gelince) | Bkz. K-25 |

## Açık teknik konular

- Yurt dışı servislerde (Sentry, e-posta) bölge seçimi: Türkiye'ye yakın veya yerli alternatif tercih edilecek, yoksa KVKK ve GDPR uyumlu AB bölgesi kullanılacak.
- Harita için uzun vadede OSRM ile Türkiye verisi üzerinde self-host değerlendirilebilir.
