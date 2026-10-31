// Araç tipi görselleri (public/images). Admin yeni bir araç tipi eklerse görsel yoksa ikon gösterilir.
// Minibüs filoda beyaz (standart) ve siyah olarak bulunur; ilk görsel varsayılandır.
const VARIANTS: Record<string, { key: "white" | "black"; image: string }[]> = {
  minivan: [{ key: "white", image: "/images/fleet-minivan.webp" }],
  vip_van: [{ key: "black", image: "/images/fleet-vip_van.webp" }],
  minibus: [
    { key: "white", image: "/images/fleet-minibus.webp" },
    { key: "black", image: "/images/fleet-minibus_vip.webp" },
  ],
};

export function vehicleVariants(code: string) {
  return VARIANTS[code] ?? [];
}

export function vehicleImage(code: string): string | null {
  return VARIANTS[code]?.[0]?.image ?? null;
}
