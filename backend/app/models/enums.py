"""Durum ve tür değerleri. Değerler veritabanında saklanan kodlardır."""

from __future__ import annotations

from enum import Enum


class UserKind(str, Enum):
    STAFF = "staff"  # admin paneli kullanıcısı
    CUSTOMER = "customer"
    DRIVER = "driver"


class UserStatus(str, Enum):
    ACTIVE = "aktif"
    DISABLED = "pasif"


class RoleCode(str, Enum):
    ADMIN = "admin"
    OPERATIONS = "operasyon"
    ACCOUNTING = "muhasebe"
    SUPPORT = "destek"


class ConsentType(str, Enum):
    KVKK = "kvkk"
    DISCLOSURE = "aydinlatma"
    MARKETING = "pazarlama"
    DISTANCE_SALES = "mesafeli_satis"


class DataRequestType(str, Enum):
    ACCESS = "erisim"
    DELETE = "silme"
    CORRECTION = "duzeltme"


class DataRequestStatus(str, Enum):
    OPEN = "acik"
    IN_PROGRESS = "isleniyor"
    COMPLETED = "tamamlandi"
    REJECTED = "reddedildi"


class DriverStatus(str, Enum):
    APPLIED = "basvuru"
    APPROVED = "onayli"
    SUSPENDED = "askida"
    PASSIVE = "pasif"


class VehicleStatus(str, Enum):
    PENDING = "beklemede"
    ACTIVE = "aktif"
    PASSIVE = "pasif"


class DocumentOwner(str, Enum):
    DRIVER = "driver"
    VEHICLE = "vehicle"


class DocumentStatus(str, Enum):
    PENDING = "beklemede"
    APPROVED = "onayli"
    REJECTED = "reddedildi"
    EXPIRED = "suresi_doldu"


class DocumentType(str, Enum):
    DRIVER_LICENSE = "surucu_belgesi"
    SRC = "src_belgesi"
    TURSAB = "tursab_belgesi"
    TOURISM_PERMIT = "turizm_tasimacilik_yetki"
    CRIMINAL_RECORD = "adli_sicil"
    VEHICLE_REGISTRATION = "arac_ruhsati"
    VEHICLE_INSURANCE = "arac_sigortasi"
    VEHICLE_INSPECTION = "arac_muayene"
    COMMERCIAL_PLATE = "ticari_plaka_yetki"


class ReviewDecision(str, Enum):
    APPROVED = "onayli"
    REJECTED = "reddedildi"


class RegionType(str, Enum):
    DISTRICT = "ilce"
    AIRPORT = "havalimani"


class DiscountType(str, Enum):
    PERCENT = "yuzde"
    FIXED = "sabit"


class CommissionScope(str, Enum):
    GENERAL = "genel"
    REGION = "bolge"
    VEHICLE_TYPE = "arac_tipi"


class BookingType(str, Enum):
    INSTANT = "anlik"
    SCHEDULED = "planli"


class BookingStatus(str, Enum):
    PENDING_PAYMENT = "odeme_bekliyor"
    CONFIRMED = "onaylandi"
    ASSIGNED = "atandi"
    IN_PROGRESS = "yolculukta"
    COMPLETED = "tamamlandi"
    CANCELLED = "iptal"
    PAYMENT_FAILED = "odeme_basarisiz"


class LegStatus(str, Enum):
    PENDING = "beklemede"
    ASSIGNED = "atandi"
    EN_ROUTE = "yolda"
    ARRIVED = "vardi"
    STARTED = "basladi"
    COMPLETED = "bitti"
    CANCELLED = "iptal"


class FlightDirection(str, Enum):
    ARRIVAL = "gelis"
    DEPARTURE = "gidis"


class OfferStatus(str, Enum):
    SENT = "gonderildi"
    ACCEPTED = "kabul"
    REJECTED = "red"
    EXPIRED = "suresi_doldu"
    WITHDRAWN = "geri_cekildi"


class TripEventType(str, Enum):
    ASSIGNED = "atandi"
    DEPARTED = "yola_cikti"
    ARRIVED = "vardi"
    STARTED = "basladi"
    FINISHED = "bitti"
    NO_SHOW = "gelmedi"  # K-63: ücretsiz bekleme sonunda yolcu gelmedi


class Currency(str, Enum):
    EUR = "EUR"
    TRY = "TRY"


class PaymentProviderCode(str, Enum):
    PAYTR = "paytr"
    IYZICO = "iyzico"
    FAKE = "fake"
    # Admin'in elle kaydettiği tahsilat (havale/EFT, ofiste nakit, fiziki POS); sağlayıcı çağrılmaz (K-54).
    MANUAL = "elle"


class BookingSource(str, Enum):
    CUSTOMER = "musteri"  # web veya mobil uygulamadan müşterinin kendisi
    ADMIN = "admin"  # WhatsApp, telefon vb. kanaldan admin girişi (K-54)


class BookingChannel(str, Enum):
    WHATSAPP = "whatsapp"
    PHONE = "telefon"
    EMAIL = "eposta"
    WALK_IN = "yuz_yuze"
    OTHER = "diger"


class ManualPaymentMethod(str, Enum):
    BANK_TRANSFER = "havale"
    CASH = "nakit"
    POS = "pos"


class PaymentStatus(str, Enum):
    PENDING = "beklemede"
    PAID = "odendi"
    FAILED = "basarisiz"
    REFUNDED = "iade_edildi"
    PARTIALLY_REFUNDED = "kismi_iade"


class RefundStatus(str, Enum):
    PENDING = "beklemede"
    COMPLETED = "tamamlandi"
    FAILED = "basarisiz"


class LedgerStatus(str, Enum):
    PENDING = "beklemede"
    PAID = "odendi"
    CANCELLED = "iptal"


class PayoutStatus(str, Enum):
    PENDING = "beklemede"
    PAID = "odendi"
    FAILED = "basarisiz"


class InvoiceStatus(str, Enum):
    PENDING = "beklemede"
    ISSUED = "kesildi"
    FAILED = "basarisiz"
    CANCELLED = "iptal"


class NotificationChannel(str, Enum):
    SMS = "sms"
    EMAIL = "email"
    PUSH = "push"


class NotificationStatus(str, Enum):
    QUEUED = "kuyrukta"
    SENT = "gonderildi"
    FAILED = "basarisiz"


class OtpPurpose(str, Enum):
    CUSTOMER_LOGIN = "musteri_giris"
    DRIVER_LOGIN = "surucu_giris"
