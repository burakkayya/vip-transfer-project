// Araç tipi görselleri. Yeni eklenen tipte görsel yoksa ikon gösterilir. Minibüs varsayılanı beyazdır.
export const VEHICLE_IMAGE: Record<string, number> = {
  minivan: require("@/assets/images/minivan.jpg"),
  vip_van: require("@/assets/images/vip_van.jpg"),
  minibus: require("@/assets/images/minibus.jpg"),
};

export const VEHICLE_ICON: Record<string, "car-outline" | "car-sport-outline" | "bus-outline"> = {
  minivan: "car-outline",
  vip_van: "car-sport-outline",
  minibus: "bus-outline",
};
