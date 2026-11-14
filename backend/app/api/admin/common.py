from __future__ import annotations

from typing import Annotated

from fastapi import Query
from pydantic import BaseModel

# MON-13: derin offset veritabanında tüm önceki satırları taratır; daha derin gezinme filtreyle yapılır.
MAX_OFFSET = 10_000
# MON-13: sayfalamasız admin listeleri (katalog, personel, çevrimiçi sürücü, eşleştirme bekleyen) için üst sınır.
# Uçlar `common.MAX_LIST`'i çağrı anında okur (testte düşürülebilir).
MAX_LIST = 1000


class Page(BaseModel):
    limit: int
    offset: int


def page(
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=MAX_OFFSET)] = 0,
) -> Page:
    return Page(limit=limit, offset=offset)
