"""Tüm modeller burada içe aktarılır ki Alembic metadata'yı eksiksiz görsün."""

from app.models.base import Base
from app.models.booking import Booking, BookingLeg, DispatchOffer, FlightInfo, TripEvent, TripMessage, TripUpdate
from app.models.customer import Consent, Customer, DataRequest
from app.models.finance import (
    DriverLedger,
    DriverPayout,
    Invoice,
    Payment,
    PaymentWebhook,
    Refund,
)
from app.models.fleet import (
    Document,
    DocumentReview,
    Driver,
    DriverVehicleAssignment,
    Vehicle,
    VehicleType,
)
from app.models.identity import AuthSession, OtpChallenge, Role, User, user_roles
from app.models.ops import AuditLog, Notification, NotificationTemplate, SystemSetting
from app.models.pricing import (
    CancellationPolicy,
    CancellationPolicyTier,
    CommissionRule,
    ExchangeRate,
    PopularPlace,
    PricingRule,
    Region,
    RoundTripDiscount,
)

__all__ = [
    "AuditLog",
    "AuthSession",
    "Base",
    "Booking",
    "BookingLeg",
    "CancellationPolicy",
    "CancellationPolicyTier",
    "CommissionRule",
    "Consent",
    "Customer",
    "DataRequest",
    "DispatchOffer",
    "Document",
    "DocumentReview",
    "Driver",
    "DriverLedger",
    "DriverPayout",
    "DriverVehicleAssignment",
    "ExchangeRate",
    "FlightInfo",
    "Invoice",
    "Notification",
    "NotificationTemplate",
    "OtpChallenge",
    "Payment",
    "PaymentWebhook",
    "PopularPlace",
    "PricingRule",
    "Refund",
    "Region",
    "Role",
    "RoundTripDiscount",
    "SystemSetting",
    "TripEvent",
    "TripMessage",
    "TripUpdate",
    "User",
    "Vehicle",
    "VehicleType",
    "user_roles",
]
