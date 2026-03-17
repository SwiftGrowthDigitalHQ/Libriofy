import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import NotificationCenter from "@/components/notifications/NotificationCenter";

const SuperAdminNotifications = () => {
  return (
    <SuperAdminLayout>
      <NotificationCenter mode="admin" />
    </SuperAdminLayout>
  );
};

export default SuperAdminNotifications;
