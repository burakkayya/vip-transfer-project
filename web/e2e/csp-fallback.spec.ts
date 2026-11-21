import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";

// REV-B-9: middleware matcher'ı `bff` önekini fazla geniş dışlıyordu (`/bffx`, `/_nextx` gibi yollar middleware'e
// girmiyor, next.config'teki yedek politikaya da uymuyordu): yanıt CSP'siz kalıyordu. Her yanıtta tam olarak bir
// CSP başlığı olmalı. Ayakta bir sunucu ister (`npm run dev` ya da `npm run start`); backend gerekmez.

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "HTTP testleri tek projede koşar"));

function rawGet(path: string, headers: Record<string, string> = {}): Promise<{ status: number; csp: string[] }> {
  const base = new URL(process.env.WEB_URL ?? "http://localhost:3000");
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: base.hostname, port: base.port || 80, path, method: "GET", headers },
      (res) => {
        res.resume();
        const raw = res.headers["content-security-policy"];
        resolve({ status: res.statusCode ?? 0, csp: raw === undefined ? [] : Array.isArray(raw) ? raw : [raw] });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

for (const path of ["/bffx", "/bffx/y", "/_nextx", "/_vercelx", "/bff"]) {
  test(`csp present exactly once on ${path}`, async () => {
    const r = await rawGet(path);
    expect(r.csp, `${path} (${r.status})`).toHaveLength(1);
    expect(r.csp[0]).toContain("default-src");
    expect(r.csp[0]).toContain("object-src 'none'");
    expect(r.csp[0]).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
}

test("csp present on prefetch requests", async () => {
  const variants: Record<string, string>[] = [{ "next-router-prefetch": "1" }, { purpose: "prefetch" }];
  for (const headers of variants) {
    const r = await rawGet("/tr", headers);
    expect(r.csp, JSON.stringify(headers)).toHaveLength(1);
  }
});

// K-81: noktalı sayfa yolları middleware'e girer (nonce'lı CSP; 404 sayfası boş kalmaz), statik dosyalar girmez.
for (const path of ["/tr/a.b", "/tr/bookings/GA.123", "/%2e%2e"]) {
  test(`dotted page path ${path} gets nonce csp`, async () => {
    const r = await rawGet(path);
    expect(r.csp, `${path} (${r.status})`).toHaveLength(1);
    expect(r.csp[0]).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  });
}

test("static file keeps fallback csp without nonce", async () => {
  const r = await rawGet("/icon.svg");
  expect(r.status).toBe(200);
  expect(r.csp).toHaveLength(1);
  expect(r.csp[0]).not.toMatch(/'nonce-/);
});

test("page csp keeps per-request nonce", async () => {
  const r = await rawGet("/tr");
  expect(r.csp).toHaveLength(1);
  expect(r.csp[0]).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
});
