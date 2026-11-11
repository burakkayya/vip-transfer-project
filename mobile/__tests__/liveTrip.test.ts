// K-59: yolculuk durumu canlı etkinliği (iOS Canlı Etkinlik, Android kalıcı bildirim).
import { Platform } from "react-native";
import { customerLiveProps, driverLiveProps, endLiveTrip, shortName, showLiveTrip } from "@/lib/liveTrip";

// jest.mock çağrıları içe aktarmalardan önce çalışır (babel-jest öne taşır).

const mockPost = jest.fn(async () => ({}));
const mockGetActive = jest.fn(async (): Promise<unknown[]> => [{}]);
const mockCancelAll = jest.fn(async () => undefined);
jest.mock("@/widgets/TripNotification", () => ({ __esModule: true, default: { post: mockPost, getActive: mockGetActive, cancelAll: mockCancelAll } }));
const mockUpdate = jest.fn(async () => undefined);
const mockEnd = jest.fn(async () => undefined);
const mockStart = jest.fn(() => ({ update: mockUpdate, end: mockEnd }));
jest.mock("@/widgets/TripActivity", () => ({ __esModule: true, default: { start: mockStart, getInstances: () => [] } }));
jest.mock("expo-widgets", () => ({ after: (d: Date) => ({ after: d }) }));
jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "tr", languageTag: "tr-TR" }] }));


const driver = { first_name: "Mehmet", vehicle: "Mercedes-Benz Vito", plate: "07GA001" };
const base = { bookingStatus: "atandi", from: "Antalya Havalimanı", to: "Kemer", driver, etaMinutes: null };

describe("customerLiveProps", () => {
  test("ödeme bekleyen ve iptal edilen rezervasyonda gösterim yok", () => {
    expect(customerLiveProps({ ...base, bookingStatus: "odeme_bekliyor", legStatus: "beklemede" })).toBeNull();
    expect(customerLiveProps({ ...base, bookingStatus: "iptal", legStatus: "iptal" })).toBeNull();
  });

  test("aşamalar ilerledikçe başlık, süre ve ilerleme değişir", () => {
    const searching = customerLiveProps({ ...base, bookingStatus: "onaylandi", legStatus: "beklemede", driver: null })!;
    expect(searching.props.title).toBe("Sürücü aranıyor");
    expect(searching.props.detail).toBe("Antalya Havalimanı → Kemer");

    const assigned = customerLiveProps({ ...base, legStatus: "atandi" })!;
    expect(assigned.props).toMatchObject({ title: "Sürücü atandı", detail: "Mehmet · 07GA001 · Mercedes-Benz Vito", eta: "" });

    const onTheWay = customerLiveProps({ ...base, legStatus: "yolda", etaMinutes: 8 })!;
    expect(onTheWay.props).toMatchObject({ title: "Sürücü yolda", eta: "8 dk" });
    expect(onTheWay.props.progress).toBeGreaterThan(assigned.props.progress);

    expect(customerLiveProps({ ...base, legStatus: "vardi" })!.props.eta).toBe("Geldi");
    const onboard = customerLiveProps({ ...base, bookingStatus: "yolculukta", legStatus: "basladi", etaMinutes: 40 })!;
    expect(onboard.props).toMatchObject({ title: "Yolculuktasınız", detail: "→ Kemer", eta: "40 dk" });

    const done = customerLiveProps({ ...base, bookingStatus: "tamamlandi", legStatus: "bitti" })!;
    expect(done.done).toBe(true);
    expect(done.props.progress).toBe(1);
  });
});

describe("zamanlama ve KVKK", () => {
  const now = Date.parse("2026-11-10T10:00:00Z");
  test("planlı işte etkinlik alışa 90 dk kala başlar; anlık işte hemen", () => {
    const far = { ...base, legStatus: "atandi", bookingType: "planli", pickupAt: "2026-11-12T10:00:00Z", now };
    expect(customerLiveProps(far)).toBeNull();
    expect(customerLiveProps({ ...far, pickupAt: "2026-11-10T11:00:00Z" })).not.toBeNull();
    expect(customerLiveProps({ ...far, bookingType: "anlik" })).not.toBeNull();
    // Sürücü yola çıktıysa zaman fark etmez.
    expect(customerLiveProps({ ...far, legStatus: "yolda" })).not.toBeNull();
    const d = { pickup: "AYT", dropoff: "Kemer", passenger: "Ayşe Yılmaz", pickupTime: "", etaMinutes: null, now };
    expect(driverLiveProps({ ...d, status: "atandi", pickupAt: "2026-11-12T10:00:00Z" })).toBeNull();
  });

  test("sürücü kilit ekranında yolcunun yalnızca adı ve baş harfi", () => {
    expect(shortName("Ayşe Nur Yılmaz")).toBe("Ayşe Y.");
    expect(shortName("Anna")).toBe("Anna");
    const d = { pickup: "AYT", dropoff: "Kemer", passenger: "Ayşe Yılmaz", pickupTime: "", etaMinutes: null };
    expect(driverLiveProps({ ...d, status: "vardi" })!.props.detail).toBe("Yolcu: Ayşe Y.");
  });
});

describe("driverLiveProps", () => {
  const d = { pickup: "Antalya Havalimanı", dropoff: "Kemer Marina", passenger: "Test Yolcu", pickupTime: "10 Kas 17:32", etaMinutes: 12 };
  test("sürücü aşamaları", () => {
    expect(driverLiveProps({ ...d, status: "atandi" })!.props.title).toBe("Yeni iş atandı");
    expect(driverLiveProps({ ...d, status: "yolda" })!.props).toMatchObject({ title: "Alışa gidiyorsunuz", eta: "12 dk", role: "driver" });
    expect(driverLiveProps({ ...d, status: "vardi" })!.props.detail).toBe("Yolcu: Test Y.");
    expect(driverLiveProps({ ...d, status: "basladi" })!.props.detail).toBe("→ Kemer Marina");
    expect(driverLiveProps({ ...d, status: "bitti" })!.done).toBe(true);
    expect(driverLiveProps({ ...d, status: "iptal" })).toBeNull();
  });
});

describe("Android kalıcı bildirim", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
  });

  test("kaydırılamaz bildirim tek kimlikle yerinde güncellenir, aynı içerik tekrar gönderilmez", async () => {
    const p = customerLiveProps({ ...base, legStatus: "yolda", etaMinutes: 8 })!.props;
    await showLiveTrip("GA1", p, "getaway://booking/GA1");
    await showLiveTrip("GA1", p, "getaway://booking/GA1");
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(p, expect.objectContaining({ id: "trip-live", ongoing: true, url: "getaway://booking/GA1" }));
    await showLiveTrip("GA1", { ...p, eta: "7 dk" });
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  test("bitince son durum kapatılabilir hale gelir; iptalde kaldırılır", async () => {
    const done = customerLiveProps({ ...base, bookingStatus: "tamamlandi", legStatus: "bitti" })!.props;
    await endLiveTrip("GA1", done);
    expect(mockPost).toHaveBeenCalledWith(done, expect.objectContaining({ ongoing: false, autoCancel: true }));
    await showLiveTrip("GA2", done);
    await endLiveTrip("GA2");
    expect(mockCancelAll).toHaveBeenCalled();
  });

  test("uygulama yeniden başlasa da başka yolculuğun ekranı açık etkinliği kapatmaz", async () => {
    const p = customerLiveProps({ ...base, legStatus: "yolda", etaMinutes: 3 })!.props;
    await showLiveTrip("AKTIF", p);
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fresh = require("@/lib/liveTrip") as typeof import("@/lib/liveTrip");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Object.defineProperty(require("react-native").Platform, "OS", { value: "android", configurable: true });
    // Gerçek cihazda güvenli depo yeniden başlatmada korunur; sıfırlanan sahte depoya aynı kayıt yazılır.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await require("expo-secure-store").setItemAsync("ga_live_trip", "AKTIF");
    mockPost.mockClear();
    mockCancelAll.mockClear();
    await fresh.endLiveTrip("ESKI_TAMAMLANAN", customerLiveProps({ ...base, bookingStatus: "tamamlandi", legStatus: "bitti" })!.props);
    await fresh.endLiveTrip("ESKI_IPTAL");
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockCancelAll).not.toHaveBeenCalled();
    await fresh.endLiveTrip("AKTIF");
    expect(mockCancelAll).toHaveBeenCalled();
    await endLiveTrip("AKTIF"); // ilk modül örneğinin bellek durumu da temizlensin
  });

  test("etkin bildirim yoksa geçmiş rezervasyon yeni bildirim açmaz", async () => {
    mockGetActive.mockResolvedValueOnce([]);
    await endLiveTrip("ESKI", customerLiveProps({ ...base, bookingStatus: "tamamlandi", legStatus: "bitti" })!.props);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe("iOS Canlı Etkinlik", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    Object.defineProperty(Platform, "Version", { value: "26.0", configurable: true });
  });

  test("ilk durumda başlatılır, sonra güncellenir, bitince kalır", async () => {
    const p = customerLiveProps({ ...base, legStatus: "atandi" })!.props;
    await showLiveTrip("GA3", p, "getaway://booking/GA3");
    expect(mockStart).toHaveBeenCalledWith(p, "getaway://booking/GA3");
    const p2 = customerLiveProps({ ...base, legStatus: "yolda", etaMinutes: 5 })!.props;
    await showLiveTrip("GA3", p2);
    expect(mockUpdate).toHaveBeenCalledWith(p2);
    const done = customerLiveProps({ ...base, bookingStatus: "tamamlandi", legStatus: "bitti" })!.props;
    await endLiveTrip("GA3", done);
    expect(mockEnd).toHaveBeenCalledWith(expect.objectContaining({ after: expect.any(Date) }), done, expect.any(Date));
  });

  test("eski iOS sürümünde hiçbir şey yapılmaz", async () => {
    Object.defineProperty(Platform, "Version", { value: "16.1", configurable: true });
    await showLiveTrip("GA4", customerLiveProps({ ...base, legStatus: "atandi" })!.props);
    expect(mockStart).not.toHaveBeenCalled();
  });
});
