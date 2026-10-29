import TabsLayout from "@/components/TabsLayout";

export default function DriverTabs() {
  return (
    <TabsLayout
      variant="driver"
      tabs={[
        { name: "home", title: "İşler", icon: "navigate-outline", iconActive: "navigate" },
        { name: "earnings", title: "Kazanç", icon: "wallet-outline", iconActive: "wallet" },
        { name: "documents", title: "Belgeler", icon: "document-text-outline", iconActive: "document-text" },
      ]}
    />
  );
}
