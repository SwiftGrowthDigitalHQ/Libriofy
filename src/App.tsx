import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import SeatMapPage from "./pages/SeatMapPage";
import LockerMapPage from "./pages/LockerMapPage";
import StudentsPage from "./pages/StudentsPage";
import PaymentsPage from "./pages/PaymentsPage";
import PlansPage from "./pages/PlansPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import LibraryPublicPage from "./pages/LibraryPublicPage";
import AuthPage from "./pages/AuthPage";
import SignupPage from "./pages/SignupPage";
import PartnerRegistrationPage from "./pages/PartnerRegistrationPage";
import PartnerDashboard from "./pages/PartnerDashboard";
import PartnerLeadsPage from "./pages/PartnerLeadsPage";
import PartnerPayoutsPage from "./pages/PartnerPayoutsPage";
import PartnerMarketingKitPage from "./pages/PartnerMarketingKitPage";
import PartnerNotificationsPage from "./pages/PartnerNotificationsPage";
import AttendancePage from "./pages/AttendancePage";
import QRCodesPage from "./pages/QRCodesPage";
import RenewalsPage from "./pages/RenewalsPage";
import SettingsPage from "./pages/SettingsPage";
import WaitingListPage from "./pages/WaitingListPage";
import SupportPage from "./pages/SupportPage";
import StudentRenewalPage from "./pages/StudentRenewalPage";
import BillingPage from "./pages/BillingPage";
import NotificationsPage from "./pages/NotificationsPage";
import NotFound from "./pages/NotFound";
import DomainRouter from "./components/DomainRouter";
import SuperAdminLoginPage from "./pages/SuperAdminLoginPage";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import AuthRoute from "./components/auth/AuthRoute";

import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import SuperAdminLibraries from "./pages/SuperAdminLibraries";
import SuperAdminRevenue from "./pages/SuperAdminRevenue";
import SuperAdminSubscriptions from "./pages/SuperAdminSubscriptions";
import SuperAdminPartners from "./pages/SuperAdminPartners";
import SuperAdminLeads from "./pages/SuperAdminLeads";
import SuperAdminPayouts from "./pages/SuperAdminPayouts";
import SuperAdminNotifications from "./pages/SuperAdminNotifications";
import SuperAdminSettings from "./pages/SuperAdminSettings";
import SuperAdminDomains from "./pages/SuperAdminDomains";

const queryClient = new QueryClient();
const useHashRouter = import.meta.env.VITE_USE_HASH_ROUTER === "true";
const Router = useHashRouter ? HashRouter : BrowserRouter;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Router {...(useHashRouter ? {} : { basename: import.meta.env.BASE_URL })}>
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
              <Route path="/partner" element={<PartnerRegistrationPage />} />
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
        </Router>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
