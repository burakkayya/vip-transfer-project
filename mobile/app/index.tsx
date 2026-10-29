import { Redirect } from "expo-router";
import { Loading } from "@/components/ui";
import { VARIANT } from "@/lib/config";
import { useSession } from "@/lib/session";

export default function Index() {
  const { ready, signedIn } = useSession();
  if (!ready) return <Loading />;
  if (!signedIn) return <Redirect href="/login" />;
  return <Redirect href={VARIANT === "driver" ? "/home" : "/book"} />;
}
