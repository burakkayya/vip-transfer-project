# Lint taban çizgisi

ESLint 9 (flat config; `next/core-web-vitals` + `plugin:jsx-a11y/recommended`) ile ölçülen mevcut ihlaller. Bunlar düzeltilmedi ve susturulmadı; ekran görevleri ilgili dosyaya dokunduğunda giderilir, plan kapanışında lint sıfır ihlalle zorunlu olur.

Ölçüm tarihi: 2026-11-02, dal `chore/ui-infra`. Komut: `cd web && npx eslint .`

## web

Özet: 3 hata, 4 uyarı, 4 dosya (`npm run lint` rc=1). **Güncel (2026-11-02, B-W2 sonrası): 1 hata, 0 uyarı, 1 dosya** (`BookingWizard.tsx` satırları B-W2'de giderildi).

| Dosya | Kural | Önem | Adet |
|---|---|---|---|
| `web/components/OtpLogin.tsx` | `jsx-a11y/no-autofocus` | hata | 1 |

Not: `web/next.config.ts` içinde `eslint.ignoreDuringBuilds: true` vardır; aksi halde hatalar `next build`'i düşürür. Lint ayrıca `npm run lint` ile çalıştırılır.

## admin

Özet: 1 hata, 2 uyarı, 2 dosya (`npm run lint` rc=1). Ölçüm: 2026-11-02, dal `chore/ui-infra`. Komut: `cd admin && npx eslint .`

| Dosya | Kural | Önem | Adet |
|---|---|---|---|
| `admin/app/login/page.tsx` | `@next/next/no-img-element` | uyarı | 1 |
| `admin/app/login/page.tsx` | `jsx-a11y/no-autofocus` | hata | 1 |
| `admin/components/DocumentReview.tsx` | `@next/next/no-img-element` | uyarı | 1 |

Not: `admin/next.config.ts` içinde `eslint.ignoreDuringBuilds: true` vardır; aksi halde login sayfasındaki hata `next build`'i düşürür.

## mobile

Özet: 7 hata, 2 uyarı, 6 dosya (`npm run lint` rc=1). Ölçüm: 2026-11-02, dal `chore/ui-infra`. Komut: `cd mobile && npx eslint .` (`eslint-config-expo/flat`, ESLint 9; React Compiler kuralları `react-hooks/*` dahil).

| Dosya | Kural | Önem | Adet |
|---|---|---|---|
| `mobile/app/(driver)/home.tsx` | `react-hooks/purity` | hata | 1 |
| `mobile/app/booking/[code].tsx` | `react-hooks/set-state-in-effect` | hata | 1 |
| `mobile/app/driver-register.tsx` | `@typescript-eslint/no-unused-vars` | uyarı | 1 |
| `mobile/app/trip/[legId].tsx` | `@typescript-eslint/no-unused-vars` | uyarı | 1 |
| `mobile/app/trip/[legId].tsx` | `react-hooks/set-state-in-effect` | hata | 2 |
| `mobile/components/AddressField.tsx` | `react-hooks/set-state-in-effect` | hata | 1 |
| `mobile/components/ui.tsx` | `react-hooks/immutability` | hata | 2 |

Not: `ui.tsx` içindeki `immutability` hataları `Button`'daki `scale.value = withSpring(...)` atamalarıdır (Reanimated paylaşımlı değer deseni); düzeltme ekran görevinde yapılır.
