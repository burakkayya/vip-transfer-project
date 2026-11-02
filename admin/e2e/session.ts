import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const AUTH_FILE = resolve(__dirname, ".auth/admin.json");
export const ENV_FILE = resolve(__dirname, "../.env.e2e.local");
export const SKIP_MESSAGE = "ADMIN_E2E_* tanımlı değil";

/** E-posta ve parola yerel ortamda tanımlı mı (admin/.env.e2e.local veya ortam değişkeni)? */
export function hasCredentials(): boolean {
  return Boolean(process.env.ADMIN_E2E_EMAIL && process.env.ADMIN_E2E_PASSWORD);
}

/** Oturum dosyası yoksa boş bir tane yazar; böylece bağımlı projeler dosya bulunamadı hatası vermez. */
export function writeEmptyState(): void {
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
}
