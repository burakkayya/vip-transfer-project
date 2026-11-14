/**
 * BFF istek kökeni denetimleri (WEB-03, WEB-07). Saf fonksiyon; route.ts ve testler kullanır.
 *
 * WEB-03: Durum değiştiren isteklerde `Origin`, istemcinin etkileyebildiği `Host` / `X-Forwarded-Host` ile değil,
 * yapılandırılmış sabit bir listeyle (ALLOWED_ORIGINS) tam eşleştirilir (şema, ana makine ve port dahil).
 * - ALLOWED_ORIGINS tanımlı: yalnızca listedeki kökenler (virgül ya da boşlukla ayrılmış, ör.
 *   `https://getawaytransfers.com,https://www.getawaytransfers.com`). Geçersiz girdiler yok sayılır.
 * - Tanımsız ve NODE_ENV=production: hiçbir köken kabul edilmez (kapalı başarısızlık); durum değiştiren tüm
 *   istekler 403 alır. Dağıtımda değişken mutlaka ayarlanmalı.
 * - Tanımsız ve geliştirme: yalnızca loopback http kökenleri (`http://localhost:*`, `http://127.0.0.1:*`,
 *   `http://[::1]:*`). LAN'dan (telefon) deneme için ALLOWED_ORIGINS ayarlanır.
 *
 * WEB-07: Bazı GET'ler yan etkilidir (müşteri sohbet GET'i karşı tarafın mesajlarını okundu işaretler) ve web
 * çerezi SameSite=Lax olduğundan çapraz siteden üst düzey gezinmede çerez gider. `Sec-Fetch-Site` başlığı
 * `cross-site` / `same-site` ise istek her yöntemde reddedilir. Başlık yoksa (eski tarayıcı, curl) izin verilir:
 * çerezi olmayan istemci için CSRF söz konusu değildir.
 *
 * Bu dosya web/lib/bffGuard.ts ve admin/lib/bffGuard.ts olarak aynıdır (test denetler).
 */

export type OriginConfig = {
  mode: "list" | "dev-loopback" | "deny";
  origins: ReadonlySet<string>;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Geçerli bir http(s) kökeninin kanonik biçimi (`https://a.example:8443`), değilse `null`. */
function canonicalOrigin(value: string): string | null {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  return u.origin;
}

export function originConfig(env: Record<string, string | undefined> = process.env): OriginConfig {
  const origins = new Set<string>();
  for (const entry of (env.ALLOWED_ORIGINS ?? "").split(/[\s,]+/)) {
    if (!entry) continue;
    // Sondaki `/` dışında yol taşıyan girdi köken değildir; yok sayılır.
    const trimmed = entry.replace(/\/$/, "");
    const origin = canonicalOrigin(trimmed);
    if (origin && origin === trimmed.toLowerCase()) origins.add(origin);
  }
  if (origins.size > 0) return { mode: "list", origins };
  return { mode: env.NODE_ENV === "production" ? "deny" : "dev-loopback", origins };
}

/** `Origin` başlığı izin listesinde mi? Başlık tarayıcının serileştirdiği biçimde olmalı (tam eşleşme). */
export function isAllowedOrigin(origin: string | null, cfg: OriginConfig): boolean {
  if (!origin || origin === "null") return false;
  const canonical = canonicalOrigin(origin);
  if (canonical === null || canonical !== origin) return false;
  if (cfg.mode === "list") return cfg.origins.has(canonical);
  if (cfg.mode === "dev-loopback") {
    const u = new URL(canonical);
    return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
  }
  return false;
}

/** `Sec-Fetch-Site` değeri kabul edilebilir mi? Yalnızca aynı köken, kullanıcı başlatımlı (`none`) ya da başlıksız. */
export function fetchSiteAllowed(value: string | null): boolean {
  if (value === null) return true;
  const v = value.trim().toLowerCase();
  return v === "same-origin" || v === "none";
}
