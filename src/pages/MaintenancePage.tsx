import { Navigate } from "react-router-dom";
import MaintenanceScreen from "@/components/maintenance/MaintenanceScreen";
import { useMaintenanceMode } from "@/hooks/useMaintenanceMode";

const MaintenancePage = () => {
  const { loading, maintenanceMode } = useMaintenanceMode({ pollIntervalMs: 0 });

  if (loading) {
    return <MaintenanceScreen state="loading" />;
  }

  if (!maintenanceMode) {
    return <Navigate to="/" replace />;
  }

  return <MaintenanceScreen state="maintenance" />;
};

export default MaintenancePage;

