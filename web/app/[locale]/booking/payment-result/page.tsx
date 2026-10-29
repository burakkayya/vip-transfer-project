import PaymentResult from "@/components/PaymentResult";

// Sorgu parametrelerini okur, istek anında çizilir.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ status?: string }> };

export default async function PaymentResultPage({ searchParams }: Props) {
  const { status } = await searchParams;
  return <PaymentResult status={status === "ok" ? "ok" : "fail"} />;
}
