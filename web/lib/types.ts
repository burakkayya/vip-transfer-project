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
  flight: { flight_no: string; direction: string; scheduled_at: string | null; estimated_at: string | null } | null;
  driver: { first_name: string; vehicle: string; plate: string } | null;
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
