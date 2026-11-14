"""CSV formül enjeksiyonu savunması (EXT-01, CWE-1236).

Excel, LibreOffice ve Google Sheets `=`, `+`, `-`, `@` ile (ayrıca sekme ve CR ile) başlayan hücreyi
formül olarak yorumlayabilir. Bu karakterlerle başlayan serbest metin hücrelerinin başına `'` eklenir;
tablo programı hücreyi düz metin olarak gösterir. Tüm CSV dışa aktarımları bu yardımcıyı kullanmalıdır.
"""

from __future__ import annotations

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value: object) -> str:
    text = "" if value is None else str(value)
    if text.startswith(FORMULA_PREFIXES):
        return "'" + text
    return text
