"""Ödeme sağlayıcısı bildirimleri (sunucudan sunucuya)."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from sqlalchemy import select

from app.api.deps import DbSession, Now
from app.config import get_settings
from app.errors import NotFound
from app.models import Payment
from app.models.enums import PaymentProviderCode
from app.providers.payments import FakeProvider, get_payment_provider
from app.services import payments

router = APIRouter(prefix="/payments", tags=["payments"])


@router.post("/paytr/callback", response_class=PlainTextResponse)
async def paytr_callback(request: Request, db: DbSession, now: Now):
    """PayTR bildirim URL'si. PayTR yanıt olarak düz metin "OK" bekler; aksi halde tekrar dener."""
    form = {k: str(v) for k, v in (await request.form()).items()}
    provider = get_payment_provider()
    if provider.code is not PaymentProviderCode.PAYTR:
        raise NotFound("PayTR etkin değil")
    payments.handle_callback(db, provider, form, now)
    db.commit()
    return "OK"


# --- Geliştirme: sahte ödeme sayfası ------------------------------------------

_FAKE_STYLE = """<meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;padding:32px 20px;color:#0b0b0c;background:#fff}}
.box{{max-width:400px;margin:0 auto}} .tag{{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6b6b70}}
h1{{font-size:22px;margin:8px 0 20px;letter-spacing:-.02em}} .amount{{font-size:32px;font-weight:700;margin:4px 0 24px}}
dl{{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0 0 28px;color:#6b6b70}} dd{{margin:0;color:#0b0b0c}}
button{{display:block;width:100%;font:inherit;font-weight:600;padding:15px;border-radius:12px;border:0;cursor:pointer;margin-bottom:10px}}
.ok{{background:#0b0b0c;color:#fff}} .no{{background:#f5f5f3;color:#0b0b0c}}</style>"""

_FAKE_PAGE = """<!doctype html><html lang="tr"><meta charset="utf-8"><title>Sahte ödeme</title>""" + _FAKE_STYLE + """
<body><div class="box"><div class="tag">Geliştirme · sahte ödeme</div><h1>Kart ödemesi</h1>
<div class="amount">{amount} {currency}</div><dl><dt>Sipariş</dt><dd>{oid}</dd></dl>
<form method="post" action="/api/v1/payments/fake/{oid}/complete">
<button class="ok" name="status" value="success">Ödemeyi onayla</button>
<button class="no" name="status" value="failed">Reddet</button></form></div></body></html>"""

# PayTR gibi: web sitesinin iFrame'inde sonuç sayfasına yönlenir. Mobil uygulamanın tarayıcısında
# (iFrame dışı) yalnızca sonuç gösterilir; uygulama durumu kendisi yoklar.
_FAKE_DONE = """<!doctype html><html lang="tr"><meta charset="utf-8"><title>{title}</title>""" + _FAKE_STYLE + """
<body><div class="box"><div class="tag">Geliştirme · sahte ödeme</div><h1>{title}</h1>
<p>Bu pencereyi kapatıp uygulamaya dönebilirsiniz.</p></div>
<script>if (window.top !== window.self) window.location.href = "{url}";</script></body></html>"""


def _frame_headers() -> dict[str, str]:
    """Sahte sayfa yalnızca müşteri sitesinin iFrame'inde açılabilir."""
    return {"Content-Security-Policy": f"frame-ancestors {get_settings().public_web_url}"}


def _fake_provider() -> FakeProvider:
    provider = get_payment_provider()
    if get_settings().env == "prod" or not isinstance(provider, FakeProvider):
        raise NotFound("bulunamadı")
    return provider


@router.get("/fake/{oid}", response_class=HTMLResponse, include_in_schema=False)
def fake_page(oid: str, db: DbSession):
    _fake_provider()
    payment = db.scalar(select(Payment).where(Payment.merchant_oid == oid))
    if payment is None:
        raise NotFound("ödeme bulunamadı")
    return HTMLResponse(
        _FAKE_PAGE.format(oid=oid, amount=payment.amount, currency=payment.currency.value),
        headers=_frame_headers(),
    )


@router.post("/fake/{oid}/complete", response_class=HTMLResponse, include_in_schema=False)
async def fake_complete(oid: str, request: Request, db: DbSession, now: Now):
    provider = _fake_provider()
    payment = db.scalar(select(Payment).where(Payment.merchant_oid == oid))
    if payment is None:
        raise NotFound("ödeme bulunamadı")
    status = (await request.form()).get("status", "success")
    total = str(int(payment.amount * 100))
    form = {"merchant_oid": oid, "status": str(status), "total_amount": total,
            "hash": provider.sign(oid, str(status), total)}
    payments.handle_callback(db, provider, form, now)
    db.commit()
    result = "ok" if status == "success" else "fail"
    url = f"{get_settings().public_web_url}/booking/payment-result?status={result}"
    title = "Ödeme tamamlandı" if result == "ok" else "Ödeme reddedildi"
    return HTMLResponse(_FAKE_DONE.format(url=url, title=title), headers=_frame_headers())
