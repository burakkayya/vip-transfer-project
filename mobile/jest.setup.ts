// Jest ortak taklitleri: yerel modüller test ortamında çalışmaz.
jest.mock("react-native-reanimated", () => jest.requireActual("react-native-reanimated/mock"));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

// react-native-maps yerel modül ister; testte prop'larını açığa çıkaran basit host bileşenleri kullanılır.
// MapView ref'i kamera komutlarını jest.fn olarak sunar (taklidin `__commands` dışa aktarımı).
jest.mock("react-native-maps", () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- jest.mock fabrikası modülleri require ile alır */
  const React = require("react");
  const { View } = require("react-native");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const commands = { fitToCoordinates: jest.fn(), animateToRegion: jest.fn() };
  const MapView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    React.useImperativeHandle(ref, () => commands);
    const { onMapReady } = props as { onMapReady?: () => void };
    React.useEffect(() => {
      onMapReady?.();
    }, [onMapReady]);
    return React.createElement(View, { testID: "map-view", ...props }, props.children as React.ReactNode);
  });
  MapView.displayName = "MapView";
  const Polyline = (props: Record<string, unknown>) => React.createElement(View, { testID: "map-polyline", ...props });
  const Marker = (props: Record<string, unknown>) =>
    React.createElement(View, { testID: "map-marker", ...props }, props.children as React.ReactNode);
  return { __esModule: true, default: MapView, Polyline, Marker, PROVIDER_GOOGLE: "google", PROVIDER_DEFAULT: undefined, __commands: commands };
});
