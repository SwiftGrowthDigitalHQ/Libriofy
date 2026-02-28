import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { 
  BookOpen, LayoutDashboard, LayoutGrid, Users, 
  CreditCard, CalendarClock, BarChart3, Settings, 
  ChevronLeft, Bell, Globe, Shield, LogOut, ScanLine, QrCode
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsSuperAdmin } from "@/hooks/useUserRole";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: LayoutGrid, label: "Seat Map", path: "/dashboard/seats" },
  { icon: Users, label: "Students", path: "/dashboard/students" },
  { icon: ScanLine, label: "Attendance", path: "/dashboard/attendance" },
  { icon: QrCode, label: "QR Passes", path: "/dashboard/qr-codes" },
  { icon: CreditCard, label: "Payments", path: "/dashboard/payments" },
  { icon: CalendarClock, label: "Plans & Slots", path: "/dashboard/plans" },
  { icon: BarChart3, label: "Analytics", path: "/dashboard/analytics" },
  { icon: Globe, label: "Public Page", path: "/library/demo" },
  { icon: Settings, label: "Settings", path: "/dashboard/settings" },
];

const DashboardLayout = ({ children }: { children: ReactNode }) => {
  const [collapsed, setCollapsed] = useState(false);
  const { user, signOut } = useAuth();
  const { isSuperAdmin } = useIsSuperAdmin();
  const navigate = useNavigate();

  const allNavItems = isSuperAdmin
    ? [{ icon: Shield, label: "Super Admin", path: "/admin" }, ...navItems]
    : navItems;
  const location = useLocation();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className={`${collapsed ? "w-16" : "w-64"} bg-sidebar flex flex-col border-r border-sidebar-border transition-all duration-300 hidden lg:flex`}>
        <div className="flex items-center gap-2 px-4 h-16 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && <span className="text-base font-bold font-display text-sidebar-foreground">SwiftGrowth</span>}
        </div>

        <nav className="flex-1 py-4 space-y-1 px-2">
          {allNavItems.map((item) => {
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
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold font-display text-foreground">SwiftGrowth</span>
          </div>
          <div className="hidden lg:block">
            <h1 className="text-lg font-semibold font-display text-foreground">City Study Hub</h1>
          </div>
          <div className="flex items-center gap-3">
            <button className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors relative">
              <Bell className="w-4 h-4" />
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent border-2 border-card" />
            </button>
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">
              AK
            </div>
          </div>
        </header>

        {/* Mobile nav */}
        <div className="lg:hidden border-b border-border bg-card overflow-x-auto">
          <div className="flex px-2 py-2 gap-1">
            {allNavItems.slice(0, 6).map((item) => {
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

export default DashboardLayout;
