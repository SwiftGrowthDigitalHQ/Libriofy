import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  BellRing,
  Bot,
  ChevronLeft,
  Flag,
  LayoutDashboard,
  LogOut,
  Receipt,
  Settings,
  Shield,
  Siren,
  TrendingUp,
  Building2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SUPER_ADMIN_DASHBOARD_ROUTE, SUPER_ADMIN_LOGIN_ROUTE } from "@/lib/superAdminPaths";
import InstallAppButton from "@/components/pwa/InstallAppButton";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: SUPER_ADMIN_DASHBOARD_ROUTE },
  { icon: Building2, label: "Libraries", path: "/admin/libraries" },
  { icon: TrendingUp, label: "Revenue", path: "/admin/revenue" },
  { icon: Receipt, label: "Billing", path: "/admin/billing" },
  { icon: Siren, label: "Incidents", path: "/admin/incidents" },
  { icon: BarChart3, label: "Analytics", path: "/admin/analytics" },
  { icon: BellRing, label: "Broadcasts", path: "/admin/broadcasts" },
  { icon: Bot, label: "Automation", path: "/admin/automation" },
  { icon: Flag, label: "Feature Flags", path: "/admin/feature-flags" },
  { icon: Activity, label: "Observability", path: "/admin/observability" },
  { icon: Settings, label: "Settings", path: "/admin/settings" },
] as const;

const SuperAdminLayout = ({ children }: { children: ReactNode }) => {
  const [collapsed, setCollapsed] = useState(false);
  const { session, user, signOut, logoutAllDevices } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] overflow-hidden bg-background">
      <aside className={`${collapsed ? "w-16" : "w-72"} hidden flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 lg:flex`}>
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/80">
            <Shield className="h-4 w-4 text-destructive-foreground" />
          </div>
          {!collapsed ? (
            <div className="flex flex-col">
              <span className="text-base font-bold font-display text-sidebar-foreground">Libriofy</span>
              <span className="text-[10px] text-sidebar-foreground/50">Control Plane</span>
            </div>
          ) : null}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-primary"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
                to={item.path}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed ? <span>{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border">
          {user ? (
            <div className="space-y-1 px-2 py-2">
              <button
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                onClick={async () => {
                  await signOut();
                  navigate(SUPER_ADMIN_LOGIN_ROUTE);
                }}
              >
                <LogOut className="h-4 w-4 shrink-0" />
                {!collapsed ? <span>Sign Out</span> : null}
              </button>
              {!collapsed && !session?.impersonation ? (
                <button
                  className="w-full rounded-lg px-3 py-2 text-left text-xs text-sidebar-foreground/45 transition hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/80"
                  onClick={async () => {
                    await logoutAllDevices();
                    navigate(SUPER_ADMIN_LOGIN_ROUTE);
                  }}
                >
                  Sign out all devices
                </button>
              ) : null}
            </div>
          ) : null}
          <button
            className="w-full p-3 text-sidebar-foreground/40 transition-colors hover:text-sidebar-foreground"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronLeft className={`mx-auto h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
          <div className="lg:hidden flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/80">
              <Shield className="h-4 w-4 text-destructive-foreground" />
            </div>
            <span className="font-bold font-display text-foreground">Control Plane</span>
          </div>
          <div className="hidden lg:block">
            <h1 className="text-lg font-semibold font-display text-foreground">Platform Administration</h1>
          </div>
          <div className="flex items-center gap-3">
            <InstallAppButton className="hidden sm:inline-flex" size="sm" variant="outline">
              Install App
            </InstallAppButton>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/20 text-xs font-medium text-destructive">
              SA
            </div>
          </div>
        </header>

        <div className="overflow-x-auto border-b border-border bg-card lg:hidden">
          <div className="flex gap-1 px-2 py-2">
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs transition-colors ${
                    active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground"
                  }`}
                  to={item.path}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
};

export default SuperAdminLayout;
