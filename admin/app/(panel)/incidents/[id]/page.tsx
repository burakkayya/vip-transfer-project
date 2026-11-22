import { notFound } from "next/navigation";
import { parseUuid } from "@/lib/routeParams";
import IncidentDetail from "./IncidentDetail";

/** Sunucu bileşeni: URL'deki `id` BFF yoluna eklenmeden önce UUID olarak doğrulanır (WEB-06). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const id = parseUuid((await params).id) ?? notFound();
  return <IncidentDetail id={id} />;
}
