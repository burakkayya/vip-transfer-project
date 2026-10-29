// Yalnızca geliştirme: VS Code içindeki web önizlemesinde güvenli depo yoktur, localStorage kullanılır.
// Mağaza uygulamaları (iOS/Android) storage.ts ile cihazın güvenli deposunu kullanır.

export const storage = {
  get: async (key: string) => window.localStorage.getItem(key),
  set: async (key: string, value: string) => window.localStorage.setItem(key, value),
  remove: async (key: string) => window.localStorage.removeItem(key),
};
