import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";

// F2-16 güvenlik regresyonları (admin): WEB-03 sabit köken listesi, WEB-06 `[id]` doğrulaması, WEB-07 Sec-Fetch-Site.
// Giriş gerektirmez; `page`/`request` fikstürü kullanılmadığı için oturum dosyası da gerekmez:
//   npx playwright test e2e/security.spec.ts --project=desktop --no-deps
// Ayakta bir admin sunucusu ister (ADMIN_URL, varsayılan http://localhost:3001); backend gerekmez.
// Saf yardımcı testleri (bffGuard, routeParams, bffCookies) web/e2e/bff-hardening.spec.ts içindedir.

type Raw = { status: number; body: string };

function raw(path: string, method: string, headers: Record<string, string>, body?: string): Promise<Raw> {
  const base = new URL(process.env.ADMIN_URL ?? "http://localhost:3001");
  return new Promise((resolve, reject) => {
    // agent: false: Node 22 küresel ajanının 5 sn soket zaman aşımı, dev sunucunun ilk derlemesinden kısa.
    const req = httpRequest({ host: base.hostname, port: base.port || 80, path, method, headers, agent: false }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(120_000, () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

test.describe.configure({ timeout: 150_000 });

test("admin post with forged x-forwarded-host is rejected", async () => {
  const res = await raw("/bff/auth/logout", "POST", {
    origin: "https://evil.example",
    "x-forwarded-host": "evil.example",
    "content-type": "application/json",
  }, "{}");
  expect(res.status, res.body).toBe(403);
});

test("admin cross-site GET is rejected before upstream", async () => {
  const res = await raw("/bff/admin/bookings", "GET", { "sec-fetch-site": "cross-site", accept: "application/json" });
  expect(res.status, res.body.slice(0, 200)).toBe(403);
});

test("admin detail page renders for a well-formed uuid", async () => {
  // Biçim geçerliyse sayfa çizilir (veri istemcide yüklenir; kayıt olmasa da 200).
  const res = await raw("/bookings/0b7f2c3e-1d4a-4e5f-9a6b-7c8d9e0f1a2b", "GET", { accept: "text/html" });
  expect(res.status).toBe(200);
});

// WEB-06: geçersiz `[id]` ile sayfa bulunamadı çizer ve hiçbir /bff/admin/* isteği yapılmaz. HTTP durumu 200 kalır:
// Shell oturumu istemcide yüklediği için SSR'de sayfa öğesi çizilmez, `notFound()` istemcide işlenir. Oturum ve
// backend yanıtları taklit edilir (backend ve giriş gerekmez).
test.describe("admin [id] doğrulaması (tarayıcı)", () => {
  test.use({ storageState: { cookies: [], origins: [] }, baseURL: process.env.ADMIN_URL ?? "http://localhost:3001" });

  async function visit(page: import("@playwright/test").Page, path: string): Promise<string[]> {
    const calls: string[] = [];
    await page.route("**/bff/auth/me", (r) => r.fulfill({ json: { id: "e2e", kind: "staff", roles: ["admin"] } }));
    await page.route("**/bff/admin/**", (r) => {
      calls.push(new URL(r.request().url()).pathname);
      return r.fulfill({ status: 404, json: { error: { code: "not_found", message: "yok" } } });
    });
    await page.goto(path);
    return calls;
  }

  for (const p of [
    "/bookings/not-a-uuid",
    "/bookings/..%2F..%2Fusers",
    "/bookings/0b7f2c3e-1d4a-4e5f-9a6b-7c8d9e0f1a2b%2Fcancel",
    "/drivers/..%2Fonline",
    "/drivers/x%3Fa%3D1",
    "/dispatch?leg=..%2F..%2Fusers",
  ]) {
    test(`admin page returns notFound for non-uuid id (${p})`, async ({ page }) => {
      const calls = await visit(page, p);
      if (p.split("?")[0].includes(".")) {
        // Noktalı yollar middleware eşleyicisinin "uzantılı dosya" dışlamasına düşer, nonce'suz yedek CSP alır ve
        // hidrasyon olmaz (REV-B-9). Burada yalnızca hiçbir BFF isteği yapılmadığı denetlenir.
        await page.waitForLoadState("networkidle");
        expect(calls, p).toEqual([]);
      } else if (p.startsWith("/dispatch")) {
        // Dağıtım sayfası sabit uçları her açılışta çağırır (bekleyen liste ve sayısı, çevrimiçi sürücüler; menüdeki
        // açık olay sayısı, K-83); `leg` değeri hiçbir isteğe taşınmamalı.
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(calls.filter((c) => !/^\/bff\/admin\/(dispatch\/pending(\/count)?|drivers\/online|incidents\/count)$/.test(c)), p)
          .toEqual([]);
      } else {
        await expect(page.getByRole("heading", { name: "Sayfa bulunamadı" })).toBeVisible();
        expect(calls, p).toEqual([]);
      }
    });
  }

  test("admin page requests detail for a well-formed uuid (pozitif kontrol)", async ({ page }) => {
    const calls = await visit(page, "/bookings/0B7F2C3E-1D4A-4E5F-9A6B-7C8D9E0F1A2B");
    await expect.poll(() => calls).toContain("/bff/admin/bookings/0b7f2c3e-1d4a-4e5f-9a6b-7c8d9e0f1a2b");
  });
});
