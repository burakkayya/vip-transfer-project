// Araç tipi görselleri: aynı tuvalde, gövde genişliği ve tekerlek çizgisi eşit. Görseli olmayan tipte ikon gösterilir.
export const VEHICLE_IMAGE: Record<string, number> = {
  minivan: require("@/assets/images/minivan.jpg"),
  vip_van: require("@/assets/images/vip_van.jpg"),
  minibus: require("@/assets/images/minibus.jpg"),
  vip_minibus: require("@/assets/images/vip_minibus.jpg"),
};

export const VEHICLE_ICON: Record<string, "car-outline" | "car-sport-outline" | "bus-outline"> = {
  minivan: "car-outline",
  vip_van: "car-sport-outline",
  minibus: "bus-outline",
  vip_minibus: "bus-outline",
};
