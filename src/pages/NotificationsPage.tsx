import DashboardLayout from "@/components/dashboard/DashboardLayout";
import NotificationCenter from "@/components/notifications/NotificationCenter";

const NotificationsPage = () => {
  return (
    <DashboardLayout>
      <NotificationCenter mode="library" />
    </DashboardLayout>
  );
};

export default NotificationsPage;
