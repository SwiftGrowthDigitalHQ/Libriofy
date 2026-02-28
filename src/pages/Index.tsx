import LandingNav from "@/components/landing/LandingNav";
import HeroSection from "@/components/landing/HeroSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import PricingSection from "@/components/landing/PricingSection";
import { BookOpen } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen">
      <LandingNav />
      <HeroSection />
      <div id="features"><FeaturesSection /></div>
      <div id="pricing"><PricingSection /></div>

      {/* Footer */}
      <footer className="bg-sidebar py-12 border-t border-sidebar-border">
        <div className="container mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            <span className="text-lg font-bold font-display text-sidebar-foreground">SwiftGrowth</span>
          </div>
          <p className="text-sm text-sidebar-foreground/50">
            © 2026 SwiftGrowth Library Automation. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
