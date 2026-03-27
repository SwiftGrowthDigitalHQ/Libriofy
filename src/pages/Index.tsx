import LandingNav from "@/components/landing/LandingNav";
import HeroSection from "@/components/landing/HeroSection";
import ProductDemoSection from "@/components/landing/ProductDemoSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import PricingSection from "@/components/landing/PricingSection";
import CTABanner from "@/components/landing/CTABanner";
import LandingFooter from "@/components/landing/LandingFooter";

const Index = () => {
  return (
    <div className="min-h-screen">
      <LandingNav />
      <HeroSection />
      <ProductDemoSection />
      <div id="features"><FeaturesSection /></div>
      <div id="pricing"><PricingSection /></div>
      <CTABanner />
      <LandingFooter />
    </div>
  );
};

export default Index;
