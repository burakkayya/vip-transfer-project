# İstemci IP zinciri

IP başına sınırlar (OTP isteği, personel girişi kilidi, fiyat/adres hız sınırı) ve denetim kayıtları doğru istemci IP'sine dayanır. Zincirin iki halkası vardır: BFF (web ve admin Next sunucuları) ve backend.

## 1. BFF (web/lib/clientIp.ts, admin/lib/clientIp.ts — iki dosya aynı)

İstemcinin yazdığı `cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, `forwarded` başlıkları backend'e **asla aynen aktarılmaz**. IP kaynağı ortam değişkeniyle seçilir:

| `BFF_CLIENT_IP_SOURCE` | Okunan değer | Ne zaman |
|---|---|---|
| `cloudflare` | Yalnızca `cf-connecting-ip` | BFF'ye yalnızca Cloudflare erişebiliyorsa (origin IP'si Cloudflare aralıklarıyla kısıtlı ya da Cloudflare Tunnel). Aksi halde istemci başlığı doğrudan yazar. |
| `xff` | `x-forwarded-for`'un sağdan `BFF_TRUSTED_HOPS`'uncu değeri | BFF önünde XFF'ye adres **ekleyen** reverse proxy/yük dengeleyici varsa. |
| `none` / boş / bilinmeyen | Hiçbiri | Geliştirme. Backend BFF'nin adresini görür. |

`BFF_TRUSTED_HOPS` (varsayılan 1): BFF'nin önünde XFF'ye adres ekleyen güvenilir proxy sayısı. Örnek: istemci → nginx → BFF ise nginx istemci adresini sona ekler, XFF `sahte, 198.51.100.4` olur; `1` ile `198.51.100.4` alınır (sağdan `hops - 1` değer atlanır). İstemci → LB → nginx → BFF ise `2`. Zincir kısa ya da değer geçerli bir IP değilse IP aktarılmaz.

Hesaplanan IP doğrulanır ve backend'e tek başlıkla gider: `cf-connecting-ip`. Yenileme (`/auth/refresh`) isteği de aynı başlığı taşır.

## 2. Backend (app/api/deps.py `client_ip`)

Backend `cf-connecting-ip`'ye (yoksa XFF'ye) yalnızca soket adresi `GETAWAY_TRUSTED_PROXIES` içindeyse güvenir. Bu yüzden:

- **BFF sunucularının backend'e bağlandığı adres(ler) `GETAWAY_TRUSTED_PROXIES`'e yazılmalıdır** (ör. iç ağ `["10.0.1.0/24"]`). Yazılmazsa tüm kullanıcılar BFF'nin tek IP'sine düşer ve IP sınırları herkesi birlikte keser.
- Üretimde liste boşsa backend açılmaz (REV-A-2).
- Backend internete doğrudan açılmamalı; yalnızca BFF erişmeli. Backend'e Cloudflare'den doğrudan da istek geliyorsa (mobil uygulama) Cloudflare IP aralıkları da listeye eklenir.

## Kurulum örnekleri

**Cloudflare'li:** Cloudflare → BFF (origin yalnızca Cloudflare'e açık) → backend.
`BFF_CLIENT_IP_SOURCE=cloudflare`; backend `GETAWAY_TRUSTED_PROXIES=["<BFF iç ağ CIDR>", <mobil API Cloudflare'den geliyorsa Cloudflare aralıkları>]`.

**Cloudflare'siz:** nginx/LB → BFF → backend.
nginx `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`; BFF `BFF_CLIENT_IP_SOURCE=xff`, `BFF_TRUSTED_HOPS=1` (her ek proxy için +1); backend `GETAWAY_TRUSTED_PROXIES=["<BFF iç ağ CIDR>"]`.

## İlgili sınırlar

- OTP IP sayacı ve personel giriş kilidi IPv6 adresini /64 önekine indirir, IPv4 tam adres (`app/services/auth.py` `ip_bucket`).
- Personel kilidi (hesap, IP öneki) çiftine göredir (`GETAWAY_STAFF_LOGIN_MAX_FAILURES`, varsayılan 10/15 dk); hesap geneli `GETAWAY_STAFF_LOGIN_ACCOUNT_MAX_FAILURES` (50). Redis yoksa hesap geneli 10'a düşer.
- OTP küresel eşiği (`GETAWAY_OTP_GLOBAL_MAX_PER_HOUR`, 100) yalnızca alarm; sert ret `GETAWAY_OTP_GLOBAL_HARD_LIMIT_PER_HOUR` (2000).
