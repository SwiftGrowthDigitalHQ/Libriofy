import { Navigate } from "react-router-dom";
import PartnerRegistrationPage from "./PartnerRegistrationPage";
import { useAuth } from "@/hooks/useAuth";
import { getRoleHomeRoute, useUserRole } from "@/hooks/useUserRole";

const PartnerEntryPage = () => {
  const { user, loading } = useAuth();
  const { data: roles, isLoading: rolesLoading } = useUserRole();

  if (loading || (user && rolesLoading)) {
    return null;
  }

  if (!user) {
    return <PartnerRegistrationPage />;
  }

  if (roles?.some((role) => role.role === "partner")) {
    return <Navigate to="/partner/dashboard" replace />;
  }

  const destination = getRoleHomeRoute(roles);
  return <Navigate to={destination === "/auth" ? "/" : destination} replace />;
};

export default PartnerEntryPage;
