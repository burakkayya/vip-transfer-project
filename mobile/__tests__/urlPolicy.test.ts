// MOB-04 (F2-7 kabul testleri): üretim derlemesinde düz HTTP API adresi reddedilir; geliştirmede serbest.
import { assertSecureApiUrl, isLocalDevHost, toWsBase } from "@/lib/urlPolicy";

describe("assertSecureApiUrl (çalışma zamanı)", () => {
  test("geliştirmede http serbest", () => {
    expect(() => assertSecureApiUrl("http://192.168.1.20:8000", { dev: true, allowLocalHttp: false })).not.toThrow();
  });

  test("üretimde https kabul edilir", () => {
    expect(() => assertSecureApiUrl("https://api.getawaytransfers.com", { dev: false, allowLocalHttp: false })).not.toThrow();
  });

  test("üretimde düz http açıkça hata verir", () => {
    expect(() => assertSecureApiUrl("http://api.getawaytransfers.com", { dev: false, allowLocalHttp: false })).toThrow(/https/);
  });

  test("üretimde yerel test adresi yalnızca derleme izin verdiyse (CI emülatörü) kabul edilir", () => {
    expect(() => assertSecureApiUrl("http://10.0.2.2:8000", { dev: false, allowLocalHttp: true })).not.toThrow();
    expect(() => assertSecureApiUrl("http://10.0.2.2:8000", { dev: false, allowLocalHttp: false })).toThrow();
    // İzin yalnızca yerel/özel ağ adreslerini kapsar; genel bir http adresi yine reddedilir.
    expect(() => assertSecureApiUrl("http://api.getawaytransfers.com", { dev: false, allowLocalHttp: true })).toThrow();
  });

  test("bozuk veya farklı şemalı adres reddedilir", () => {
    expect(() => assertSecureApiUrl("ftp://x", { dev: false, allowLocalHttp: true })).toThrow();
    expect(() => assertSecureApiUrl("not a url", { dev: true, allowLocalHttp: true })).toThrow();
  });
});

describe("isLocalDevHost", () => {
  test.each(["localhost", "127.0.0.1", "10.0.2.2", "192.168.1.20", "172.20.0.5"])("%s yerel sayılır", (h) => {
    expect(isLocalDevHost(h)).toBe(true);
  });
  test.each(["api.getawaytransfers.com", "8.8.8.8", "172.32.0.1", "localhost.evil.com"])("%s yerel sayılmaz", (h) => {
    expect(isLocalDevHost(h)).toBe(false);
  });
});

describe("toWsBase", () => {
  test("https -> wss, http -> ws", () => {
    expect(toWsBase("https://api.getawaytransfers.com")).toBe("wss://api.getawaytransfers.com");
    expect(toWsBase("http://localhost:8000")).toBe("ws://localhost:8000");
  });
});
