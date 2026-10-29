# Ödeme

## Sağlayıcılar

| Rol | Sağlayıcı | Görev |
|---|---|---|
| Birincil | PayTR | Müşteri para biriminde (EUR, USD, GBP, TRY) tahsilat, kart ile ön ödeme, iade |
| Yedek | iyzico | PayTR kesintisinde aynı sipariş modeliyle işlemi devralır |

## Kabul edilen yöntemler

- Kredi ve banka kartı (yurt içi ve yurt dışı).
- Havale ve EFT kabul edilmez (K-12).

## Para birimi ve settlement

- Müşteriden EUR tahsil edilir, şirket hesabına EUR olarak geçmesi hedeflenir. PayTR'de şirketin EUR hesabı hazırdır.
- Açık konu: EUR tahsilatının döviz olarak hesaba geçtiğinin sözleşmede yazılı teyidi.
- Yedek sağlayıcının hangi para birimlerini desteklediği yazılı olarak teyit edilmelidir.

## Sürücü ödemeleri

- Sürücülere TL ödeme yapılır.
- Sürücü hakedişi `driver_ledger` tablosunda hesaplanır, belirli dönemlerde `driver_payouts` ile ödenir.
- Otomatik aktarım için sağlayıcıda alt üye işyeri veya dağıtım (split/marketplace) özelliği gerekir. Açılma koşulları sözleşmede teyit edilmelidir.

## Webhook ve mutabakat

- Ödeme ve iade durumları sağlayıcı webhook'larıyla eşitlenir (`payment_webhooks`).
- Webhook içerikleri maskelenerek saklanır.
- Muhasebe mutabakatı günlük yapılır.

## Güvenlik

- Kart verisi sistemde tutulmaz, yalnızca işlem referansları saklanır.
- PCI DSS yükümlülükleri sağlayıcının ödeme sayfası (iFrame/yönlendirme) ile azaltılır.

## Fatura

- Her ödeme için GİB onaylı e-Arşiv fatura düzenlenir (fatura entegratörü üzerinden).
- Yurt dışı müşteriler için de e-Arşiv kesilir.
