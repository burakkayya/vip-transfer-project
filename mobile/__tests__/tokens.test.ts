/**
 * K-38: mobil renkler tek kaynaktan (kök DESIGN.md → lib/tokens.ts) gelir. Ekran ve bileşenlerde sabit renk
 * yazılmaz; anlamsal `colors` nesnesi `palette` değerlerine bağlıdır.
 */
import { colors } from "@/components/ui";
import { palette } from "@/lib/tokens";

// Mobil projede Node tipleri yok; test Jest'in Node ortamında çalışır.
declare const __dirname: string;
declare function require(id: string): unknown;
type Dirent = { name: string; isDirectory(): boolean };
const fs = require("fs") as {
  readdirSync(p: string, o: { withFileTypes: true }): Dirent[];
  readFileSync(p: string, enc: "utf8"): string;
};
const path = require("path") as { resolve(...p: string[]): string; join(...p: string[]): string; posix: { join(...p: string[]): string } };

const ROOT = path.resolve(__dirname, "..");
// Harita stili Google'ın kendi renk şemasıdır (su, park); token kapsamı dışında.
const ALLOWED = new Set(["lib/tokens.ts", "components/GoogleMapWeb.tsx"]);
const HEX = /#[0-9a-fA-F]{6}\b/g;

function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e: Dirent) => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return files(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}

test("ekran ve bileşenlerde 6 haneli sabit renk yok", () => {
  const offenders: string[] = [];
  for (const f of ["app", "components", "lib"].flatMap(files)) {
    if (ALLOWED.has(f)) continue;
    fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").forEach((line: string, i: number) => {
      if (line.match(HEX)) offenders.push(`${f}:${i + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});

test("anlamsal renkler token paletinden gelir", () => {
  const values = new Set<string>(Object.values(palette));
  for (const [name, value] of Object.entries(colors)) {
    expect([name, values.has(value)]).toEqual([name, true]);
  }
  expect(colors.ink).toBe(palette.lacquerBlack);
  expect(colors.accent).toBe(palette.champagneBrass);
});

test("bildirim widget'ları yalnızca token renklerini kullanır", () => {
  // Widget ayrı derlenir, tokens.ts'i içe aktaramaz; değerler elle eşlenir. Koyu kilit ekranında ikincil
  // metin için sistem grisi (#8a8a8a) ve beyaz serbesttir.
  const allowed = new Set<string>([...Object.values(palette), "#8a8a8a", "#ffffff"]);
  for (const f of ["widgets/TripActivity.tsx", "widgets/TripNotification.tsx"]) {
    const found = fs.readFileSync(path.join(ROOT, f), "utf8").match(HEX) ?? [];
    expect([f, found.filter((c: string) => !allowed.has(c.toLowerCase()))]).toEqual([f, []]);
  }
});
