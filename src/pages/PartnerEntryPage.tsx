import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import PartnerPortalHome from "./PartnerPortalHome";
import { useAuth } from "@/hooks/useAuth";
import { getRoleHomeRoute, useUserRole } from "@/hooks/useUserRole";

const PartnerEntryPage = () => {
  const location = useLocation();
  const { user, loading } = useAuth();
  const { data: roles, isLoading: rolesLoading } = useUserRole();

  useEffect(() => {
    console.log("[PartnerEntryPage] route check", {
      currentRoute: location.pathname,
      currentUser: user ? { id: user.id, email: user.email } : null,
      roles: roles?.map((role) => role.role) ?? [],
      loading,
      rolesLoading,
    });
  }, [location.pathname, loading, rolesLoading, roles, user]);

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
  console.log("[PartnerEntryPage] redirecting non-partner user", {
    destination,
  });
  return <Navigate to={destination === "/auth" ? "/dashboard" : destination} replace />;
};

export default PartnerEntryPage;
