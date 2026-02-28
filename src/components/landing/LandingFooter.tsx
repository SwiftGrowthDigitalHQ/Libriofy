import { BookOpen, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";

const LandingFooter = () => (
  <footer className="bg-sidebar border-t border-sidebar-border pt-16 pb-8">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-12">
        {/* Brand */}
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            <span className="text-lg font-bold font-display text-sidebar-foreground">Libriofy</span>
          </div>
          <p className="text-sm text-sidebar-foreground/50 leading-relaxed">
            Automate your library operations and maximize every seat.
          </p>
        </div>

        {/* Product */}
        <div>
          <h4 className="text-sm font-semibold font-display text-sidebar-foreground mb-4">Product</h4>
          <ul className="space-y-2 text-sm text-sidebar-foreground/50">
            <li><a href="#features" className="hover:text-sidebar-foreground transition-colors">Features</a></li>
            <li><a href="#pricing" className="hover:text-sidebar-foreground transition-colors">Pricing</a></li>
            <li><Link to="/library/demo" className="hover:text-sidebar-foreground transition-colors">Demo</Link></li>
          </ul>
        </div>

        {/* Company */}
        <div>
          <h4 className="text-sm font-semibold font-display text-sidebar-foreground mb-4">Company</h4>
          <ul className="space-y-2 text-sm text-sidebar-foreground/50">
            <li><a href="#" className="hover:text-sidebar-foreground transition-colors">About</a></li>
            <li><a href="#" className="hover:text-sidebar-foreground transition-colors">Contact</a></li>
            <li><Link to="/dashboard" className="hover:text-sidebar-foreground transition-colors">Support</Link></li>
          </ul>
        </div>

        {/* Legal */}
        <div>
          <h4 className="text-sm font-semibold font-display text-sidebar-foreground mb-4">Legal</h4>
          <ul className="space-y-2 text-sm text-sidebar-foreground/50">
            <li><a href="#" className="hover:text-sidebar-foreground transition-colors">Privacy Policy</a></li>
            <li><a href="#" className="hover:text-sidebar-foreground transition-colors">Terms of Service</a></li>
          </ul>
          <a
            href="https://wa.me/919876543210?text=Hi, I'm interested in Libriofy"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-4 text-sm text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            WhatsApp Support
          </a>
        </div>
      </div>

      <div className="border-t border-sidebar-border pt-6 text-center">
        <p className="text-sm text-sidebar-foreground/50">
          © 2026 Libriofy by Sangita Group. All rights reserved.
        </p>
      </div>
    </div>
  </footer>
);

export default LandingFooter;
