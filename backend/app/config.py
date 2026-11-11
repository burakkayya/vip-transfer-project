"""Uygulama ayarları. Ortam değişkenleri GETAWAY_ önekiyle okunur (.env.example)."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import Literal
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

    # Mobil bildirim: "console" (geliştirme) veya "fcm" (Firebase Cloud Messaging HTTP v1).
    # Servis hesabı JSON'u repo dışında durur; yalnızca dosya yolu verilir.
    push_provider: Literal["console", "fcm"] = "console"
    fcm_credentials_file: str = ""

    # K-58 (2026-11-10 kullanıcı kararı): haritayla ilgili her şey Google; yedek yol yok.
    # Karayolu rotası ve mesafe: "google" (Routes API). "haversine" yalnızca otomatik testlerde (GETAWAY_ENV=test).
    routing_provider: str = "google"
    google_routes_api_key: str = ""
    # Adres arama: "google" (Places API New). "fake" yalnızca otomatik testlerde. Anahtar yalnızca backend'de durur.
    places_provider: str = "google"
    google_maps_api_key: str = ""
    # Adres araması ücretli bir servise gider; IP başına dakikalık sınır.
    places_rate_limit_per_minute: int = 60
    # Adres jetonunun geçerliliği (adres seçiminden rezervasyona kadar).
    place_token_hours: int = 6
    # Haversine yedeğinde kuş uçuşu mesafeyi karayoluna yaklaştırmak için.
    haversine_road_factor: Decimal = Decimal("1.30")
    # Verilen koordinat seçilen bölgenin merkezine en fazla bu kadar uzak olabilir.
    region_max_radius_km: Decimal = Decimal("40")

    # K-60: uçuş takibi. "aerodatabox" (RapidAPI anahtarı) veya "off" (takip kapalı, akış etkilenmez).
    flight_provider: Literal["aerodatabox", "off"] = "off"
    aerodatabox_api_key: str = ""
    # Havalimanından alışta uçuş, alıştan bu kadar saat önce sorgulanmaya başlar.
    flight_track_hours_before: int = 4
    # Sorgu aralığı; alışa 1 saatten az kalınca kısa aralık. Uçuş indiyse/iptalse sorgu durur.
    flight_poll_minutes: int = 45
    flight_poll_near_minutes: int = 15
    # Ücretli API için günlük üst sınır (ücretsiz plan ayda ~200 sorgu).
    flight_daily_call_limit: int = 60
    # Uçuş başına en fazla sorgu; art arda bu kadar "bulunamadı" gelirse sorgu durur (yanlış numara).
    flight_max_checks: int = 14
    flight_max_misses: int = 3
    # Tahmini iniş bu kadar dakika değişince sürücüye bildirim gider.
    flight_notify_shift_minutes: int = 15

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

    # K-49: sürücü yolculuğu yalnızca varışa bu mesafedeyken bitirebilir. Varış yalnızca ilçe olarak
    # biliniyorsa (adres koordinatı yok) ilçe merkezine daha geniş yarıçap uygulanır.
    trip_finish_radius_m: int = 500
    trip_finish_region_radius_m: int = 3000
    # Sürücü havuzunda ve teklifte alış/varış noktası bu kadar metre kırpılarak gösterilir (adres gizliliği).
    job_preview_trim_m: int = 400

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
            if self.push_provider == "console":
                raise ValueError("üretimde push sağlayıcısı fcm olmalı")
        # Sahte adres ve kuş uçuşu rota yalnızca otomatik testlerde; geliştirme ve canlıda Google zorunlu.
        if self.env != "test":
            if self.places_provider != "google" or self.routing_provider != "google":
                raise ValueError("adres ve rota sağlayıcısı Google olmalı (GETAWAY_PLACES_PROVIDER, GETAWAY_ROUTING_PROVIDER)")
            if not self.google_maps_api_key:
                raise ValueError("GETAWAY_GOOGLE_MAPS_API_KEY tanımlı değil (Places ve Routes API)")
        if self.push_provider == "fcm" and not Path(self.fcm_credentials_file or "").is_file():
            raise ValueError("push_provider=fcm için GETAWAY_FCM_CREDENTIALS_FILE geçerli bir dosya olmalı")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
