import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Building2, CreditCard,
  ChevronLeft, LogOut, Settings, TrendingUp, Shield, Bell, Globe,
  ListChecks, Users2, Wallet
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import NotificationBell from "@/components/notifications/NotificationBell";
import InstallAppButton from "@/components/pwa/InstallAppButton";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/admin" },
  { icon: Building2, label: "Libraries", path: "/admin/libraries" },
  { icon: TrendingUp, label: "Revenue", path: "/admin/revenue" },
  { icon: CreditCard, label: "Subscriptions", path: "/admin/subscriptions" },
  { icon: Users2, label: "Partners", path: "/admin/partners" },
  { icon: ListChecks, label: "Leads", path: "/admin/leads" },
  { icon: Wallet, label: "Payouts", path: "/admin/payouts" },
  { icon: Bell, label: "Notifications", path: "/admin/notifications" },
  { icon: Globe, label: "Domains", path: "/admin/domains" },
  { icon: Settings, label: "Settings", path: "/admin/settings" },
];

const SuperAdminLayout = ({ children }: { children: ReactNode }) => {
  const [collapsed, setCollapsed] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className={`${collapsed ? "w-16" : "w-64"} bg-sidebar flex flex-col border-r border-sidebar-border transition-all duration-300 hidden lg:flex`}>
        <div className="flex items-center gap-2 px-4 h-16 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-destructive/80 flex items-center justify-center flex-shrink-0">
            <Shield className="w-4 h-4 text-destructive-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-base font-bold font-display text-sidebar-foreground">Libriofy</span>
              <span className="text-[10px] text-sidebar-foreground/50 -mt-0.5">Super Admin</span>
            </div>
          )}
        </div>

        <nav className="flex-1 py-4 space-y-1 px-2">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
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
          {user && (
            <button
              onClick={async () => { await signOut(); navigate("/auth"); }}
              className="flex items-center gap-3 px-5 py-3 text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors w-full"
            >
              <LogOut className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Sign Out</span>}
            </button>
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
            <div className="w-8 h-8 rounded-lg bg-destructive/80 flex items-center justify-center">
              <Shield className="w-4 h-4 text-destructive-foreground" />
            </div>
            <span className="font-bold font-display text-foreground">Super Admin</span>
          </div>
          <div className="hidden lg:block">
            <h1 className="text-lg font-semibold font-display text-foreground">Platform Administration</h1>
          </div>
          <div className="flex items-center gap-3">
            <InstallAppButton size="sm" variant="outline" className="hidden sm:inline-flex">
              Install App
            </InstallAppButton>
            <NotificationBell notificationsPath="/admin/notifications" showLibraryName />
            <div className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center text-xs font-medium text-destructive">
              SA
            </div>
          </div>
        </header>

        {/* Mobile nav */}
        <div className="lg:hidden border-b border-border bg-card overflow-x-auto">
          <div className="flex px-2 py-2 gap-1">
            {navItems.map((item) => {
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
          {children}
        </main>
      </div>
    </div>
  );
};

export default SuperAdminLayout;
