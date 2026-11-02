import { decodePolyline } from "@/lib/polyline";

test("decodes the Google reference polyline", () => {
  expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
    { latitude: 38.5, longitude: -120.2 },
    { latitude: 40.7, longitude: -120.95 },
    { latitude: 43.252, longitude: -126.453 },
  ]);
});

test("returns an empty list for an empty string", () => {
  expect(decodePolyline("")).toEqual([]);
});
