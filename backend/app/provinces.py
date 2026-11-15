"""Hizmet verilen iller (K-06, K-75). Kod, `Region.province` alanında saklanır."""

from __future__ import annotations

# Kod -> görünen ad. Sıra, listelerde gösterim sırasıdır.
PROVINCES: dict[str, str] = {
    "antalya": "Antalya",
    "mugla": "Muğla",
    "istanbul": "İstanbul",
    "ankara": "Ankara",
    "izmir": "İzmir",
    "nevsehir": "Nevşehir",
    "kayseri": "Kayseri",
}

PROVINCE_PATTERN = r"^(" + "|".join(PROVINCES) + r")$"
