"""EUR/TRY kur kaynağı: TCMB günlük kurları (K-33, kur elle girilmez).

TCMB `today.xml` yalnızca iş günleri yayımlanır; hafta sonu/tatilde son yayın kalır.
Satış için `ForexSelling` kullanılır.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from decimal import Decimal, InvalidOperation

import httpx

from app.errors import ServiceUnavailable

TCMB_URL = "https://www.tcmb.gov.tr/kurlar/today.xml"


def parse_tcmb_eur_try(xml_text: str) -> Decimal:
    try:
        root = ET.fromstring(xml_text)
        node = root.find("./Currency[@CurrencyCode='EUR']/ForexSelling")
        rate = Decimal((node.text or "").strip()) if node is not None else Decimal(0)
    except (ET.ParseError, InvalidOperation) as exc:
        raise ServiceUnavailable("TCMB kur verisi okunamadı") from exc
    if rate <= 0:
        raise ServiceUnavailable("TCMB kur verisinde EUR bulunamadı")
    return rate


def fetch_eur_try(url: str = TCMB_URL) -> Decimal:
    try:
        resp = httpx.get(url, timeout=10)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise ServiceUnavailable("TCMB kuruna ulaşılamadı") from exc
    return parse_tcmb_eur_try(resp.text)
