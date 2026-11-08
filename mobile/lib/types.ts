// Backend yanıt tipleri (backend/app/api/schemas.py, driver.py). Tutarlar metin olarak gelir.

export type Currency = "EUR" | "TRY";

export interface Region {
  id: number;
  code: string;
  province: string;
  name: string;
  type: "ilce" | "havalimani";
  iata_code: string | null;
  latitude?: string;
  longitude?: string;
}

export interface VehicleType {
  id: number;
  code: string;
  name: string;
  capacity: number;
  luggage_capacity: number;
}

export interface Quote {
  vehicle_type_code: string;
  is_round_trip: boolean;
  legs: { pickup_region_id: number; dropoff_region_id: number; pickup_at: string; distance_km: string; duration_minutes: number; price: string; route_polyline?: string | null }[];
  price: string;
  guarantee_fee: string;
  total: string;
  currency: Currency;
  guarantee_available: boolean;
}

export interface BookingLeg {
  id: string;
  leg_order: number;
  status: string;
  pickup_region: Region;
  dropoff_region: Region;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_at: string;
  flight: { flight_no: string } | null;
  driver: { first_name: string; vehicle: string; plate: string } | null;
  /** Ayağın rota çizgisi (Google encoded polyline). Yalnız detay ucunda dolu; listelerde null. */
  route_polyline?: string | null;
}

export interface Booking {
  id: string;
  booking_code: string;
  booking_type: "anlik" | "planli";
  status: string;
  vehicle_type: VehicleType;
  passenger_name: string;
  passenger_count: number;
  luggage_count: number;
  total_amount: string;
  currency: Currency;
  created_at: string;
  legs: BookingLeg[];
}

export interface RefundQuote {
  refund_percent: number;
  refund_amount: string;
  guarantee_applied: boolean;
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

export interface DriverLocation {
  lat: number;
  lng: number;
  at: string;
}

// --- Sürücü ------------------------------------------------------------------

export interface DriverMe {
  id: string;
  full_name: string;
  status: "basvuru" | "onayli" | "askida" | "pasif";
  is_online: boolean;
  missing_documents: string[];
}

export interface Trip {
  leg_id: string;
  booking_code: string;
  status: string;
  pickup_at: string;
  pickup_region: string;
  dropoff_region: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: string | null;
  pickup_lng: string | null;
  passenger_name: string;
  passenger_count: number;
  luggage_count: number;
  flight_no: string | null;
  driver_amount: string;
  currency: Currency;
  /** Rota çizgisi (Google encoded polyline). Tekil yolculuk, teklif kabulü ve olaylarda dolu; listelerde null. */
  route_polyline?: string | null;
  booking_type?: "anlik" | "planli";
  dropoff_lat?: string | null;
  dropoff_lng?: string | null;
  distance_km?: string | null;
  duration_minutes?: number | null;
}

export interface Offer {
  offer_id: string;
  expires_at: string;
  trip: Trip;
}

export interface DriverVehicle {
  id: string;
  plate: string;
  vehicle_type_code: string;
  brand: string;
  model: string;
  capacity: number;
  status: string;
  missing_documents: string[];
}

export interface DriverDocument {
  id: string;
  owner_type: "driver" | "vehicle";
  owner_id: string;
  doc_type: string;
  valid_until: string | null;
  status: string;
  created_at: string;
}

export interface Earnings {
  pending_try: string;
  paid_try: string;
  entries: { id: string; net_amount: string; currency: Currency; net_amount_try: string | null; status: string; created_at: string }[];
}

// --- Adres -------------------------------------------------------------------

export interface PlaceSuggestion {
  place_id: string;
  title: string;
  subtitle: string;
}

export interface PlaceDetails {
  place_token: string;
  address: string;
  lat?: string;
  lng?: string;
  region: Region;
}

/** Rota noktası: adres aramasından (imzalı jeton) veya doğrudan havalimanı/ilçe seçimi. */
export interface Endpoint {
  label: string;
  region: Region;
  place_token?: string;
  /** Seçilen adresin tam konumu (adres aramasından); yoksa bölge merkezi kullanılır. */
  point?: { latitude: number; longitude: number };
}

// --- Uber tarzı akış (K-47..K-51) ---------------------------------------------

/** Kabul öncesi havuz işi: yolcu adı kısaltılmış, adres yok, harita uçları kırpılmış. */
export interface Job {
  leg_id: string;
  booking_code: string;
  booking_type: "anlik" | "planli";
  pickup_at: string;
  pickup_region: string;
  dropoff_region: string;
  passenger_initial: string;
  passenger_count: number;
  luggage_count: number;
  has_flight: boolean;
  vehicle_type: string;
  distance_km: string;
  duration_minutes: number | null;
  driver_amount: string;
  currency: Currency;
  pickup_distance_km: string | null;
  offer_expires_at: string | null;
  preview_polyline: string | null;
}

export interface Approach {
  target: "pickup" | "dropoff";
  target_lat: number;
  target_lng: number;
  polyline: string | null;
  distance_km: string | null;
  duration_minutes: number | null;
  finish_distance_m: number | null;
  finish_radius_m: number | null;
}

export interface ChatMessage {
  id: string;
  sender: "customer" | "driver";
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface Chat {
  open: boolean;
  unread: number;
  other_name: string;
  messages: ChatMessage[];
}

export interface TripUpdate {
  id: string;
  code: string;
  title: string;
  body: string;
  data: { type?: string; booking_code?: string; leg_id?: string };
  created_at: string;
}

export interface Eta {
  leg_id: string | null;
  status: string | null;
  eta_minutes: number | null;
  location: DriverLocation | null;
}
