import TabsLayout from "@/components/TabsLayout";

export default function DriverTabs() {
  return (
    <TabsLayout
      variant="driver"
      tabs={[
        { name: "home", title: "Ana sayfa", icon: "navigate-outline", iconActive: "navigate", hero: true },
        { name: "earnings", title: "Kazanç", icon: "wallet-outline", iconActive: "wallet", hero: true },
        { name: "documents", title: "Belgeler", icon: "document-text-outline", iconActive: "document-text", hero: true },
      ]}
    />
  );
}
