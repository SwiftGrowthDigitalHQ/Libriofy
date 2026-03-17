import PartnerLayout from "@/components/dashboard/PartnerLayout";
import NotificationCenter from "@/components/notifications/NotificationCenter";

const PartnerNotificationsPage = () => {
  return (
    <PartnerLayout>
      <NotificationCenter mode="partner" />
    </PartnerLayout>
  );
};

export default PartnerNotificationsPage;

