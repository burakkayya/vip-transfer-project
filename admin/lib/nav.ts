// Menü ve sayfa yetkileri backend rol kontrollerini izler (backend/app/api/deps.py). Admin her yere erişir.

export type Role = "admin" | "operasyon" | "muhasebe" | "destek";

export interface NavItem {
  href: string;
  label: string;
  roles: Role[];
  group: string;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Genel panel", roles: ["operasyon", "destek"], group: "Operasyon" },
  { href: "/bookings", label: "Rezervasyonlar", roles: ["operasyon", "destek"], group: "Operasyon" },
  { href: "/dispatch", label: "Eşleştirme", roles: ["operasyon"], group: "Operasyon" },
  { href: "/trip-reviews", label: "Müşteri bitirişleri", roles: ["operasyon", "destek"], group: "Operasyon" },
  { href: "/drivers", label: "Sürücüler", roles: ["operasyon"], group: "Filo" },
  { href: "/vehicles", label: "Araçlar ve tipler", roles: ["operasyon"], group: "Filo" },
  { href: "/documents", label: "Belge takibi", roles: ["operasyon"], group: "Filo" },
  { href: "/regions", label: "Bölgeler", roles: ["operasyon"], group: "Katalog" },
  { href: "/popular-places", label: "Popüler yerler", roles: ["operasyon"], group: "Katalog" },
  { href: "/pricing", label: "Fiyatlandırma", roles: ["operasyon"], group: "Katalog" },
  { href: "/commission", label: "Komisyon kuralları", roles: ["muhasebe"], group: "Katalog" },
  { href: "/exchange-rates", label: "Döviz kuru", roles: ["muhasebe"], group: "Finans" },
  { href: "/payments", label: "Ödemeler ve iadeler", roles: ["muhasebe"], group: "Finans" },
  { href: "/payouts", label: "Sürücü hakedişleri", roles: ["muhasebe"], group: "Finans" },
  { href: "/invoices", label: "Faturalar", roles: ["muhasebe"], group: "Finans" },
  { href: "/customers", label: "Müşteriler", roles: ["operasyon", "destek"], group: "Müşteri" },
  { href: "/data-requests", label: "KVKK veri talepleri", roles: ["operasyon", "destek"], group: "Müşteri" },
  { href: "/templates", label: "Bildirim şablonları", roles: ["operasyon"], group: "Sistem" },
  { href: "/users", label: "Kullanıcılar ve roller", roles: [], group: "Sistem" },
  { href: "/audit-logs", label: "Denetim kayıtları", roles: ["operasyon", "muhasebe", "destek"], group: "Sistem" },
  { href: "/settings", label: "Sistem ayarları", roles: [], group: "Sistem" },
];

export function can(userRoles: string[], allowed: Role[]): boolean {
  return userRoles.includes("admin") || allowed.some((r) => userRoles.includes(r));
}

export function allowedNav(userRoles: string[]): NavItem[] {
  return NAV.filter((n) => can(userRoles, n.roles));
}

export function itemFor(pathname: string): NavItem | undefined {
  return [...NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((n) => (n.href === "/" ? pathname === "/" : pathname === n.href || pathname.startsWith(n.href + "/")));
}
