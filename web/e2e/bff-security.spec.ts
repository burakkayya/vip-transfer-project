import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { isSafeSegment, resolveBffPath } from "../lib/bffPath";

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

type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

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
