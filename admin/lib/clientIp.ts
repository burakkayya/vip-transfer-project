/**
 * BFF istemci IP'si (REV-A-3 / REV-B-1). Saf fonksiyon; route.ts ve testler kullanır.
 *
 * İstemcinin yazdığı `cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, `forwarded` başlıkları upstream'e
 * asla aynen aktarılmaz. IP kaynağı ortam değişkeniyle açıkça seçilir:
 * - `BFF_CLIENT_IP_SOURCE=cloudflare`: yalnızca `cf-connecting-ip` okunur. Yalnızca BFF'ye Cloudflare dışından
 *   erişilemiyorsa (origin kilitli) güvenlidir.
 * - `BFF_CLIENT_IP_SOURCE=xff`: `x-forwarded-for` zincirinin sağdan `BFF_TRUSTED_HOPS`'uncu değeri
 *   (sağdan `BFF_TRUSTED_HOPS - 1` değer atlanır). `BFF_TRUSTED_HOPS` = BFF'nin önünde XFF'ye adres ekleyen
 *   güvenilir proxy sayısı (varsayılan 1: tek reverse proxy, istemci adresini sona ekler). Soldaki değerler
 *   istemcinin yazabildiği değerlerdir, kullanılmaz.
 * - Tanımsız, `none` ya da bilinmeyen değer: hiçbir IP başlığı aktarılmaz (backend soket IP'sini, yani BFF'yi görür).
 *
 * Hesaplanan IP doğrulanır ve backend'e yalnızca `cf-connecting-ip` başlığıyla gider; backend (deps.client_ip)
 * bu başlığa yalnızca soket adresi GETAWAY_TRUSTED_PROXIES içindeyse (BFF adresi) güvenir.
 * Ayrıntı: docs/security/client-ip.md.
 *
 * Bu dosya admin/lib/clientIp.ts ile aynıdır; biri değişirse diğeri de değişir (test denetler).
 */
import { isIP } from "node:net";

export type ClientIpSource = "cloudflare" | "xff" | "none";
export type ClientIpConfig = { source: ClientIpSource; trustedHops: number };
export type HeaderGetter = (name: string) => string | null;

/** Backend'e giden tek IP başlığı (backend önce bunu okur). */
export const UPSTREAM_IP_HEADER = "cf-connecting-ip";

const MAX_IP_LENGTH = 64;
const MAX_XFF_LENGTH = 1024;

export function clientIpConfig(env: Record<string, string | undefined> = process.env): ClientIpConfig {
  const raw = (env.BFF_CLIENT_IP_SOURCE ?? "").trim().toLowerCase();
  const source: ClientIpSource = raw === "cloudflare" || raw === "xff" ? raw : "none";
  const hopsRaw = (env.BFF_TRUSTED_HOPS ?? "1").trim();
  // Geçersiz hop sayısı 0 olur: xff kipinde hiçbir IP aktarılmaz (kapalı başarısızlık).
  const trustedHops = /^[0-9]{1,2}$/.test(hopsRaw) ? Number(hopsRaw) : 0;
  return { source, trustedHops };
}

function validIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.length === 0 || v.length > MAX_IP_LENGTH) return null;
  return isIP(v) ? v : null;
}

export function resolveClientIp(get: HeaderGetter, cfg: ClientIpConfig): string | null {
  if (cfg.source === "cloudflare") return validIp(get("cf-connecting-ip"));
  if (cfg.source === "xff") {
    const xff = get("x-forwarded-for");
    if (!xff || xff.length > MAX_XFF_LENGTH || cfg.trustedHops < 1) return null;
    const hops = xff.split(",").map((h) => h.trim());
    if (hops.length < cfg.trustedHops) return null;
    return validIp(hops[hops.length - cfg.trustedHops]);
  }
  return null;
}

/** Upstream isteğine eklenecek IP başlıkları: ya tek doğrulanmış `cf-connecting-ip` ya da hiçbiri. */
export function upstreamIpHeaders(get: HeaderGetter, cfg: ClientIpConfig): Record<string, string> {
  const ip = resolveClientIp(get, cfg);
  return ip ? { [UPSTREAM_IP_HEADER]: ip } : {};
}
