"""Admin: bölgeler, fiyat kuralları, gidiş-dönüş indirimi, iptal politikaları,
komisyon, kur, bildirim şablonları, sistem ayarları (ekran 8-10, 15, 19).

Fiyat ve komisyon kuralları güncellenmez; yeni sürüm eklenir. Böylece eski
rezervasyonların hangi kuralla hesaplandığı izlenebilir (veritabani.md).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from app.api.deps import AdminOnly, ClientIp, DbSession, FinanceStaff, Now, OpsStaff
from app.errors import DomainError, NotFound
from app.models import (
    CancellationPolicy,
    CancellationPolicyTier,
    CommissionRule,
    ExchangeRate,
    NotificationTemplate,
    PricingRule,
    Region,
    RoundTripDiscount,
    VehicleType,
)
from app.models.enums import CommissionScope, DiscountType, NotificationChannel, RegionType
from app.services import audit, system_settings

router = APIRouter(tags=["admin:catalog"])


def _row(obj, *fields: str) -> dict:
    out = {}
    for f in fields:
        v = getattr(obj, f)
        out[f] = v.value if hasattr(v, "value") else (str(v) if isinstance(v, Decimal) else v)
    return out


# --- Bölgeler ----------------------------------------------------------------

_REGION_FIELDS = ("id", "code", "province", "name", "type", "iata_code", "latitude", "longitude", "is_active")


class RegionIn(BaseModel):
    code: str = Field(pattern=r"^[a-z0-9_]{2,50}$")
    province: str = Field(pattern=r"^(antalya|mugla)$")
    name: str = Field(max_length=100)
    type: RegionType
    iata_code: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    latitude: Decimal = Field(ge=35, le=39)
    longitude: Decimal = Field(ge=26, le=34)
    is_active: bool = True


@router.get("/regions")
def list_regions(staff: OpsStaff, db: DbSession):
    return [_row(r, *_REGION_FIELDS) for r in db.scalars(select(Region).order_by(Region.province, Region.name))]


@router.post("/regions", status_code=201)
def create_region(body: RegionIn, staff: OpsStaff, db: DbSession, ip: ClientIp):
    r = Region(**body.model_dump())
    db.add(r)
    db.flush()
    audit.record(db, actor_id=staff.id, action="region.create", entity_type="region", entity_id=r.id,
                 changes=body.model_dump(), ip=ip)
    db.commit()
    return _row(r, *_REGION_FIELDS)


@router.put("/regions/{region_id}")
def update_region(region_id: int, body: RegionIn, staff: OpsStaff, db: DbSession, ip: ClientIp):
    r = db.get(Region, region_id)
    if r is None:
        raise NotFound("bölge bulunamadı")
    old = _row(r, *_REGION_FIELDS)
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    audit.record(db, actor_id=staff.id, action="region.update", entity_type="region", entity_id=r.id,
                 changes={"old": old, "new": body.model_dump()}, ip=ip)
    db.commit()
    db.refresh(r)
    return _row(r, *_REGION_FIELDS)


# --- Fiyat kuralları ---------------------------------------------------------

_PRICING_FIELDS = ("id", "vehicle_type_id", "base_price_per_km", "minimum_price", "rounding_step",
                   "valid_from", "valid_to", "is_active", "created_at")


class PricingRuleIn(BaseModel):
    vehicle_type_id: int
    base_price_per_km: Decimal = Field(gt=0, le=100)
    minimum_price: Decimal = Field(ge=0, le=10000)
    rounding_step: Decimal = Field(gt=0, le=100)
    valid_from: datetime | None = None


@router.get("/pricing-rules")
def list_pricing_rules(staff: OpsStaff, db: DbSession):
    rows = db.scalars(select(PricingRule).order_by(PricingRule.vehicle_type_id, PricingRule.valid_from.desc()))
    return [_row(r, *_PRICING_FIELDS) for r in rows]


@router.post("/pricing-rules", status_code=201)
def create_pricing_rule(body: PricingRuleIn, staff: AdminOnly, db: DbSession, ip: ClientIp, now: Now):
    if db.get(VehicleType, body.vehicle_type_id) is None:
        raise NotFound("araç tipi bulunamadı")
    r = PricingRule(**{**body.model_dump(), "valid_from": body.valid_from or now})
    db.add(r)
    db.flush()
    audit.record(db, actor_id=staff.id, action="pricing_rule.create", entity_type="pricing_rule",
                 entity_id=r.id, changes=body.model_dump(), ip=ip)
    db.commit()
    return _row(r, *_PRICING_FIELDS)


def _deactivate(db, model, obj_id: int, staff, ip: str, now: datetime, entity: str):
    obj = db.get(model, obj_id)
    if obj is None:
        raise NotFound("kayıt bulunamadı")
    obj.is_active = False
    if hasattr(obj, "valid_to") and obj.valid_to is None:
        obj.valid_to = now
    audit.record(db, actor_id=staff.id, action=f"{entity}.deactivate", entity_type=entity, entity_id=obj_id, ip=ip)
    db.commit()
    return {"ok": True}


@router.post("/pricing-rules/{rule_id}/deactivate")
def deactivate_pricing_rule(rule_id: int, staff: AdminOnly, db: DbSession, ip: ClientIp, now: Now):
    return _deactivate(db, PricingRule, rule_id, staff, ip, now, "pricing_rule")


# --- Gidiş-dönüş indirimi ----------------------------------------------------

_DISCOUNT_FIELDS = ("id", "type", "value", "valid_from", "valid_to", "is_active", "created_at")


class DiscountIn(BaseModel):
    type: DiscountType
    value: Decimal = Field(ge=0)
    valid_from: datetime | None = None

    @model_validator(mode="after")
    def _percent_range(self):
        if self.type is DiscountType.PERCENT and self.value > 100:
            raise ValueError("yüzde indirimi 100'ü aşamaz")
        return self


@router.get("/round-trip-discounts")
def list_discounts(staff: OpsStaff, db: DbSession):
    rows = db.scalars(select(RoundTripDiscount).order_by(RoundTripDiscount.valid_from.desc()))
    return [_row(r, *_DISCOUNT_FIELDS) for r in rows]


@router.post("/round-trip-discounts", status_code=201)
def create_discount(body: DiscountIn, staff: AdminOnly, db: DbSession, ip: ClientIp, now: Now):
    r = RoundTripDiscount(type=body.type, value=body.value, valid_from=body.valid_from or now)
    db.add(r)
    db.flush()
    audit.record(db, actor_id=staff.id, action="round_trip_discount.create", entity_type="round_trip_discount",
                 entity_id=r.id, changes=body.model_dump(), ip=ip)
    db.commit()
    return _row(r, *_DISCOUNT_FIELDS)


@router.post("/round-trip-discounts/{discount_id}/deactivate")
def deactivate_discount(discount_id: int, staff: AdminOnly, db: DbSession, ip: ClientIp, now: Now):
    return _deactivate(db, RoundTripDiscount, discount_id, staff, ip, now, "round_trip_discount")


# --- İptal politikaları ------------------------------------------------------


class TierIn(BaseModel):
    hours_before_pickup: int = Field(ge=0, le=24 * 365)
    refund_percent: int = Field(ge=0, le=100)


class PolicyIn(BaseModel):
    name: str = Field(max_length=100)
    tiers: list[TierIn] = Field(min_length=1, max_length=10)
    valid_from: datetime | None = None

    @model_validator(mode="after")
    def _has_zero_tier(self):
        hours = [t.hours_before_pickup for t in self.tiers]
        if len(hours) != len(set(hours)):
            raise ValueError("aynı saat eşiği iki kez tanımlanamaz")
        if 0 not in hours:
            raise ValueError("0 saat eşiği tanımlanmalı (son kademe)")
        return self


def _policy_row(p: CancellationPolicy) -> dict:
    return {**_row(p, "id", "name", "valid_from", "is_active", "created_at"),
            "tiers": [{"hours_before_pickup": t.hours_before_pickup, "refund_percent": t.refund_percent}
                      for t in p.tiers]}


@router.get("/cancellation-policies")
def list_policies(staff: OpsStaff, db: DbSession):
    return [_policy_row(p) for p in db.scalars(select(CancellationPolicy).order_by(CancellationPolicy.valid_from.desc()))]


@router.post("/cancellation-policies", status_code=201)
def create_policy(body: PolicyIn, staff: AdminOnly, db: DbSession, ip: ClientIp, now: Now):
    """Yeni politika yalnızca yeni rezervasyonlara uygulanır; mevcutlar dondurulmuş politikayı kullanır."""
    p = CancellationPolicy(name=body.name, valid_from=body.valid_from or now,
                           tiers=[CancellationPolicyTier(**t.model_dump()) for t in body.tiers])
    db.add(p)
    db.flush()
    audit.record(db, actor_id=staff.id, action="cancellation_policy.create", entity_type="cancellation_policy",
                 entity_id=p.id, changes=body.model_dump(), ip=ip)
    db.commit()
    return _policy_row(p)


# --- Komisyon ----------------------------------------------------------------

_COMMISSION_FIELDS = ("id", "scope", "scope_ref_id", "rate", "valid_from", "valid_to", "is_active", "created_at")


class CommissionIn(BaseModel):
    scope: CommissionScope
    scope_ref_id: int | None = None
    rate: Decimal = Field(ge=0, lt=1)
    valid_from: datetime | None = None

    @model_validator(mode="after")
    def _ref(self):
        if (self.scope is CommissionScope.GENERAL) != (self.scope_ref_id is None):
            raise ValueError("genel kapsamda referans olmaz, diğer kapsamlarda zorunludur")
        return self


@router.get("/commission-rules")
def list_commission(staff: FinanceStaff, db: DbSession):
    rows = db.scalars(select(CommissionRule).order_by(CommissionRule.scope, CommissionRule.valid_from.desc()))
    return [_row(r, *_COMMISSION_FIELDS) for r in rows]


@router.post("/commission-rules", status_code=201)
def create_commission(body: CommissionIn, staff: AdminOnly, db: DbSession, ip: ClientIp, now: Now):
    if body.scope is CommissionScope.REGION and db.get(Region, body.scope_ref_id) is None:
        raise NotFound("bölge bulunamadı")
    if body.scope is CommissionScope.VEHICLE_TYPE and db.get(VehicleType, body.scope_ref_id) is None:
        raise NotFound("araç tipi bulunamadı")
    r = CommissionRule(scope=body.scope, scope_ref_id=body.scope_ref_id, rate=body.rate,
                       valid_from=body.valid_from or now)
    db.add(r)
    db.flush()
    audit.record(db, actor_id=staff.id, action="commission_rule.create", entity_type="commission_rule",
                 entity_id=r.id, changes=body.model_dump(), ip=ip)
    db.commit()
    return _row(r, *_COMMISSION_FIELDS)


@router.post("/commission-rules/{rule_id}/deactivate")
def deactivate_commission(rule_id: int, staff: AdminOnly, db: DbSession, ip: ClientIp, now: Now):
    return _deactivate(db, CommissionRule, rule_id, staff, ip, now, "commission_rule")


# --- Kur ---------------------------------------------------------------------


class ExchangeRateIn(BaseModel):
    rate: Decimal = Field(gt=0, le=1000)
    valid_from: datetime | None = None


@router.get("/exchange-rates")
def list_rates(staff: FinanceStaff, db: DbSession):
    rows = db.scalars(select(ExchangeRate).order_by(ExchangeRate.valid_from.desc()).limit(100))
    return [_row(r, "id", "base", "quote", "rate", "source", "valid_from") for r in rows]


@router.post("/exchange-rates", status_code=201)
def create_rate(body: ExchangeRateIn, staff: FinanceStaff, db: DbSession, ip: ClientIp, now: Now):
    """Açık konu: kurun otomatik (TCMB) mi manuel mi girileceği netleşmedi; şimdilik manuel."""
    r = ExchangeRate(rate=body.rate, source="manuel", valid_from=body.valid_from or now)
    db.add(r)
    db.flush()
    audit.record(db, actor_id=staff.id, action="exchange_rate.create", entity_type="exchange_rate",
                 entity_id=r.id, changes={"rate": body.rate}, ip=ip)
    db.commit()
    return _row(r, "id", "base", "quote", "rate", "source", "valid_from")


# --- Bildirim şablonları -----------------------------------------------------


class TemplateIn(BaseModel):
    code: str = Field(pattern=r"^[a-z0-9_]{2,50}$")
    locale: str = Field(pattern=r"^[a-z]{2}$")
    channel: NotificationChannel
    subject: str | None = Field(default=None, max_length=200)
    body: str = Field(min_length=1, max_length=2000)


@router.get("/notification-templates")
def list_templates(staff: OpsStaff, db: DbSession):
    rows = db.scalars(select(NotificationTemplate).order_by(NotificationTemplate.code, NotificationTemplate.locale))
    return [_row(t, "id", "code", "locale", "channel", "subject", "body") for t in rows]


@router.put("/notification-templates")
def upsert_template(body: TemplateIn, staff: OpsStaff, db: DbSession, ip: ClientIp):
    t = db.scalar(select(NotificationTemplate).where(
        NotificationTemplate.code == body.code, NotificationTemplate.locale == body.locale,
        NotificationTemplate.channel == body.channel))
    if t is None:
        t = NotificationTemplate(**body.model_dump())
        db.add(t)
    else:
        t.subject, t.body = body.subject, body.body
    db.flush()
    audit.record(db, actor_id=staff.id, action="notification_template.upsert", entity_type="notification_template",
                 entity_id=t.id, changes={"code": body.code, "locale": body.locale}, ip=ip)
    db.commit()
    return _row(t, "id", "code", "locale", "channel", "subject", "body")


# --- Sistem ayarları ---------------------------------------------------------


@router.get("/settings")
def get_settings_(staff: AdminOnly, db: DbSession):
    return system_settings.all_settings(db)


class SettingIn(BaseModel):
    value: Any


@router.put("/settings/{key}")
def put_setting(key: str, body: SettingIn, staff: AdminOnly, db: DbSession, ip: ClientIp):
    default = system_settings.DEFAULTS.get(key)
    if default is None:
        raise NotFound("bilinmeyen ayar")
    if type(body.value) is not type(default):
        raise DomainError(f"değer türü {type(default).__name__} olmalı", code="invalid_setting_type")
    system_settings.put(db, key, body.value, staff.id, ip)
    db.commit()
    return {"key": key, "value": body.value}
