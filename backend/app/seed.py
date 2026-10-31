"""Başlangıç verisi. Tekrar çalıştırılabilir; var olan kayıtlara dokunmaz.

Bölge koordinatları ilçe merkezlerinin yaklaşık değerleridir; admin panelinden
düzeltilebilir. Araç tipleri ve çarpanları açık konudur (acik_konular.md),
buradaki değerler yer tutucudur.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal as D

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    CancellationPolicy,
    CancellationPolicyTier,
    CommissionRule,
    NotificationTemplate,
    PricingRule,
    Region,
    RoundTripDiscount,
    VehicleType,
)
from app.models.enums import CommissionScope, DiscountType, NotificationChannel, RegionType
from app.services.auth import ensure_roles

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)

# (kod, il, ad, tür, IATA, enlem, boylam)
REGIONS: list[tuple] = [
    ("ayt", "antalya", "Antalya Havalimanı", RegionType.AIRPORT, "AYT", "36.898700", "30.800500"),
    ("gzp", "antalya", "Gazipaşa-Alanya Havalimanı", RegionType.AIRPORT, "GZP", "36.299200", "32.300600"),
    ("dlm", "mugla", "Dalaman Havalimanı", RegionType.AIRPORT, "DLM", "36.713100", "28.792500"),
    ("bjv", "mugla", "Milas-Bodrum Havalimanı", RegionType.AIRPORT, "BJV", "37.250600", "27.664300"),
    # Antalya ilçeleri
    ("akseki", "antalya", "Akseki", RegionType.DISTRICT, None, "37.048300", "31.790000"),
    ("aksu", "antalya", "Aksu", RegionType.DISTRICT, None, "36.950000", "30.840000"),
    ("alanya", "antalya", "Alanya", RegionType.DISTRICT, None, "36.544400", "31.995400"),
    ("demre", "antalya", "Demre", RegionType.DISTRICT, None, "36.244400", "29.983900"),
    ("dosemealti", "antalya", "Döşemealtı", RegionType.DISTRICT, None, "37.023600", "30.601100"),
    ("elmali", "antalya", "Elmalı", RegionType.DISTRICT, None, "36.737200", "29.916400"),
    ("finike", "antalya", "Finike", RegionType.DISTRICT, None, "36.295800", "30.145600"),
    ("gazipasa", "antalya", "Gazipaşa", RegionType.DISTRICT, None, "36.270000", "32.317500"),
    ("gundogmus", "antalya", "Gündoğmuş", RegionType.DISTRICT, None, "36.813600", "31.998900"),
    ("ibradi", "antalya", "İbradı", RegionType.DISTRICT, None, "37.095800", "31.598600"),
    ("kas", "antalya", "Kaş", RegionType.DISTRICT, None, "36.201700", "29.637800"),
    ("kemer", "antalya", "Kemer", RegionType.DISTRICT, None, "36.600000", "30.560000"),
    ("kepez", "antalya", "Kepez", RegionType.DISTRICT, None, "36.950000", "30.710000"),
    ("konyaalti", "antalya", "Konyaaltı", RegionType.DISTRICT, None, "36.870000", "30.630000"),
    ("korkuteli", "antalya", "Korkuteli", RegionType.DISTRICT, None, "37.065600", "30.195300"),
    ("kumluca", "antalya", "Kumluca", RegionType.DISTRICT, None, "36.370000", "30.290000"),
    ("manavgat", "antalya", "Manavgat", RegionType.DISTRICT, None, "36.786700", "31.443300"),
    ("muratpasa", "antalya", "Muratpaşa", RegionType.DISTRICT, None, "36.885000", "30.710000"),
    ("serik", "antalya", "Serik", RegionType.DISTRICT, None, "36.917200", "31.100300"),
    # Muğla ilçeleri
    ("bodrum", "mugla", "Bodrum", RegionType.DISTRICT, None, "37.034400", "27.430500"),
    ("dalaman", "mugla", "Dalaman", RegionType.DISTRICT, None, "36.765600", "28.802800"),
    ("datca", "mugla", "Datça", RegionType.DISTRICT, None, "36.727500", "27.686900"),
    ("fethiye", "mugla", "Fethiye", RegionType.DISTRICT, None, "36.621400", "29.116400"),
    ("kavaklidere", "mugla", "Kavaklıdere", RegionType.DISTRICT, None, "37.443000", "28.365000"),
    ("koycegiz", "mugla", "Köyceğiz", RegionType.DISTRICT, None, "36.970600", "28.685600"),
    ("marmaris", "mugla", "Marmaris", RegionType.DISTRICT, None, "36.855000", "28.274200"),
    ("mentese", "mugla", "Menteşe", RegionType.DISTRICT, None, "37.215300", "28.363600"),
    ("milas", "mugla", "Milas", RegionType.DISTRICT, None, "37.316400", "27.783900"),
    ("ortaca", "mugla", "Ortaca", RegionType.DISTRICT, None, "36.838900", "28.764700"),
    ("seydikemer", "mugla", "Seydikemer", RegionType.DISTRICT, None, "36.640000", "29.350000"),
    ("ula", "mugla", "Ula", RegionType.DISTRICT, None, "37.103900", "28.416100"),
    ("yatagan", "mugla", "Yatağan", RegionType.DISTRICT, None, "37.340000", "28.140000"),
]

# Yer tutucu: (kod, ad, yolcu, bagaj, çarpan)
VEHICLE_TYPES = [
    ("minivan", "Minivan", 6, 6, D("1.30")),
    ("vip_van", "VIP Van", 6, 6, D("1.60")),
    ("minibus", "Minibüs", 14, 14, D("2.00")),
    # K-35: siyah, VIP donanımlı Sprinter. Çarpan yer tutucu, admin panelinden değiştirilir.
    ("vip_minibus", "VIP Minibüs", 14, 14, D("2.40")),
]
# Hizmetten kaldırılan araç tipleri: eski rezervasyonlar bağlı olduğu için silinmez, pasife alınır.
RETIRED_VEHICLE_TYPES = ["sedan"]

TEMPLATES = [
    ("booking_confirmed", "tr", NotificationChannel.SMS,
     "Rezervasyonunuz onaylandi. Kod: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com"),
    ("booking_confirmed", "en", NotificationChannel.SMS,
     "Your booking is confirmed. Code: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com"),
    ("booking_confirmed", "de", NotificationChannel.SMS,
     "Ihre Buchung ist bestaetigt. Code: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com"),
    ("booking_confirmed", "ru", NotificationChannel.SMS,
     "Vashe bronirovanie podtverzhdeno. Kod: {booking_code}, {pickup_at} {pickup} > {dropoff}. getawaytransfers.com"),
    ("dispatch_offer", "tr", NotificationChannel.PUSH, "Yeni iş: {pickup} > {dropoff}"),
]


def run(db: Session) -> None:
    ensure_roles(db)

    existing_regions = set(db.scalars(select(Region.code)))
    for code, province, name, rtype, iata, lat, lng in REGIONS:
        if code not in existing_regions:
            db.add(Region(code=code, province=province, name=name, type=rtype, iata_code=iata,
                          latitude=D(lat), longitude=D(lng)))

    types = {vt.code: vt for vt in db.scalars(select(VehicleType))}
    for code, name, cap, lug, mult in VEHICLE_TYPES:
        if code not in types:
            vt = VehicleType(code=code, name=name, capacity=cap, luggage_capacity=lug, price_multiplier=mult)
            db.add(vt)
            types[code] = vt
    for code in RETIRED_VEHICLE_TYPES:
        if code in types:
            types[code].is_active = False
    db.flush()

    # K-03, K-04: 1,10 €/km, minimum 30 €, 5'in katına yuvarlama
    ruled = set(db.scalars(select(PricingRule.vehicle_type_id)))
    for vt in types.values():
        if vt.is_active and vt.id not in ruled:
            db.add(PricingRule(vehicle_type_id=vt.id, base_price_per_km=D("1.10"), minimum_price=D("30"),
                               rounding_step=D("5"), valid_from=EPOCH))

    # K-14
    if db.scalar(select(CancellationPolicy.id).limit(1)) is None:
        db.add(CancellationPolicy(name="Standart (48/24 saat)", valid_from=EPOCH, tiers=[
            CancellationPolicyTier(hours_before_pickup=48, refund_percent=100),
            CancellationPolicyTier(hours_before_pickup=24, refund_percent=50),
            CancellationPolicyTier(hours_before_pickup=0, refund_percent=0),
        ]))

    # K-02: genel %25
    if db.scalar(select(CommissionRule.id).where(CommissionRule.scope == CommissionScope.GENERAL).limit(1)) is None:
        db.add(CommissionRule(scope=CommissionScope.GENERAL, rate=D("0.25"), valid_from=EPOCH))

    # K-30: gidiş-dönüş indirimi %5
    if db.scalar(select(RoundTripDiscount.id).limit(1)) is None:
        db.add(RoundTripDiscount(type=DiscountType.PERCENT, value=D("5"), valid_from=EPOCH))

    have = set(db.execute(select(NotificationTemplate.code, NotificationTemplate.locale,
                                 NotificationTemplate.channel)).all())
    for code, locale, channel, body in TEMPLATES:
        if (code, locale, channel) not in have:
            db.add(NotificationTemplate(code=code, locale=locale, channel=channel, body=body))
    db.flush()
