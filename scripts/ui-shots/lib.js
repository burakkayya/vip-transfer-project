// Ortak yardımcılar: argüman ayrıştırma, Chromium yolu, çıktı klasörü, ekran süzgeci.
const { chromium, webkit, devices } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const REPO = path.resolve(__dirname, "../..");

const URLS = {
  web: (process.env.WEB_URL || "http://localhost:3000").replace(/\/$/, ""),
  admin: (process.env.ADMIN_URL || "http://localhost:3001").replace(/\/$/, ""),
  mobile: (process.env.MOBILE_URL || "http://localhost:8081").replace(/\/$/, ""),
  driver: (process.env.DRIVER_URL || "http://localhost:8082").replace(/\/$/, ""),
};

const ADMIN_STATE = path.join(REPO, "admin", "e2e", ".auth", "admin.json");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** `--anahtar değer` ve `--bayrak` biçimli argümanlar. */
function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function usage(script, extra = "") {
  console.error(`Kullanım: node ${script} --out <before|after> [--only <ekran-adı>[,<ekran-adı>...]]${extra}`);
  process.exit(2);
}

/** `--out` zorunlu; yalnızca before veya after. */
function requireOut(args, script, extra) {
  if (args.out !== "before" && args.out !== "after") usage(script, extra);
  return args.out;
}

/** `--only` listesi; boşsa her ekran seçilidir. Ekran adı tam eşleşir veya `-<ad>` ile biter. */
function makeFilter(args, { suffix = false } = {}) {
  const list = typeof args.only === "string" ? args.only.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return {
    list,
    all: list.length === 0,
    want(name) {
      if (list.length === 0) return true;
      return list.some((p) => name === p || (suffix && name.endsWith(`-${p}`)));
    },
    /** Verilen adlardan biri seçili mi? */
    wantAny(names) {
      return names.some((n) => this.want(n));
    },
  };
}

function chromiumPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  if (process.env.LOCALAPPDATA) {
    const p = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1248", "chrome-win64", "chrome.exe");
    if (fs.existsSync(p)) return p;
  }
  return undefined; // playwright-core varsayılanı
}

// --ios: Safari motoru (WebKit) ve iPhone 15 cihaz profili. Yerel iOS simülatörü değildir;
// iOS Safari'deki çizim, yazı tipi ve dokunma davranışını yaklaşık gösterir (docs/test_senaryolari.md).
const IPHONE = devices["iPhone 15"];

function launch({ ios = false } = {}) {
  if (ios) return webkit.launch();
  const executablePath = chromiumPath();
  return chromium.launch(executablePath ? { executablePath } : {});
}

function outDir(out, surface) {
  const dir = path.join(REPO, "docs", "ui-review", "screenshots", out, surface);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function hasAdminState() {
  return fs.existsSync(ADMIN_STATE);
}

module.exports = { IPHONE, REPO, URLS, ADMIN_STATE, AXE_TAGS, parseArgs, usage, requireOut, makeFilter, launch, outDir, hasAdminState };
