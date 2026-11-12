// Backend yanıt tipleri (backend/app/api/schemas.py). Tutarlar metin olarak gelir.

export type Currency = "EUR" | "TRY";
export type BookingStatus =
  | "odeme_bekliyor"
  | "onaylandi"
  | "atandi"
  | "yolculukta"
  | "tamamlandi"
  | "iptal"
  | "odeme_basarisiz";
export type LegStatus = "beklemede" | "atandi" | "yolda" | "vardi" | "basladi" | "bitti" | "iptal";

export interface Region {
  id: number;
  code: string;
  province: string;
  name: string;
  type: "ilce" | "havalimani";
  iata_code: string | null;
  latitude: string;
  longitude: string;
}

export interface VehicleType {
  id: number;
  code: string;
  name: string;
  capacity: number;
  luggage_capacity: number;
}

export interface Place {
  region_id?: number;
  place_token?: string;
  address?: string | null;
}

export interface PlaceSuggestion {
  place_id: string;
  title: string;
  subtitle: string;
}

export interface PlaceDetails {
  place_token: string;
  address: string;
  lat: string;
  lng: string;
  region: Region;
}

/** Rota noktası: adres aramasından (imzalı jeton) veya doğrudan ilçe/havalimanı seçimi. */
export interface Endpoint {
  label: string;
  region: Region;
  place_token?: string;
  /** Adres aramasından seçilen yerin konumu (harita için); yoksa bölge merkezi kullanılır. */
  point?: { lat: number; lng: number };
}

export interface QuoteRequest {
  pickup: Place;
  dropoff: Place;
  vehicle_type_code: string;
  pickup_at: string;
  return_pickup_at?: string | null;
  passenger_count: number;
  luggage_count: number;
  country_code?: string | null;
  with_guarantee: boolean;
}

export interface QuoteLeg {
  pickup_region_id: number;
  dropoff_region_id: number;
  pickup_at: string;
  distance_km: string;
  duration_minutes: number;
  price: string;
  /** Google encoded polyline (hassasiyet 5): haritada gerçek rota. */
  route_polyline?: string | null;
}

export interface Quote {
  vehicle_type_code: string;
  is_round_trip: boolean;
  legs: QuoteLeg[];
  price: string;
  guarantee_fee: string;
  total: string;
  currency: Currency;
  guarantee_available: boolean;
}

export interface BookingCreate extends QuoteRequest {
  booking_type: "anlik" | "planli";
  expected_total: string;
  passenger_name: string;
  note?: string | null;
  flights: { leg_order: number; flight_no: string }[];
  locale: string;
  child_seat_count?: number;
  market_stop?: boolean;
  accept_disclosure: boolean;
  accept_distance_sales: boolean;
}

export interface BookingLeg {
  id: string;
  leg_order: number;
  status: LegStatus;
  pickup_region: Region;
  dropoff_region: Region;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_at: string;
  distance_km: string;
  duration_minutes: number | null;
  flight: {
    flight_no: string;
    direction: string;
    scheduled_at: string | null;
    estimated_at: string | null;
    status?: string | null;
  } | null;
  driver: DriverBrief | null;
  passenger_status?: string | null;
}

/** Müşteriye gösterilen sürücü kartı (K-62). */
export interface DriverBrief {
  first_name: string;
  vehicle: string;
  plate: string;
  color?: string | null;
  languages: string[];
  has_photo: boolean;
}

export interface Booking {
  id: string;
  booking_code: string;
  booking_type: "anlik" | "planli";
  status: BookingStatus;
  vehicle_type: VehicleType;
  passenger_name: string;
  passenger_count: number;
  luggage_count: number;
  child_seat_count?: number;
  market_stop?: boolean;
  share_active?: boolean;
  is_round_trip: boolean;
  note: string | null;
  quoted_price: string;
  guarantee_fee: string;
  total_amount: string;
  currency: Currency;
  created_at: string;
  cancelled_at: string | null;
  legs: BookingLeg[];
}

export interface RefundQuote {
  hours_left: string;
  refund_percent: number;
  refund_amount: string;
  guarantee_applied: boolean;
  currency: Currency;
}

export interface Checkout {
  payment_id: string;
  iframe_url: string;
  amount: string;
  currency: Currency;
}

export interface Profile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  country_code: string | null;
  locale: string;
  currency: Currency;
}

export interface DataRequest {
  id: string;
  request_type: "erisim" | "silme" | "duzeltme";
  status: string;
  due_at: string;
  completed_at: string | null;
}

export interface DriverLocation {
  leg_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  at: string;
}

/** Yolculuk sohbeti (K-50). */
export interface ChatMessage {
  id: string;
  sender: "customer" | "driver";
  body: string;
  created_at: string;
  read_at: string | null;
  /** K-62: alıcının diline çeviri (karşı tarafın mesajında). */
  translated_body?: string | null;
  translated_lang?: string | null;
}

export interface Chat {
  open: boolean;
  unread: number;
  other_name: string;
  messages: ChatMessage[];
}

/** Sürücünün tahmini varışı (K-51): yolcu alınana kadar alışa, yolculukta varışa dakika. */
export interface TripEta {
  leg_id: string | null;
  status: LegStatus | null;
  eta_minutes: number | null;
}

/** K-62 buluşma rehberi. */
export interface MeetingGuide {
  airport: string | null;
  guides: { id: number; terminal: string; steps: { text: string; photo_path: string | null }[] }[];
}

export interface ShareLink {
  token: string;
  url: string;
}

export interface Rating {
  leg_id: string | null;
  rated: boolean;
  stars: number | null;
  tip_amount: string | null;
  tip_status: string | null;
  currency: Currency;
  tip_max: string;
  tip_suggestions: string[];
  iframe_url: string | null;
}

/** Girişsiz takip sayfası (K-62). */
export interface TrackInfo {
  status: LegStatus;
  pickup_region: string;
  dropoff_region: string;
  pickup_at: string;
  flight_no: string | null;
  flight_status: string | null;
  flight_estimated_at: string | null;
  passenger_status: string | null;
  driver: DriverBrief | null;
  eta_minutes: number | null;
  location: { lat: number; lng: number; heading: number | null; at: string } | null;
  locale: string;
}
