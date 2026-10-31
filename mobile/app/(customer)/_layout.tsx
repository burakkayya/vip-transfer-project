import TabsLayout from "@/components/TabsLayout";
import { t } from "@/lib/i18n";

export default function CustomerTabs() {
  return (
    <TabsLayout
      variant="customer"
      tabs={[
        { name: "book", title: t("tabs.home"), icon: "car-outline", iconActive: "car", hero: true },
        { name: "bookings", title: t("tabs.bookings"), icon: "receipt-outline", iconActive: "receipt", hero: true },
        { name: "profile", title: t("tabs.profile"), icon: "person-outline", iconActive: "person", hero: true },
      ]}
    />
  );
}
