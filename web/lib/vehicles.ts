// Araç tipi görselleri (public/images). Admin yeni bir araç tipi eklerse görsel yoksa ikon gösterilir.
const IMAGES: Record<string, string> = {
  minivan: "/images/fleet-minivan.webp",
  vip_van: "/images/fleet-vip_van.webp",
  minibus: "/images/fleet-minibus.webp",
};

export function vehicleImage(code: string): string | null {
  return IMAGES[code] ?? null;
}
