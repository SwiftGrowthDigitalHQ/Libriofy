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
import SuperAdminPage from "./pages/SuperAdminPage";
import AttendancePage from "./pages/AttendancePage";
import QRCodesPage from "./pages/QRCodesPage";
import RenewalsPage from "./pages/RenewalsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard/seats" element={<SeatMapPage />} />
            <Route path="/dashboard/students" element={<StudentsPage />} />
            <Route path="/dashboard/payments" element={<PaymentsPage />} />
            <Route path="/dashboard/plans" element={<PlansPage />} />
            <Route path="/dashboard/analytics" element={<AnalyticsPage />} />
            <Route path="/dashboard/attendance" element={<AttendancePage />} />
            <Route path="/dashboard/qr-codes" element={<QRCodesPage />} />
            <Route path="/dashboard/renewals" element={<RenewalsPage />} />
            <Route path="/admin" element={<SuperAdminPage />} />
            <Route path="/library/:id" element={<LibraryPublicPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
