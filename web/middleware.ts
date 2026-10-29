import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // bff (backend vekili), Next iç dosyaları ve uzantılı dosyalar dil yönlendirmesine girmez.
  matcher: ["/((?!bff|_next|_vercel|.*\\..*).*)"],
};
