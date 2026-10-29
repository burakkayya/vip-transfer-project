// Müşteri ve sürücü çeşitleri ayrı Metro önbelleği kullanır: uygulama yapılandırması (APP_VARIANT)
// derlemeye gömüldüğü için ortak önbellekte biri diğerinin derlemesini alabilir.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { FileStore } = require("metro-cache");

const config = getDefaultConfig(__dirname);
const variant = process.env.APP_VARIANT === "driver" ? "driver" : "customer";
config.cacheStores = [new FileStore({ root: path.join(__dirname, "node_modules", ".cache", `metro-${variant}`) })];

module.exports = config;
