import { Navigate, useLocation } from "react-router-dom";
import PartnerPortalHome from "./PartnerPortalHome";
import { useAuth } from "@/hooks/useAuth";
import { getRoleHomeRoute, useUserRole } from "@/hooks/useUserRole";

const PartnerEntryPage = () => {
  const location = useLocation();
  const { user, loading } = useAuth();
  const { data: roles, isLoading: rolesLoading } = useUserRole();

  if (loading || (user && rolesLoading)) {
    return null;
  }

  if (!user) {
    return <PartnerPortalHome />;
  }

  if (roles?.some((role) => role.role === "partner" || role.role === "super_admin")) {
    return <Navigate to="/partner/dashboard" replace />;
  }

  const destination = getRoleHomeRoute(roles);
  return <Navigate to={destination === "/auth" ? "/dashboard" : destination} replace />;
};

export default PartnerEntryPage;
