"""Google Encoded Polyline Algorithm (kodlama ve çözme)."""

from __future__ import annotations


def _encode_value(value: int) -> str:
    value = ~(value << 1) if value < 0 else value << 1
    out = []
    while value >= 0x20:
        out.append(chr((0x20 | (value & 0x1F)) + 63))
        value >>= 5
    out.append(chr(value + 63))
    return "".join(out)


def encode(points: list[tuple[float, float]], precision: int = 5) -> str:
    factor = 10**precision
    prev_lat = prev_lng = 0
    parts: list[str] = []
    for lat, lng in points:
        lat_i, lng_i = round(lat * factor), round(lng * factor)
        parts.append(_encode_value(lat_i - prev_lat))
        parts.append(_encode_value(lng_i - prev_lng))
        prev_lat, prev_lng = lat_i, lng_i
    return "".join(parts)


def decode(s: str, precision: int = 5) -> list[tuple[float, float]]:
    factor = 10**precision
    points: list[tuple[float, float]] = []
    index = lat = lng = 0
    while index < len(s):
        deltas = []
        for _ in range(2):
            result = shift = 0
            while True:
                b = ord(s[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lng += deltas[1]
        points.append((lat / factor, lng / factor))
    return points
