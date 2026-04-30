import { useEffect, type ReactNode } from "react";
import { MAINTENANCE_ROUTE, buildMaintenanceHref, getCurrentRoutePath, normalizeBasePath } from "@/lib/maintenance";
import { useMaintenanceMode } from "@/hooks/useMaintenanceMode";
import MaintenanceScreen from "./MaintenanceScreen";

type MaintenanceGateProps = {
  children: ReactNode;
  useHashRouter: boolean;
};

const MaintenanceGate = ({ children, useHashRouter }: MaintenanceGateProps) => {
  const { loading, maintenanceMode } = useMaintenanceMode();
  const basePath = normalizeBasePath(import.meta.env.BASE_URL);

  const currentRoute =
    typeof window === "undefined"
      ? "/"
      : getCurrentRoutePath({
          basePath,
          isHashRouter: useHashRouter,
          location: window.location,
        });

  useEffect(() => {
    if (!maintenanceMode || typeof window === "undefined") {
      return;
    }

    if (currentRoute === MAINTENANCE_ROUTE) {
      return;
    }

    const maintenanceHref = buildMaintenanceHref({
      basePath,
      isHashRouter: useHashRouter,
      location: window.location,
    });

    window.history.replaceState({ maintenanceMode: true }, "", maintenanceHref);
  }, [basePath, currentRoute, maintenanceMode, useHashRouter]);

  if (maintenanceMode) {
    return <MaintenanceScreen state={loading ? "loading" : "maintenance"} />;
  }

  return <>{children}</>;
};

export default MaintenanceGate;
