import { useEffect, useState } from "react";
import { Image, type ImageProps, View } from "react-native";
import { imageDataUri } from "@/lib/api";

// Sekme değişince yeniden indirilmesin: son birkaç küçük resim bellekte (sunucu 640 px JPEG döner).
const cache = new Map<string, string>();
const CACHE_SIZE = 12;

function remember(path: string, uri: string) {
  cache.set(path, uri);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

/**
 * Yetkili uçtan görüntü (araç fotoğrafı, sürücü fotoğrafı). Görüntü jetonla alınır (lib/api imageDataUri);
 * yüklenene kadar ya da alınamazsa yalnızca stil kutusu görünür.
 */
export default function AuthImage({ path, style, ...rest }: Omit<ImageProps, "source"> & { path: string }) {
  const [loaded, setLoaded] = useState<{ path: string; uri: string } | null>(null);
  useEffect(() => {
    let live = true;
    if (cache.has(path)) return;
    imageDataUri(path).then((uri) => {
      remember(path, uri);
      if (live) setLoaded({ path, uri });
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);
  const uri = cache.get(path) ?? (loaded?.path === path ? loaded.uri : null);
  return uri ? <Image {...rest} style={style} source={{ uri }} /> : <View style={style} />;
}
