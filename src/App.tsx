import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { GlobalErrorBoundary } from "@/components/error/GlobalErrorBoundary";
import MaintenanceGate from "@/components/maintenance/MaintenanceGate";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import DomainRouter from "@/components/DomainRouter";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AuthRoute from "@/components/auth/AuthRoute";
import ImpersonationBanner from "@/components/auth/ImpersonationBanner";
import { PWAProvider } from "@/components/pwa/PWAProvider";
import { hasStoredLibraryBinding } from "@/lib/deviceKiosk";
import { queryClient } from "@/lib/queryClient";
import {
  LEGACY_SUPER_ADMIN_DASHBOARD_ROUTE,
  SUPER_ADMIN_DASHBOARD_ROUTE,
  SUPER_ADMIN_LOGIN_ROUTE,
} from "@/lib/superAdminPaths";

const Home = lazy(() => import("./pages/Home"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const Support = lazy(() => import("./pages/Support"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Terms = lazy(() => import("./pages/Terms"));
const MaintenancePage = lazy(() => import("./pages/MaintenancePage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const SeatMapPage = lazy(() => import("./pages/SeatMapPage"));
const LockerMapPage = lazy(() => import("./pages/LockerMapPage"));
const StudentsPage = lazy(() => import("./pages/StudentsPage"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage"));
const PlansPage = lazy(() => import("./pages/PlansPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const LibraryPublicPage = lazy(() => import("./pages/LibraryPublicPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const ReferralLanding = lazy(() => import("./pages/ReferralLanding"));
const ScanPage = lazy(() => import("./pages/ScanKioskPage"));
const ScanPageV2 = lazy(() => import("./pages/ScanKioskPageV2"));
const SetupDevicePage = lazy(() => import("./pages/SetupDevicePage"));
const PartnerEntryPage = lazy(() => import("./pages/PartnerEntryPage"));
const PartnerRegistrationPage = lazy(() => import("./pages/PartnerRegistrationPage"));
const PartnerDashboard = lazy(() => import("./pages/PartnerDashboard"));
const PartnerLeadsPage = lazy(() => import("./pages/PartnerLeadsPage"));
const PartnerPayoutsPage = lazy(() => import("./pages/PartnerPayoutsPage"));
const PartnerMarketingKitPage = lazy(() => import("./pages/PartnerMarketingKitPage"));
const PartnerNotificationsPage = lazy(() => import("./pages/PartnerNotificationsPage"));
const AttendancePage = lazy(() => import("./pages/AttendancePage"));
const QRCodesPage = lazy(() => import("./pages/QRCodesPage"));
const RenewalsPage = lazy(() => import("./pages/RenewalsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const WaitingListPage = lazy(() => import("./pages/WaitingListPage"));
const SupportPage = lazy(() => import("./pages/SupportPage"));
const StudentRenewalPage = lazy(() => import("./pages/StudentRenewalPage"));
const StudentIdProfilePage = lazy(() => import("./pages/StudentIdProfilePage"));
const BillingPage = lazy(() => import("./pages/BillingPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SuperAdminLoginPage = lazy(() => import("./pages/SuperAdminLoginPage"));
const SuperAdminDashboard = lazy(() => import("./pages/SuperAdminDashboard"));
const SuperAdminLibraries = lazy(() => import("./pages/SuperAdminLibraries"));
const SuperAdminRevenue = lazy(() => import("./pages/SuperAdminRevenue"));
const SuperAdminBilling = lazy(() => import("./pages/SuperAdminBilling"));
const SuperAdminIncidents = lazy(() => import("./pages/SuperAdminIncidents"));
const SuperAdminAnalytics = lazy(() => import("./pages/SuperAdminAnalytics"));
const SuperAdminBroadcasts = lazy(() => import("./pages/SuperAdminBroadcasts"));
const SuperAdminAutomation = lazy(() => import("./pages/SuperAdminAutomation"));
const SuperAdminFeatureFlags = lazy(() => import("./pages/SuperAdminFeatureFlags"));
const SuperAdminObservability = lazy(() => import("./pages/SuperAdminObservability"));
const SuperAdminSubscriptions = lazy(() => import("./pages/SuperAdminSubscriptions"));
const SuperAdminPartners = lazy(() => import("./pages/SuperAdminPartners"));
const SuperAdminLeads = lazy(() => import("./pages/SuperAdminLeads"));
const SuperAdminPayouts = lazy(() => import("./pages/SuperAdminPayouts"));
const SuperAdminNotifications = lazy(() => import("./pages/SuperAdminNotifications"));
const SuperAdminSettings = lazy(() => import("./pages/SuperAdminSettings"));
const SuperAdminDomains = lazy(() => import("./pages/SuperAdminDomains"));

const useHashRouter = import.meta.env.VITE_USE_HASH_ROUTER === "true";
const Router = useHashRouter ? HashRouter : BrowserRouter;
const routerFutureFlags = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const;

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const DeviceScanRoute = () => {
  if (!hasStoredLibraryBinding()) {
    return <Navigate to="/setup-device" replace />;
  }

  return <ScanPage />;
};

const DeviceSetupRoute = () => {
  if (hasStoredLibraryBinding()) {
    return <Navigate to="/scan" replace />;
  }

  return <SetupDevicePage />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <MaintenanceGate useHashRouter={useHashRouter}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <PWAProvider>
            <Router
              future={routerFutureFlags}
              {...(useHashRouter ? {} : { basename: import.meta.env.BASE_URL })}
            >
              <GlobalErrorBoundary>
                <ImpersonationBanner />
                <Suspense fallback={<RouteFallback />}>
                  <DomainRouter>
                    <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/about" element={<About />} />
                    <Route path="/contact" element={<Contact />} />
                    <Route path="/support" element={<Support />} />
                    <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/maintenance" element={<MaintenancePage />} />
                    <Route path="/setup-device" element={<DeviceSetupRoute />} />
                    <Route path="/scan" element={<DeviceScanRoute />} />
                    <Route path="/scan-v2" element={<ScanPageV2 />} />
                    <Route
                      path="/auth"
                      element={
                        <AuthRoute>
                          <AuthPage />
                        </AuthRoute>
                      }
                    />
                    <Route
                      path="/login"
                      element={
                        <AuthRoute>
                          <AuthPage />
                        </AuthRoute>
                      }
                    />
                    <Route
                      path="/signup"
                      element={
                        <AuthRoute>
                          <SignupPage />
                        </AuthRoute>
                      }
                    />
                    <Route path="/ref/:code" element={<ReferralLanding />} />
                    <Route path="/reset-password" element={<AuthPage initialMode="reset-password" />} />
                    <Route path="/partner" element={<PartnerEntryPage />} />
                    <Route path="/partner/register" element={<PartnerRegistrationPage />} />
                    <Route
                      path="/partner/dashboard"
                      element={
                        <ProtectedRoute
                          allowRoles={["partner", "super_admin"]}
                          debugLabel="partner"
                          unauthenticatedRedirectTo="/login"
                          unauthorizedRedirectTo="/dashboard"
                        >
                          <PartnerDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/partner/leads"
                      element={
                        <ProtectedRoute
                          allowRoles={["partner", "super_admin"]}
                          debugLabel="partner"
                          unauthenticatedRedirectTo="/login"
                          unauthorizedRedirectTo="/dashboard"
                        >
                          <PartnerLeadsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/partner/payouts"
                      element={
                        <ProtectedRoute
                          allowRoles={["partner", "super_admin"]}
                          debugLabel="partner"
                          unauthenticatedRedirectTo="/login"
                          unauthorizedRedirectTo="/dashboard"
                        >
                          <PartnerPayoutsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/partner/kit"
                      element={
                        <ProtectedRoute
                          allowRoles={["partner", "super_admin"]}
                          debugLabel="partner"
                          unauthenticatedRedirectTo="/login"
                          unauthorizedRedirectTo="/dashboard"
                        >
                          <PartnerMarketingKitPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/partner/notifications"
                      element={
                        <ProtectedRoute
                          allowRoles={["partner", "super_admin"]}
                          debugLabel="partner"
                          unauthenticatedRedirectTo="/login"
                          unauthorizedRedirectTo="/dashboard"
                        >
                          <PartnerNotificationsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path={SUPER_ADMIN_LOGIN_ROUTE}
                      element={
                        <AuthRoute>
                          <SuperAdminLoginPage />
                        </AuthRoute>
                      }
                    />
                    <Route
                      path="/dashboard"
                      element={
                        <ProtectedRoute allowRoles={["library_owner", "staff"]}>
                          <Dashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/seats"
                      element={
                        <ProtectedRoute allowRoles={["library_owner", "staff"]}>
                          <SeatMapPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/lockers"
                      element={
                        <ProtectedRoute allowRoles={["library_owner", "staff"]}>
                          <LockerMapPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/students"
                      element={
                        <ProtectedRoute allowRoles={["library_owner", "staff"]}>
                          <StudentsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/billing"
                      element={
                        <ProtectedRoute allowRoles={["library_owner", "staff"]}>
                          <BillingPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/payments"
                      element={
                        <ProtectedRoute allowRoles={["library_owner", "staff"]}>
                          <PaymentsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/plans"
                      element={
                        <ProtectedRoute allowRoles={["library_owner"]}>
                          <PlansPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/analytics"
                      element={
                        <ProtectedRoute allowRoles={["library_owner"]}>
                          <AnalyticsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/attendance"
                      element={
                        <ProtectedRoute allowRoles={["library_owner", "staff"]}>
                          <AttendancePage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/qr-codes"
                      element={
                        <ProtectedRoute allowRoles={["library_owner"]}>
                          <QRCodesPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/renewals"
                      element={
                        <ProtectedRoute allowRoles={["library_owner"]}>
                          <RenewalsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/settings"
                      element={
                        <ProtectedRoute allowRoles={["library_owner"]}>
                          <SettingsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/waitlist"
                      element={
                        <ProtectedRoute allowRoles={["library_owner"]}>
                          <WaitingListPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/support"
                      element={
                        <ProtectedRoute allowRoles={["library_owner", "staff"]}>
                          <SupportPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard/notifications"
                      element={
                        <ProtectedRoute allowRoles={["library_owner", "staff"]}>
                          <NotificationsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path={SUPER_ADMIN_DASHBOARD_ROUTE}
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path={LEGACY_SUPER_ADMIN_DASHBOARD_ROUTE}
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <Navigate to={SUPER_ADMIN_DASHBOARD_ROUTE} replace />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/libraries"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminLibraries />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/revenue"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminRevenue />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/billing"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminBilling />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/incidents"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminIncidents />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/analytics"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminAnalytics />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/broadcasts"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminBroadcasts />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/automation"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminAutomation />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/feature-flags"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminFeatureFlags />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/observability"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminObservability />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/subscriptions"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminSubscriptions />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/partners"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminPartners />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/leads"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminLeads />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/payouts"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminPayouts />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/notifications"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminNotifications />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/domains"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminDomains />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/settings"
                      element={
                        <ProtectedRoute
                          allowRoles={["super_admin"]}
                          unauthenticatedRedirectTo={SUPER_ADMIN_LOGIN_ROUTE}
                        >
                          <SuperAdminSettings />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="/library/:slug" element={<LibraryPublicPage />} />
                    <Route path="/renew/:token" element={<StudentRenewalPage />} />
                    <Route path="/student/:qr" element={<StudentIdProfilePage />} />
                    <Route path="*" element={<NotFound />} />
                    </Routes>
                  </DomainRouter>
                </Suspense>
              </GlobalErrorBoundary>
            </Router>
          </PWAProvider>
        </TooltipProvider>
      </MaintenanceGate>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
