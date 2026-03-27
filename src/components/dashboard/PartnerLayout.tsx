import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Gift, Handshake, LogOut, Megaphone, Users2, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import NotificationBell from "@/components/notifications/NotificationBell";
import InstallAppButton from "@/components/pwa/InstallAppButton";

const navItems = [
  { icon: Handshake, label: "Dashboard", path: "/partner/dashboard" },
  { icon: Users2, label: "Leads", path: "/partner/leads" },
  { icon: Wallet, label: "Payouts", path: "/partner/payouts" },
  { icon: Megaphone, label: "Marketing Kit", path: "/partner/kit" },
];

const PartnerLayout = ({ children }: { children: ReactNode }) => {
  const [collapsed, setCollapsed] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] bg-background overflow-hidden">
      <aside className={`${collapsed ? "w-16" : "w-64"} bg-sidebar flex flex-col border-r border-sidebar-border transition-all duration-300 hidden lg:flex`}>
        <div className="flex items-center gap-2 px-4 h-16 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-primary/90 flex items-center justify-center flex-shrink-0">
            <Gift className="w-4 h-4 text-primary-foreground" />
          </div>
          {!collapsed ? (
            <div className="flex flex-col">
              <span className="text-base font-bold font-display text-sidebar-foreground">Libriofy</span>
              <span className="text-[10px] text-sidebar-foreground/50 -mt-0.5">Partner Portal</span>
            </div>
          ) : null}
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
                {!collapsed ? <span>{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border">
          {user ? (
            <button
              onClick={async () => {
                await signOut();
                navigate("/auth");
              }}
              className="flex items-center gap-3 px-5 py-3 text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors w-full"
            >
              <LogOut className="w-4 h-4 flex-shrink-0" />
              {!collapsed ? <span>Sign Out</span> : null}
            </button>
          ) : null}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-3 w-full text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
          >
            <ChevronLeft className={`w-4 h-4 mx-auto transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 sm:px-6">
          <div className="lg:hidden flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/90 flex items-center justify-center">
              <Gift className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold font-display text-foreground">Partner Portal</span>
          </div>
          <div className="hidden lg:block">
            <h1 className="text-lg font-semibold font-display text-foreground">Partner Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <InstallAppButton size="sm" variant="outline" className="hidden sm:inline-flex">
              Install App
            </InstallAppButton>
            <NotificationBell notificationsPath="/partner/notifications" showLibraryName />
            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-medium text-primary">
              P
            </div>
          </div>
        </header>

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

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
};

export default PartnerLayout;
