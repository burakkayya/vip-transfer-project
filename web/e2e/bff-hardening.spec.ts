import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fetchSiteAllowed, isAllowedOrigin, originConfig } from "../lib/bffGuard";
import { bffCookieNames, cookieSecure } from "../lib/bffCookies";
import { parseBookingCode, parseUuid } from "../lib/routeParams";

// F2-16 güvenlik regresyonları: WEB-03 (sabit köken listesi), WEB-06 (dinamik rota parametresi doğrulaması),
// WEB-07 (Sec-Fetch-Site), WEB-08 (çerez öneki). Saf testler sunucu istemez. HTTP testleri ayakta bir web
// sunucusu ister (WEB_URL, varsayılan http://localhost:3000); backend gerekmez: reddedilen istekler backend'e gitmez.

const pure = (info: { project: { name: string } }) => test.skip(info.project.name !== "desktop", "Saf testler tek projede koşar");

test.describe("bffGuard: köken (WEB-03, saf)", () => {
  test.beforeEach(({}, info) => pure(info));

  test("origin check ignores x-forwarded-host and uses fixed allowlist", () => {
    const cfg = originConfig({ NODE_ENV: "production", ALLOWED_ORIGINS: "https://getawaytransfers.com" });
    expect(isAllowedOrigin("https://getawaytransfers.com", cfg)).toBe(true);
    // Eski denetim Origin'i Host/X-Forwarded-Host ile karşılaştırıyordu; saldırgan kökeni artık başlıktan bağımsız reddedilir.
    expect(isAllowedOrigin("https://evil.example", cfg)).toBe(false);
    // Şema, port ve alt alan adı dahil tam eşleşme.
    for (const o of [
      "http://getawaytransfers.com",
      "https://getawaytransfers.com:8443",
      "https://www.getawaytransfers.com",
      "https://getawaytransfers.com.evil.example",
      "https://getawaytransfers.com/",
      "null",
      "",
    ]) {
      expect(isAllowedOrigin(o, cfg), o).toBe(false);
    }
    expect(isAllowedOrigin(null, cfg)).toBe(false);
  });

  test("allowed origins env is parsed and normalised", () => {
    const cfg = originConfig({
      NODE_ENV: "production",
      ALLOWED_ORIGINS: " https://A.example.com/ , https://b.example.com:8443,javascript:alert(1), not a url ",
    });
    expect([...cfg.origins].sort()).toEqual(["https://a.example.com", "https://b.example.com:8443"]);
    expect(isAllowedOrigin("https://a.example.com", cfg)).toBe(true);
    expect(isAllowedOrigin("https://b.example.com:8443", cfg)).toBe(true);
  });

  test("production without ALLOWED_ORIGINS rejects every origin", () => {
    const cfg = originConfig({ NODE_ENV: "production" });
    expect(cfg.mode).toBe("deny");
    for (const o of ["http://localhost:3000", "https://getawaytransfers.com"]) expect(isAllowedOrigin(o, cfg), o).toBe(false);
  });

  test("development without ALLOWED_ORIGINS allows only loopback http origins", () => {
    const cfg = originConfig({ NODE_ENV: "development" });
    expect(cfg.mode).toBe("dev-loopback");
    for (const o of ["http://localhost:3000", "http://127.0.0.1:3001", "http://[::1]:3000", "http://localhost"]) {
      expect(isAllowedOrigin(o, cfg), o).toBe(true);
    }
    for (const o of ["http://192.168.1.5:3000", "https://evil.example", "http://localhost.evil.example:3000", "null"]) {
      expect(isAllowedOrigin(o, cfg), o).toBe(false);
    }
    // Liste tanımlıysa geliştirmede de yalnızca liste geçerlidir.
    const listed = originConfig({ NODE_ENV: "development", ALLOWED_ORIGINS: "http://192.168.1.5:3000" });
    expect(isAllowedOrigin("http://192.168.1.5:3000", listed)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000", listed)).toBe(false);
  });
});

test.describe("bffGuard: Sec-Fetch-Site (WEB-07, saf)", () => {
  test.beforeEach(({}, info) => pure(info));

  test("cross-site and same-site fetch metadata is rejected", () => {
    for (const v of [null, "same-origin", "none", "SAME-ORIGIN"]) expect(fetchSiteAllowed(v), String(v)).toBe(true);
    for (const v of ["cross-site", "same-site", "garbage", ""]) expect(fetchSiteAllowed(v), v).toBe(false);
  });
});

test.describe("routeParams (WEB-06, saf)", () => {
  test.beforeEach(({}, info) => pure(info));

  test("uuid param is validated and encoded", () => {
    expect(parseUuid("0B7F2C3E-1D4A-4E5F-9A6B-7C8D9E0F1A2B")).toBe("0b7f2c3e-1d4a-4e5f-9a6b-7c8d9e0f1a2b");
    for (const bad of ["..", "../users", "..%2F..%2Fusers", "x?a=1", "a#b", "", "0b7f2c3e-1d4a-4e5f-9a6b-7c8d9e0f1a2b/cancel", "0b7f2c3e1d4a4e5f9a6b7c8d9e0f1a2b"]) {
      expect(parseUuid(bad), bad).toBeNull();
    }
    expect(parseUuid(null)).toBeNull();
    expect(parseUuid(undefined)).toBeNull();
  });

  test("booking code param is validated, upper-cased and encoded", () => {
    expect(parseBookingCode("ga12ab34")).toBe("GA12AB34");
    for (const bad of ["GA12AB3", "GA12AB345", "../GA12AB34", "GA12AB3%", "XX12AB34", "GA12AB3/"]) {
      expect(parseBookingCode(bad), bad).toBeNull();
    }
  });

  test("dynamic route pages use the shared validator", () => {
    const root = join(__dirname, "..", "..");
    const pages = [
      ["admin", "app", "(panel)", "bookings", "[id]", "page.tsx", "parseUuid"],
      ["admin", "app", "(panel)", "drivers", "[id]", "page.tsx", "parseUuid"],
      ["admin", "app", "(panel)", "dispatch", "page.tsx", "parseUuid"],
      ["web", "app", "[locale]", "bookings", "[code]", "page.tsx", "parseBookingCode"],
      ["web", "app", "[locale]", "bookings", "[code]", "pay", "page.tsx", "parseBookingCode"],
    ];
    for (const p of pages) {
      const fn = p[p.length - 1];
      const src = readFileSync(join(root, ...p.slice(0, -1)), "utf8");
      expect(src, p.join("/")).toContain("@/lib/routeParams");
      expect(src, p.join("/")).toContain(`${fn}(`);
    }
  });

  test("web and admin guard libs are identical", () => {
    for (const f of ["routeParams.ts", "bffGuard.ts", "bffCookies.ts"]) {
      const web = readFileSync(join(__dirname, "..", "lib", f), "utf8");
      const admin = readFileSync(join(__dirname, "..", "..", "admin", "lib", f), "utf8");
      expect(admin, f).toBe(web);
    }
  });
});

test.describe("bffCookies (WEB-08, saf)", () => {
  test.beforeEach(({}, info) => pure(info));

  test("production uses __Secure- prefixed names and keeps legacy names for migration", () => {
    const prod = bffCookieNames("ga", { NODE_ENV: "production" });
    expect(prod).toEqual({ at: "__Secure-ga_at", rt: "__Secure-ga_rt", legacyAt: "ga_at", legacyRt: "ga_rt" });
    expect(cookieSecure({ NODE_ENV: "production" })).toBe(true);
    // Geliştirmede (http) önek kullanılamaz; eski ad tek ad olur, geçiş yoktur.
    const dev = bffCookieNames("ga", { NODE_ENV: "development" });
    expect(dev).toEqual({ at: "ga_at", rt: "ga_rt", legacyAt: null, legacyRt: null });
    expect(cookieSecure({ NODE_ENV: "development" })).toBe(false);
    // Staging `next dev` ile koşsa bile BFF_SECURE_COOKIES=1 Secure ve öneki zorlar.
    expect(cookieSecure({ NODE_ENV: "development", BFF_SECURE_COOKIES: "1" })).toBe(true);
    expect(bffCookieNames("gaa", { NODE_ENV: "development", BFF_SECURE_COOKIES: "1" }).at).toBe("__Secure-gaa_at");
  });

  test("bff routes do not compare origin with host headers", () => {
    for (const app of ["web", "admin"]) {
      const src = readFileSync(join(__dirname, "..", "..", app, "app", "bff", "[...path]", "route.ts"), "utf8");
      expect(src, app).not.toMatch(/x-forwarded-host/);
      expect(src, app).not.toMatch(/headers\.get\(\s*["']host["']/);
      expect(src, app).toContain("@/lib/bffGuard");
      expect(src, app).toContain("@/lib/bffCookies");
    }
  });
});

type Raw = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

function raw(baseURL: string, path: string, method: string, headers: Record<string, string>, body?: string): Promise<Raw> {
  const base = new URL(baseURL);
  return new Promise((resolve, reject) => {
    // agent: false: Node 22 küresel ajanının 5 sn soket zaman aşımı, dev sunucunun ilk derlemesinden kısa.
    const req = httpRequest({ host: base.hostname, port: base.port || 80, path, method, headers, agent: false }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(120_000, () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

test.describe("BFF HTTP sertleştirme (web sunucusu gerekli)", () => {
  test.describe.configure({ timeout: 150_000 });
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "HTTP testleri tek projede koşar"));

  test("post with forged x-forwarded-host is rejected", async ({ baseURL }) => {
    // Eski kod: Origin host'u == X-Forwarded-Host ise geçiyordu.
    const res = await raw(baseURL!, "/bff/auth/logout", "POST", {
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
      "content-type": "application/json",
    }, "{}");
    expect(res.status, res.body).toBe(403);
    expect(res.body).toContain("forbidden");
  });

  test("post with forged host header is rejected", async ({ baseURL }) => {
    const res = await raw(baseURL!, "/bff/auth/logout", "POST", {
      host: "evil.example",
      origin: "http://evil.example",
      "content-type": "application/json",
    }, "{}");
    expect(res.status, res.body).toBe(403);
  });

  test("cross-site GET with side effects is rejected before upstream", async ({ baseURL }) => {
    // Müşteri sohbet GET'i karşı tarafın mesajlarını okundu işaretler (WEB-07).
    for (const site of ["cross-site", "same-site"]) {
      const res = await raw(baseURL!, "/bff/me/bookings/GA12AB34/messages", "GET", { "sec-fetch-site": site, accept: "application/json" });
      expect(res.status, `${site}: ${res.body.slice(0, 200)}`).toBe(403);
      expect(res.body).toContain("forbidden");
    }
  });

  test("web booking page returns 404 for invalid code", async ({ baseURL }) => {
    for (const p of ["/tr/bookings/..%2F..%2Fx", "/tr/bookings/GA12AB3%3F"]) {
      const res = await raw(baseURL!, p, "GET", { accept: "text/html" });
      expect(res.status, p).toBe(404);
    }
  });

  test("legal page rejects inherited object keys", async ({ baseURL }) => {
    for (const p of ["/tr/legal/constructor", "/tr/legal/toString", "/tr/legal/__proto__"]) {
      const res = await raw(baseURL!, p, "GET", { accept: "text/html" });
      expect(res.status, p).toBe(404);
    }
  });
});
