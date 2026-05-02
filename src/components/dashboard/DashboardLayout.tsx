import { ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { 
  Archive, BookOpen, LayoutDashboard, LayoutGrid, Users, 
  CreditCard, CalendarClock, BarChart3, Settings, 
  ChevronLeft, Bell, Globe, LogOut, ScanLine, QrCode, RefreshCw, ListOrdered, Shield, HelpCircle
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useDatabaseHealth } from "@/hooks/useDatabaseHealth";
import { useIsSuperAdmin } from "@/hooks/useUserRole";
import { DatabaseHealthAlert } from "@/components/observability/DatabaseHealthAlert";
import { evaluateSubscriptionAccess, useLibrarySubscription } from "@/hooks/useLibrarySubscription";
import { SUPER_ADMIN_DASHBOARD_ROUTE } from "@/lib/superAdminPaths";
import NotificationBell from "@/components/notifications/NotificationBell";
import InstallAppButton from "@/components/pwa/InstallAppButton";

type DashboardNavItem = {
  disabled?: boolean;
  icon: typeof LayoutDashboard;
  label: string;
  path: string;
  rel?: string;
  target?: string;
};

const baseLibraryNavItems: DashboardNavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: LayoutGrid, label: "Seat Map", path: "/dashboard/seats" },
  { icon: Archive, label: "Locker Map", path: "/dashboard/lockers" },
  { icon: Users, label: "Students", path: "/dashboard/students" },
  { icon: ScanLine, label: "Attendance", path: "/dashboard/attendance" },
  { icon: QrCode, label: "Student IDs", path: "/dashboard/qr-codes" },
  { icon: RefreshCw, label: "Renewals", path: "/dashboard/renewals" },
  { icon: ListOrdered, label: "Waiting List", path: "/dashboard/waitlist" },
  { icon: CreditCard, label: "Billing", path: "/dashboard/billing" },
  { icon: CreditCard, label: "Payments", path: "/dashboard/payments" },
  { icon: CalendarClock, label: "Plans & Slots", path: "/dashboard/plans" },
  { icon: BarChart3, label: "Analytics", path: "/dashboard/analytics" },
  { icon: Bell, label: "Notifications", path: "/dashboard/notifications" },
  { icon: HelpCircle, label: "Support", path: "/dashboard/support" },
];

const settingsNavItem: DashboardNavItem = { icon: Settings, label: "Settings", path: "/dashboard/settings" };

const DashboardLayout = ({ children }: { children: ReactNode }) => {
  const [collapsed, setCollapsed] = useState(false);
  const { user, signOut, logoutAllDevices } = useAuth();
  const { libraryId } = useCurrentLibraryId();
  const { isSuperAdmin } = useIsSuperAdmin();
  const { data: subscription } = useLibrarySubscription();
  const navigate = useNavigate();
  const location = useLocation();
  const databaseHealthQuery = useDatabaseHealth();
  const access = evaluateSubscriptionAccess(subscription);
  const { data: currentLibrary } = useQuery({
    queryKey: ["dashboard-public-library", libraryId],
    queryFn: async (): Promise<{ slug: string | null } | null> => {
      if (!libraryId) return null;

      const { data, error } = await supabase
        .from("libraries")
        .select("slug")
        .eq("id", libraryId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!libraryId,
    staleTime: 60_000,
  });
  const publicPagePath = currentLibrary?.slug ? `/library/${currentLibrary.slug}` : null;
  const libraryNavItems: DashboardNavItem[] = [
    ...baseLibraryNavItems,
    {
      icon: Globe,
      label: "Public Page",
      path: publicPagePath ?? "",
      disabled: !publicPagePath,
      target: "_blank",
      rel: "noreferrer",
    },
    settingsNavItem,
  ];
  const navItems = access.isAllowed
    ? libraryNavItems
    : libraryNavItems.filter((item) => item.path === "/dashboard/billing");

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className={`${collapsed ? "w-16" : "w-64"} bg-sidebar flex flex-col border-r border-sidebar-border transition-all duration-300 hidden lg:flex`}>
        <div className="flex items-center gap-2 px-4 h-16 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-base font-bold font-display text-sidebar-foreground">Libriofy</span>
              <span className="text-[10px] text-sidebar-foreground/50 -mt-0.5">Library Admin</span>
            </div>
          )}
        </div>

        <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
          {navItems.map((item) => {
            const active = !item.target && location.pathname === item.path;

            if (item.disabled) {
              return (
                <button
                  key={item.label}
                  type="button"
                  disabled
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/40"
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );
            }

            return (
              <Link
                key={item.path}
                to={item.path}
                target={item.target}
                rel={item.rel}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-primary font-medium"
                    : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                }`}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border">
          {isSuperAdmin && (
            <Link
              to={SUPER_ADMIN_DASHBOARD_ROUTE}
              className="flex items-center gap-3 px-5 py-3 text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors w-full"
            >
              <Shield className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Super Admin</span>}
            </Link>
          )}
          {user && (
            <div className="space-y-1 px-2 py-2">
              <button
                onClick={async () => { await signOut(); navigate("/auth"); }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              >
                <LogOut className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span>Sign Out</span>}
              </button>
              {!collapsed ? (
                <button
                  onClick={async () => { await logoutAllDevices(); navigate("/auth"); }}
                  className="w-full rounded-lg px-3 py-2 text-left text-xs text-sidebar-foreground/45 transition hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/80"
                >
                  Sign out all devices
                </button>
              ) : null}
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-3 w-full text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
          >
            <ChevronLeft className={`w-4 h-4 mx-auto transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 sm:px-6">
          <div className="lg:hidden flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold font-display text-foreground">Libriofy</span>
          </div>
          <div className="hidden lg:block">
            <h1 className="text-lg font-semibold font-display text-foreground">Library Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <InstallAppButton size="sm" variant="outline" className="hidden sm:inline-flex">
              Install App
            </InstallAppButton>
            <NotificationBell notificationsPath="/dashboard/notifications" />
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">
              LA
            </div>
          </div>
        </header>

        {/* Mobile nav */}
        <div className="lg:hidden border-b border-border bg-card overflow-x-auto">
          <div className="flex px-2 py-2 gap-1">
            {navItems.slice(0, 6).map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs whitespace-nowrap transition-colors ${
                    active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"
                  }`}
                >
                  <item.icon className="w-3.5 h-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <DatabaseHealthAlert
            errorMessage={databaseHealthQuery.isError ? "Database health validation failed." : null}
            health={databaseHealthQuery.data}
            viewer="library_admin"
          />
          {children}
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
