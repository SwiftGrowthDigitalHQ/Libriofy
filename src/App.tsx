import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import DomainRouter from "@/components/DomainRouter";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AuthRoute from "@/components/auth/AuthRoute";
import { PWAProvider } from "@/components/pwa/PWAProvider";

const Home = lazy(() => import("./pages/Home"));
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
const BillingPage = lazy(() => import("./pages/BillingPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SuperAdminLoginPage = lazy(() => import("./pages/SuperAdminLoginPage"));
const SuperAdminDashboard = lazy(() => import("./pages/SuperAdminDashboard"));
const SuperAdminLibraries = lazy(() => import("./pages/SuperAdminLibraries"));
const SuperAdminRevenue = lazy(() => import("./pages/SuperAdminRevenue"));
const SuperAdminSubscriptions = lazy(() => import("./pages/SuperAdminSubscriptions"));
const SuperAdminPartners = lazy(() => import("./pages/SuperAdminPartners"));
const SuperAdminLeads = lazy(() => import("./pages/SuperAdminLeads"));
const SuperAdminPayouts = lazy(() => import("./pages/SuperAdminPayouts"));
const SuperAdminNotifications = lazy(() => import("./pages/SuperAdminNotifications"));
const SuperAdminSettings = lazy(() => import("./pages/SuperAdminSettings"));
const SuperAdminDomains = lazy(() => import("./pages/SuperAdminDomains"));

const queryClient = new QueryClient();
const useHashRouter = import.meta.env.VITE_USE_HASH_ROUTER === "true";
const Router = useHashRouter ? HashRouter : BrowserRouter;

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <PWAProvider>
          <Router {...(useHashRouter ? {} : { basename: import.meta.env.BASE_URL })}>
            <Suspense fallback={<RouteFallback />}>
              <DomainRouter>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route
                    path="/auth"
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
                  <Route path="/partner" element={<PartnerEntryPage />} />
                  <Route path="/partner/register" element={<PartnerRegistrationPage />} />
                  <Route
                    path="/partner/dashboard"
                    element={
                      <ProtectedRoute allowRoles={["partner"]}>
                        <PartnerDashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/partner/leads"
                    element={
                      <ProtectedRoute allowRoles={["partner"]}>
                        <PartnerLeadsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/partner/payouts"
                    element={
                      <ProtectedRoute allowRoles={["partner"]}>
                        <PartnerPayoutsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/partner/kit"
                    element={
                      <ProtectedRoute allowRoles={["partner"]}>
                        <PartnerMarketingKitPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/partner/notifications"
                    element={
                      <ProtectedRoute allowRoles={["partner"]}>
                        <PartnerNotificationsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/super-admin-login"
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
                    path="/admin"
                    element={
                      <ProtectedRoute allowRoles={["super_admin"]}>
                        <SuperAdminDashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/libraries"
                    element={
                      <ProtectedRoute allowRoles={["super_admin"]}>
                        <SuperAdminLibraries />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/revenue"
                    element={
                      <ProtectedRoute allowRoles={["super_admin"]}>
                        <SuperAdminRevenue />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/subscriptions"
                    element={
                      <ProtectedRoute allowRoles={["super_admin"]}>
                        <SuperAdminSubscriptions />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/partners"
                    element={
                      <ProtectedRoute allowRoles={["super_admin"]}>
                        <SuperAdminPartners />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/leads"
                    element={
                      <ProtectedRoute allowRoles={["super_admin"]}>
                        <SuperAdminLeads />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/payouts"
                    element={
                      <ProtectedRoute allowRoles={["super_admin"]}>
                        <SuperAdminPayouts />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/notifications"
                    element={
                      <ProtectedRoute allowRoles={["super_admin"]}>
                        <SuperAdminNotifications />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/domains"
                    element={
                      <ProtectedRoute allowRoles={["super_admin"]}>
                        <SuperAdminDomains />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/settings"
                    element={
                      <ProtectedRoute allowRoles={["super_admin"]}>
                        <SuperAdminSettings />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/library/:slug" element={<LibraryPublicPage />} />
                  <Route path="/renew/:token" element={<StudentRenewalPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </DomainRouter>
            </Suspense>
          </Router>
        </PWAProvider>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
