#!/usr/bin/env node
// Lint taban çizgisi denetimi (CI). ESLint ihlal sayısı `scripts/lint-baseline.json` içindeki
// sınırı aşarsa başarısız olur; sayı düştüyse sınırın da düşürülmesini ister (taban yalnızca iner).
// Kullanım: node scripts/lint-baseline.mjs <web|admin|mobile>
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = process.argv[2];
const baseline = JSON.parse(readFileSync(path.join(root, "scripts", "lint-baseline.json"), "utf8"));
if (!baseline[project]) {
  console.error(`Bilinmeyen proje: ${project}. Seçenekler: ${Object.keys(baseline).join(", ")}`);
  process.exit(2);
}

const cwd = path.join(root, project);
const eslint = path.join(cwd, "node_modules", "eslint", "bin", "eslint.js");
const run = spawnSync(process.execPath, [eslint, ".", "-f", "json"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
let results;
try {
  results = JSON.parse(run.stdout);
} catch {
  console.error("ESLint çıktısı okunamadı:\n" + (run.stderr || run.stdout));
  process.exit(2);
}

let errors = 0;
let warnings = 0;
for (const file of results) {
  errors += file.errorCount;
  warnings += file.warningCount;
  for (const m of file.messages) {
    const level = m.severity === 2 ? "hata" : "uyarı";
    console.log(`${path.relative(root, file.filePath)}:${m.line}:${m.column} ${level} ${m.ruleId ?? ""} ${m.message}`);
  }
}

const max = baseline[project];
console.log(`\n${project}: ${errors} hata, ${warnings} uyarı (taban: ${max.errors} hata, ${max.warnings} uyarı)`);
if (errors > max.errors || warnings > max.warnings) {
  console.error("Lint ihlali taban çizgisini aştı. Yeni ihlali düzeltin.");
  process.exit(1);
}
if (errors < max.errors || warnings < max.warnings) {
  console.error(`İhlal sayısı düştü. scripts/lint-baseline.json içinde "${project}" değerini ${errors}/${warnings} yapın.`);
  process.exit(1);
}
console.log("Taban çizgisi korunuyor.");
