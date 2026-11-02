from app.providers.polyline import decode, encode


def test_encode_matches_google_reference():
    pts = [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
    assert encode(pts) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"


def test_roundtrip():
    pts = [(36.8987, 30.8005), (36.6018, 30.5594)]
    assert decode(encode(pts)) == pts
