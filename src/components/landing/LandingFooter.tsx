import { BookOpen, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";

import { COMPANY_DISPLAY_NAME } from "@/lib/companyInfo";
import { useLandingSectionNavigation } from "@/hooks/useLandingSectionNavigation";
import { getSupportWhatsAppUrl } from "@/lib/supportContact";

const LandingFooter = () => {
  const navigateToSection = useLandingSectionNavigation();

  return (
    <footer className="border-t border-sidebar-border bg-sidebar pt-16 pb-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-12 grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
                <BookOpen className="h-4 w-4 text-sidebar-primary-foreground" />
              </div>
              <span className="text-lg font-bold font-display text-sidebar-foreground">Libriofy</span>
            </div>
            <p className="text-sm leading-relaxed text-sidebar-foreground/50">
              Automate your library operations and maximize every seat.
            </p>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold font-display text-sidebar-foreground">Product</h4>
            <ul className="space-y-2 text-sm text-sidebar-foreground/50">
              <li>
                <button
                  type="button"
                  onClick={() => navigateToSection("features")}
                  className="transition-colors hover:text-sidebar-foreground"
                >
                  Features
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => navigateToSection("pricing")}
                  className="transition-colors hover:text-sidebar-foreground"
                >
                  Pricing
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => navigateToSection("demo")}
                  className="transition-colors hover:text-sidebar-foreground"
                >
                  Demo
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold font-display text-sidebar-foreground">Company</h4>
            <ul className="space-y-2 text-sm text-sidebar-foreground/50">
              <li>
                <Link to="/about" className="transition-colors hover:text-sidebar-foreground">
                  About
                </Link>
              </li>
              <li>
                <Link to="/contact" className="transition-colors hover:text-sidebar-foreground">
                  Contact
                </Link>
              </li>
              <li>
                <Link to="/support" className="transition-colors hover:text-sidebar-foreground">
                  Support
                </Link>
              </li>
              <li>
                <Link to="/partner" className="transition-colors hover:text-sidebar-foreground">
                  Become a Partner
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold font-display text-sidebar-foreground">Legal</h4>
            <ul className="space-y-2 text-sm text-sidebar-foreground/50">
              <li>
                <Link to="/privacy-policy" className="transition-colors hover:text-sidebar-foreground">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="transition-colors hover:text-sidebar-foreground">
                  Terms
                </Link>
              </li>
            </ul>
            <a
              href={getSupportWhatsAppUrl("Hi, I'm interested in Libriofy")}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground"
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp Support
            </a>
          </div>
        </div>

        <div className="border-t border-sidebar-border pt-6 text-center">
          <p className="text-sm text-sidebar-foreground/50">Copyright 2026 {COMPANY_DISPLAY_NAME}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default LandingFooter;
