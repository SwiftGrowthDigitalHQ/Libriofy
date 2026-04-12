import { BookOpen, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useState } from "react";
import InstallAppButton from "@/components/pwa/InstallAppButton";
import { useLandingSectionNavigation } from "@/hooks/useLandingSectionNavigation";

const LandingNav = () => {
  const [open, setOpen] = useState(false);
  const navigateToSection = useLandingSectionNavigation(() => setOpen(false));

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-hero-gradient/80 backdrop-blur-xl border-b border-primary-foreground/5">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold font-display text-primary-foreground">Libriofy</span>
          </Link>

          <div className="hidden md:flex items-center gap-6">
            <button
              type="button"
              onClick={() => navigateToSection("features")}
              className="text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors"
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => navigateToSection("pricing")}
              className="text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors"
            >
              Pricing
            </button>
            <button
              type="button"
              onClick={() => navigateToSection("demo")}
              className="text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors"
            >
              Demo
            </button>
            <InstallAppButton size="sm" variant="outline" className="border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground hover:text-sidebar">
              Install App
            </InstallAppButton>
            <Link to="/dashboard">
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">
                Dashboard
              </Button>
            </Link>
          </div>

          <button className="md:hidden text-primary-foreground" onClick={() => setOpen(!open)}>
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {open && (
          <div className="md:hidden pb-4 space-y-3">
            <button type="button" onClick={() => navigateToSection("features")} className="block py-2 text-sm text-primary-foreground/60">
              Features
            </button>
            <button type="button" onClick={() => navigateToSection("pricing")} className="block py-2 text-sm text-primary-foreground/60">
              Pricing
            </button>
            <button type="button" onClick={() => navigateToSection("demo")} className="block py-2 text-sm text-primary-foreground/60">
              Demo
            </button>
            <InstallAppButton variant="outline" className="w-full border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground hover:text-sidebar">
              Install App
            </InstallAppButton>
            <Link to="/dashboard" onClick={() => setOpen(false)}>
              <Button size="sm" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">Dashboard</Button>
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
};

export default LandingNav;
