// MOB-04 (F2-7 kabul testleri): mağaza/önizleme profilinde http adresi ve cleartext bayrağı derlemeyi durdurur.
const ENV_KEYS = [
  "EAS_BUILD_PROFILE", "EAS_BUILD_PLATFORM", "GETAWAY_API_URL", "GETAWAY_WEB_URL", "GETAWAY_ANDROID_CLEARTEXT", "APP_VARIANT",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

type ConfigFn = (ctx: { config: Record<string, unknown> }) => { extra?: Record<string, unknown> };

function loadConfig(env: Record<string, string>): ConfigFn {
  Object.assign(process.env, env);
  let mod: { default: ConfigFn } | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../app.config");
  });
  return mod!.default;
}

const HTTPS = { GETAWAY_API_URL: "https://api.getawaytransfers.com", GETAWAY_WEB_URL: "https://getawaytransfers.com" };

test("app.config throws for http apiUrl in production profile", () => {
  expect(() => loadConfig({ EAS_BUILD_PROFILE: "production", GETAWAY_API_URL: "http://api.getawaytransfers.com", GETAWAY_WEB_URL: HTTPS.GETAWAY_WEB_URL })).toThrow(/https/);
});

test("app.config throws for missing apiUrl (http varsayılanı) in preview-driver profile", () => {
  expect(() => loadConfig({ EAS_BUILD_PROFILE: "preview-driver" })).toThrow(/https/);
});

test("app.config throws for http webUrl in production profile", () => {
  expect(() => loadConfig({ EAS_BUILD_PROFILE: "production", GETAWAY_API_URL: HTTPS.GETAWAY_API_URL, GETAWAY_WEB_URL: "http://getawaytransfers.com" })).toThrow(/https/);
});

test("app.config throws when GETAWAY_ANDROID_CLEARTEXT set for store profile", () => {
  expect(() => loadConfig({ EAS_BUILD_PROFILE: "production", ...HTTPS, GETAWAY_ANDROID_CLEARTEXT: "1" })).toThrow(/CLEARTEXT/);
});

test("mağaza profili https ile derlenir ve yerel http izni vermez", () => {
  const cfg = loadConfig({ EAS_BUILD_PROFILE: "production", ...HTTPS })({ config: {} });
  expect(cfg.extra?.apiUrl).toBe(HTTPS.GETAWAY_API_URL);
  expect(cfg.extra?.allowLocalHttp).toBe(false);
});

test("geliştirme profili yerel http adresine izin verir", () => {
  expect(loadConfig({ EAS_BUILD_PROFILE: "development", GETAWAY_API_URL: "http://10.0.2.2:8000" })({ config: {} }).extra?.allowLocalHttp).toBe(true);
});

test("REV-C-9: profilsiz yerel Release derlemesi açık izin olmadan yerel http'ye izin vermez", () => {
  expect(loadConfig({ GETAWAY_API_URL: "http://192.168.1.20:8000" })({ config: {} }).extra?.allowLocalHttp).toBe(false);
  expect(
    loadConfig({ GETAWAY_API_URL: "http://localhost:8000", GETAWAY_ALLOW_LOCAL_HTTP: "1" })({ config: {} }).extra?.allowLocalHttp,
  ).toBe(true);
});

test("CI emülatör derlemesi (profil yok, cleartext) kırılmaz", () => {
  const cfg = loadConfig({ GETAWAY_API_URL: "http://10.0.2.2:8000", GETAWAY_WEB_URL: "http://10.0.2.2:8000", GETAWAY_ANDROID_CLEARTEXT: "1" })({ config: {} });
  expect(cfg.extra?.allowLocalHttp).toBe(true);
});
