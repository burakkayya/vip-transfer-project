from __future__ import annotations

from typing import Annotated

from fastapi import Query
from pydantic import BaseModel


class Page(BaseModel):
    limit: int
    offset: int


def page(
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page:
    return Page(limit=limit, offset=offset)
