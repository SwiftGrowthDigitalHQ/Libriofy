import { useEffect, type ReactNode } from "react";
import { MAINTENANCE_ROUTE, buildMaintenanceHref, getCurrentRoutePath, normalizeBasePath } from "@/lib/maintenance";
import { isVerifiedSuperAdminSession } from "@/lib/auth.shared";
import { isMaintenanceBypassUiPath } from "@/lib/maintenanceAccess";
import { useAuth } from "@/hooks/useAuth";
import { useMaintenanceMode } from "@/hooks/useMaintenanceMode";
import MaintenanceScreen from "./MaintenanceScreen";

type MaintenanceGateProps = {
  children: ReactNode;
  useHashRouter: boolean;
};

const MaintenanceGate = ({ children, useHashRouter }: MaintenanceGateProps) => {
  const { loading, maintenanceMode } = useMaintenanceMode();
  const { loading: authLoading, session } = useAuth();
  const basePath = normalizeBasePath(import.meta.env.BASE_URL);

  const currentRoute =
    typeof window === "undefined"
      ? "/"
      : getCurrentRoutePath({
          basePath,
          isHashRouter: useHashRouter,
          location: window.location,
        });

  const bypassByRoute = isMaintenanceBypassUiPath(currentRoute);
  const hasSuperAdminBypass = isVerifiedSuperAdminSession(session);
  const shouldBypassMaintenance = bypassByRoute || hasSuperAdminBypass;
  const shouldHoldForAuth = maintenanceMode && !bypassByRoute && authLoading;

  useEffect(() => {
    if (!maintenanceMode || shouldBypassMaintenance || shouldHoldForAuth || typeof window === "undefined") {
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
  }, [basePath, currentRoute, maintenanceMode, shouldBypassMaintenance, shouldHoldForAuth, useHashRouter]);

  if (maintenanceMode && !shouldBypassMaintenance) {
    return <MaintenanceScreen state={loading || shouldHoldForAuth ? "loading" : "maintenance"} />;
  }

  return <>{children}</>;
};

export default MaintenanceGate;
