import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import LandingNav from "@/components/landing/LandingNav";
import HeroSection from "@/components/landing/HeroSection";
import ProductDemoSection from "@/components/landing/ProductDemoSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import PricingSection from "@/components/landing/PricingSection";
import CTABanner from "@/components/landing/CTABanner";
import LandingFooter from "@/components/landing/LandingFooter";
import { getLandingSectionFromSearch, scrollToLandingSection } from "@/hooks/useLandingSectionNavigation";

const Index = () => {
  const location = useLocation();

  useEffect(() => {
    const sectionId = getLandingSectionFromSearch(location.search);

    if (!sectionId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToLandingSection(sectionId, "smooth");
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.search]);

  return (
    <div className="min-h-screen">
      <LandingNav />
      <HeroSection />
      <ProductDemoSection />
      <div id="features" className="scroll-mt-24"><FeaturesSection /></div>
      <div id="pricing" className="scroll-mt-24"><PricingSection /></div>
      <CTABanner />
      <LandingFooter />
    </div>
  );
};

export default Index;
