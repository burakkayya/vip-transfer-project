import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { isSafeSegment, resolveBffPath } from "../lib/bffPath";
import { clientIpConfig, resolveClientIp, upstreamIpHeaders } from "../lib/clientIp";

// Güvenlik regresyonları: WEB-01 (BFF yol atlatma), WEB-04/05 (CSP nonce, HSTS), INF-03 (açık yönlendirme).
// Saf fonksiyon testleri sunucu istemez. HTTP testleri ayakta bir sunucu ister (`npm run dev` ya da `npm run start`);
// backend gerekmez: reddedilen istekler backend'e hiç gitmez. Ham yol `node:http` ile gönderilir
// (`curl --path-as-is` karşılığı); tarayıcı ve WHATWG URL `%2e%2e`'yi normalize ettiği için page/request kullanılmaz.

const ALLOWED: RegExp[] = [/^regions$/, /^places\/.+$/, /^auth\/(logout|me)$/, /^me\/.+$/];
const API = "http://api.test";

test.describe("bffPath (saf)", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "Saf testler tek projede koşar"));

  test("bff rejects dot segments", () => {
    for (const seg of [".", "..", ""]) expect(isSafeSegment(seg)).toBe(false);
    // Next parçaları çözülmüş verir: `%2e%2e` -> `..`.
    expect(resolveBffPath(["me", "..", "driver", "me"], ALLOWED, API)).toEqual({ ok: false, status: 400 });
    expect(resolveBffPath(["me", "."], ALLOWED, API)).toEqual({ ok: false, status: 400 });
  });

  test("bff rejects encoded slash in segment", () => {
    // `/bff/me/..%2Fdriver%2Fme` -> ["me", "../driver/me"]
    expect(resolveBffPath(["me", "../driver/me"], ALLOWED, API)).toEqual({ ok: false, status: 400 });
    expect(resolveBffPath(["places", "..\\..\\admin"], ALLOWED, API)).toEqual({ ok: false, status: 400 });
    // Sorgu enjeksiyonu (`x%3Fa%3D1`), çift kodlama (`%252e`), parça ve kontrol karakteri.
    for (const seg of ["x?a=1", "%2e%2e", "a#b", "a\u0000b", "a\nb", "a\u007fb"]) {
      expect(isSafeSegment(seg), JSON.stringify(seg)).toBe(false);
      expect(resolveBffPath(["me", seg], ALLOWED, API)).toEqual({ ok: false, status: 400 });
    }
  });

  test("bff upstream pathname stays under allowlist", () => {
    const r = resolveBffPath(["places", "ChIJ-abc_123"], ALLOWED, API, "?session=s1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path).toBe("places/ChIJ-abc_123");
    expect(r.upstream.href).toBe("http://api.test/api/v1/places/ChIJ-abc_123?session=s1");

    // Özel karakterler yeniden kodlanır, önek dışına çıkamaz.
    const u = resolveBffPath(["places", "a b:ç@"], ALLOWED, API);
    expect(u.ok).toBe(true);
    if (u.ok) {
      expect(u.upstream.pathname.startsWith("/api/v1/places/")).toBe(true);
      expect(u.upstream.pathname.split("/").length).toBe(5);
    }

    // İzin listesi dışı yol 404.
    expect(resolveBffPath(["driver", "me"], ALLOWED, API)).toEqual({ ok: false, status: 404 });
    expect(resolveBffPath(["admin", "users"], ALLOWED, API)).toEqual({ ok: false, status: 404 });
    expect(resolveBffPath([], ALLOWED, API)).toEqual({ ok: false, status: 400 });
  });
});

// REV-A-3 / REV-B-1: BFF istemcinin yazdığı IP başlıklarını upstream'e aynen aktarmamalı.
test.describe("clientIp (saf)", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "Saf testler tek projede koşar"));

  const SPOOF = "6.6.6.6";
  const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()] ?? null;
  const ALL_SPOOFED = {
    "cf-connecting-ip": SPOOF,
    "x-forwarded-for": `${SPOOF}, 7.7.7.7`,
    "x-real-ip": SPOOF,
    forwarded: `for=${SPOOF}`,
  };

  test("config defaults to none and fails closed on unknown values", () => {
    expect(clientIpConfig({})).toEqual({ source: "none", trustedHops: 1 });
    expect(clientIpConfig({ BFF_CLIENT_IP_SOURCE: "cloudflare" }).source).toBe("cloudflare");
    expect(clientIpConfig({ BFF_CLIENT_IP_SOURCE: "XFF", BFF_TRUSTED_HOPS: "2" })).toEqual({ source: "xff", trustedHops: 2 });
    expect(clientIpConfig({ BFF_CLIENT_IP_SOURCE: "x-forwarded-for" }).source).toBe("none");
    expect(clientIpConfig({ BFF_CLIENT_IP_SOURCE: "xff", BFF_TRUSTED_HOPS: "0" }).trustedHops).toBe(0);
    expect(clientIpConfig({ BFF_CLIENT_IP_SOURCE: "xff", BFF_TRUSTED_HOPS: "abc" }).trustedHops).toBe(0);
  });

  test("source none forwards no client ip header", () => {
    const cfg = clientIpConfig({});
    expect(resolveClientIp(headers(ALL_SPOOFED), cfg)).toBeNull();
    expect(upstreamIpHeaders(headers(ALL_SPOOFED), cfg)).toEqual({});
  });

  test("source cloudflare uses only cf-connecting-ip and validates it", () => {
    const cfg = clientIpConfig({ BFF_CLIENT_IP_SOURCE: "cloudflare" });
    expect(resolveClientIp(headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": SPOOF }), cfg)).toBe("203.0.113.9");
    expect(resolveClientIp(headers({ "cf-connecting-ip": " 2001:db8::1 " }), cfg)).toBe("2001:db8::1");
    // XFF'ye düşülmez; bozuk değer aktarılmaz.
    expect(resolveClientIp(headers({ "x-forwarded-for": SPOOF }), cfg)).toBeNull();
    for (const bad of ["evil", "1.2.3.4, 5.6.7.8", "999.1.1.1", "x".repeat(100)]) {
      expect(resolveClientIp(headers({ "cf-connecting-ip": bad }), cfg), bad).toBeNull();
    }
  });

  test("source xff takes the entry added by trusted hops, not the leftmost", () => {
    const one = clientIpConfig({ BFF_CLIENT_IP_SOURCE: "xff" });
    // İstemci "6.6.6.6" yazdı, güvenilir proxy gerçek adresi (198.51.100.4) sona ekledi.
    expect(resolveClientIp(headers({ "x-forwarded-for": `${SPOOF}, 198.51.100.4` }), one)).toBe("198.51.100.4");
    expect(resolveClientIp(headers({ "x-forwarded-for": "198.51.100.4", "cf-connecting-ip": SPOOF }), one)).toBe("198.51.100.4");
    const two = clientIpConfig({ BFF_CLIENT_IP_SOURCE: "xff", BFF_TRUSTED_HOPS: "2" });
    expect(resolveClientIp(headers({ "x-forwarded-for": `${SPOOF}, 198.51.100.4, 10.0.0.2` }), two)).toBe("198.51.100.4");
    // Zincir güvenilir hop sayısından kısa ya da değer bozuk: IP aktarılmaz.
    expect(resolveClientIp(headers({ "x-forwarded-for": "198.51.100.4" }), two)).toBeNull();
    expect(resolveClientIp(headers({ "x-forwarded-for": `${SPOOF}, unknown` }), one)).toBeNull();
    expect(resolveClientIp(headers({}), one)).toBeNull();
    expect(resolveClientIp(headers({ "x-forwarded-for": "198.51.100.4" }), clientIpConfig({ BFF_CLIENT_IP_SOURCE: "xff", BFF_TRUSTED_HOPS: "0" }))).toBeNull();
  });

  test("upstream headers never echo client supplied ip headers", () => {
    for (const env of [{}, { BFF_CLIENT_IP_SOURCE: "cloudflare" }, { BFF_CLIENT_IP_SOURCE: "xff" }]) {
      const out = upstreamIpHeaders(headers({ ...ALL_SPOOFED, "cf-connecting-ip": "evil" }), clientIpConfig(env));
      expect(Object.keys(out).every((k) => k === "cf-connecting-ip"), JSON.stringify(out)).toBe(true);
      expect(JSON.stringify(out)).not.toContain(SPOOF);
      expect(JSON.stringify(out)).not.toContain("evil");
    }
    // Backend (deps.client_ip) önce cf-connecting-ip'yi okur: BFF hesaplanan IP'yi yalnızca bu başlıkla gönderir.
    const out = upstreamIpHeaders(headers({ "x-forwarded-for": `${SPOOF}, 198.51.100.4` }), clientIpConfig({ BFF_CLIENT_IP_SOURCE: "xff" }));
    expect(out).toEqual({ "cf-connecting-ip": "198.51.100.4" });
  });

  test("web and admin clientIp libs are identical", () => {
    const web = readFileSync(join(__dirname, "..", "lib", "clientIp.ts"), "utf8");
    const admin = readFileSync(join(__dirname, "..", "..", "admin", "lib", "clientIp.ts"), "utf8");
    expect(admin).toBe(web);
  });

  test("bff routes use clientIp lib and do not read ip headers directly", () => {
    for (const app of ["web", "admin"]) {
      const src = readFileSync(join(__dirname, "..", "..", app, "app", "bff", "[...path]", "route.ts"), "utf8");
      expect(src, app).toContain("@/lib/clientIp");
      expect(src, app).not.toMatch(/headers\.get\(\s*["'](cf-connecting-ip|x-forwarded-for|x-real-ip|forwarded)["']/);
    }
  });
});

type RawResponse ={ status: number; headers: Record<string, string | string[] | undefined>; body: string };

function rawGet(baseURL: string, rawPath: string): Promise<RawResponse> {
  const base = new URL(baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: base.hostname, port: base.port, path: rawPath, method: "GET", headers: { accept: "application/json" } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    // `next dev` ilk istekte sayfayı derlediği için süre geniş tutulur.
    req.setTimeout(120_000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

test.describe("BFF HTTP (sunucu gerekli)", () => {
  test.describe.configure({ timeout: 90_000 });
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "HTTP testleri tek projede koşar"));

  for (const raw of [
    "/bff/me/..%2Fdriver%2Fme",
    "/bff/me/%2e%2e/driver/me",
    "/bff/places/..%2F..%2Fadmin%2Fusers",
    "/bff/me/x%3Fa%3D1",
    "/bff/me/%252e%252e",
  ]) {
    test(`bff blocks traversal before upstream (${raw})`, async ({ baseURL }) => {
      const res = await rawGet(baseURL!, raw);
      // 400/404 BFF'nin kendi yanıtıdır; 5xx ya da backend yanıtı isteğin upstream'e gittiğini gösterir.
      expect([400, 404], `${raw} -> ${res.status} ${res.body.slice(0, 200)}`).toContain(res.status);
      expect(res.body).toContain("error");
    });
  }
});

test.describe("Güvenlik başlıkları (sunucu gerekli)", () => {
  test.describe.configure({ timeout: 180_000 });
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "Başlık testleri tek projede koşar"));

  test("csp header contains nonce and no unsafe-inline", async ({ baseURL }) => {
    const res = await rawGet(baseURL!, "/tr");
    expect(res.status).toBe(200);
    const csp = String(res.headers["content-security-policy"] ?? "");
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(scriptSrc)?.[1];
    expect(nonce, csp).toBeTruthy();
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    // Next'in inline script'leri aynı nonce'ı taşır.
    expect(res.body).toContain(`nonce="${nonce}"`);
    // Her istekte farklı nonce.
    const again = String((await rawGet(baseURL!, "/tr")).headers["content-security-policy"] ?? "");
    expect(again).not.toContain(`'nonce-${nonce}'`);
  });

  test("page scripts run under nonce CSP", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    await page.goto("/tr");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Hidrasyon çalıştıysa Next yönlendiricisi istemci tarafında hazırdır.
    await page.waitForFunction(() => "next" in window);
    expect(violations).toEqual([]);
  });

  test("hsts header present in production", async ({ baseURL }) => {
    test.skip(process.env.E2E_PRODUCTION !== "1", "Yalnızca `npm run start` ile, E2E_PRODUCTION=1 iken");
    const res = await rawGet(baseURL!, "/tr");
    expect(String(res.headers["strict-transport-security"] ?? "")).toContain("max-age=31536000");
    expect(String(res.headers["strict-transport-security"] ?? "")).toContain("includeSubDomains");
  });
});

test.describe("Dil yönlendirmesi (INF-03, sunucu gerekli)", () => {
  test.describe.configure({ timeout: 180_000 });
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "Tek projede koşar"));

  for (const raw of ["/%09/evil", "/%5C%5Cevil", "//evil", "/en/%09/evil", "/%5C/evil.example"]) {
    test(`middleware does not redirect off-origin (${raw})`, async ({ baseURL }) => {
      const res = await rawGet(baseURL!, raw);
      const location = res.headers.location;
      if (typeof location === "string") {
        const target = new URL(location, baseURL);
        expect(target.origin, `${raw} -> ${location}`).toBe(new URL(baseURL!).origin);
      }
    });
  }
});
