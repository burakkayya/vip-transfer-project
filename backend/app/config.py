"""Uygulama ayarları. Ortam değişkenleri GETAWAY_ önekiyle okunur (.env.example)."""

from __future__ import annotations

from decimal import Decimal
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Yalnızca geliştirme ve test için. Üretimde bu değerlerle uygulama açılmaz.
_DEV_JWT_SECRET = "dev-only-jwt-secret-change-me-0123456789"
_DEV_FERNET_KEY = "Z2V0YXdheS1kZXYtb25seS1maWVsZC1rZXktMDAwMDA="
_DEV_BLIND_INDEX_KEY = "dev-only-blind-index-key"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="GETAWAY_", extra="ignore"
    )

    env: str = "dev"  # dev | test | prod
    database_url: str = "postgresql+psycopg://getaway:getaway@localhost:5432/getaway"
    redis_url: str = "redis://localhost:6379/0"
    # 8081/8082: mobil uygulamanın web önizlemesi (müşteri / sürücü), yalnızca geliştirme.
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:8081",
        "http://localhost:8082",
    ]

    jwt_secret: str = _DEV_JWT_SECRET
    jwt_access_minutes: int = 30
    jwt_refresh_days: int = 30
    jwt_mfa_minutes: int = 5

    # Alan düzeyi şifreleme (yasal_ve_guvenlik.md). Üretimde anahtarlar KMS'ten gelir.
    field_encryption_keys: str = _DEV_FERNET_KEY
    blind_index_key: str = _DEV_BLIND_INDEX_KEY

    otp_length: int = 6
    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5
    otp_max_per_hour: int = 5

    sms_provider: str = "console"
    netgsm_usercode: str = ""
    netgsm_password: str = ""
    netgsm_header: str = ""

    routing_provider: str = "haversine"
    google_routes_api_key: str = ""
    # Adres arama: "fake" (geliştirme örnek adresleri) veya "google" (Places API New).
    # Anahtar yalnızca backend'de durur; tarayıcıya ve uygulamaya verilmez.
    places_provider: str = "fake"
    google_maps_api_key: str = ""
    # Adres araması ücretli bir servise gider; IP başına dakikalık sınır.
    places_rate_limit_per_minute: int = 60
    # Adres jetonunun geçerliliği (adres seçiminden rezervasyona kadar).
    place_token_hours: int = 6
    # Haversine yedeğinde kuş uçuşu mesafeyi karayoluna yaklaştırmak için.
    haversine_road_factor: Decimal = Decimal("1.30")
    # Verilen koordinat seçilen bölgenin merkezine en fazla bu kadar uzak olabilir.
    region_max_radius_km: Decimal = Decimal("40")

    payment_provider: str = "fake"
    paytr_merchant_id: str = ""
    paytr_merchant_key: str = ""
    paytr_merchant_salt: str = ""
    paytr_test_mode: bool = True
    public_web_url: str = "http://localhost:3000"

    storage_dir: str = "var/storage"

    # K-15: tam iade garantisi hukuki teyit gelene kadar satışa kapalı.
    guarantee_enabled: bool = False
    guarantee_fee_eur: Decimal = Decimal("10")

    # Anlık eşleştirmede teklifin geçerlilik süresi.
    dispatch_offer_seconds: int = 60

    @model_validator(mode="after")
    def _no_dev_secrets_in_prod(self) -> "Settings":
        if self.env == "prod":
            dev_values = {
                "jwt_secret": _DEV_JWT_SECRET,
                "field_encryption_keys": _DEV_FERNET_KEY,
                "blind_index_key": _DEV_BLIND_INDEX_KEY,
            }
            leaked = [k for k, v in dev_values.items() if getattr(self, k) in (v, "")]
            if leaked:
                raise ValueError(f"üretimde geliştirme anahtarı kullanılamaz: {leaked}")
            if self.payment_provider == "fake":
                raise ValueError("üretimde sahte ödeme sağlayıcısı kullanılamaz")
            if self.places_provider == "fake":
                raise ValueError("üretimde sahte adres sağlayıcısı kullanılamaz")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
