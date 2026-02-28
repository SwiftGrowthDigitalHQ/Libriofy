import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import SeatMapPage from "./pages/SeatMapPage";
import StudentsPage from "./pages/StudentsPage";
import PaymentsPage from "./pages/PaymentsPage";
import PlansPage from "./pages/PlansPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import LibraryPublicPage from "./pages/LibraryPublicPage";
import AuthPage from "./pages/AuthPage";
import AttendancePage from "./pages/AttendancePage";
import QRCodesPage from "./pages/QRCodesPage";
import RenewalsPage from "./pages/RenewalsPage";
import SettingsPage from "./pages/SettingsPage";
import WaitingListPage from "./pages/WaitingListPage";
import SupportPage from "./pages/SupportPage";
import NotFound from "./pages/NotFound";
import DomainRouter from "./components/DomainRouter";

// Super Admin pages
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import SuperAdminLibraries from "./pages/SuperAdminLibraries";
import SuperAdminRevenue from "./pages/SuperAdminRevenue";
import SuperAdminSubscriptions from "./pages/SuperAdminSubscriptions";
import SuperAdminNotifications from "./pages/SuperAdminNotifications";
import SuperAdminSettings from "./pages/SuperAdminSettings";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <DomainRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<AuthPage />} />

              {/* Library Admin routes */}
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/dashboard/seats" element={<SeatMapPage />} />
              <Route path="/dashboard/students" element={<StudentsPage />} />
              <Route path="/dashboard/payments" element={<PaymentsPage />} />
              <Route path="/dashboard/plans" element={<PlansPage />} />
              <Route path="/dashboard/analytics" element={<AnalyticsPage />} />
              <Route path="/dashboard/attendance" element={<AttendancePage />} />
              <Route path="/dashboard/qr-codes" element={<QRCodesPage />} />
              <Route path="/dashboard/renewals" element={<RenewalsPage />} />
              <Route path="/dashboard/settings" element={<SettingsPage />} />
              <Route path="/dashboard/waitlist" element={<WaitingListPage />} />
              <Route path="/dashboard/support" element={<SupportPage />} />

              {/* Super Admin routes */}
              <Route path="/admin" element={<SuperAdminDashboard />} />
              <Route path="/admin/libraries" element={<SuperAdminLibraries />} />
              <Route path="/admin/revenue" element={<SuperAdminRevenue />} />
              <Route path="/admin/subscriptions" element={<SuperAdminSubscriptions />} />
              <Route path="/admin/notifications" element={<SuperAdminNotifications />} />
              <Route path="/admin/settings" element={<SuperAdminSettings />} />

              {/* Public */}
              <Route path="/library/:id" element={<LibraryPublicPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </DomainRouter>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
