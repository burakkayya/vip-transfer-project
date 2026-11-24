import { flightChip } from "@/lib/driverLabels";

describe("flightChip (teklif kartı uçuş etiketi)", () => {
  it("durum yoksa eski etikete düşer", () => {
    expect(flightChip(null, null)).toBe("Uçuş var");
    expect(flightChip("bilinmiyor", "2026-11-25T10:00:00Z")).toBe("Uçuş var");
  });
  it("durum ve tahmini inişi gösterir, uçuş numarası içermez", () => {
    const text = flightChip("rotarli", "2026-11-25T10:00:00Z");
    expect(text).toMatch(/^Uçuş · Rötarlı · tahmini iniş \d{2}:\d{2}$/);
    expect(flightChip("indi", "2026-11-25T10:00:00Z")).toMatch(/Uçuş · İndi · iniş \d{2}:\d{2}$/);
  });
  it("iptal, yönlendirme ve saat yokken saat yazılmaz", () => {
    expect(flightChip("iptal", "2026-11-25T10:00:00Z")).toBe("Uçuş · İptal edildi");
    expect(flightChip("yonlendirildi", null)).toBe("Uçuş · Yönlendirildi");
    expect(flightChip("planlandi", null)).toBe("Uçuş · Zamanında");
  });
});
