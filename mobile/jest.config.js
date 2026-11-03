module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["./jest.setup.ts"],
  // Reanimated 4 / worklets: yerel (.native) dosyalar yerine JS karşılıkları çözülsün.
  resolver: require.resolve("react-native-reanimated/jest/resolver"),
};
