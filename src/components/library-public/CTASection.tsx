import type { CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import type { WebsiteBackgroundType } from "@/lib/libraryWebsiteTheme";

interface CTASectionProps {
  brandColor: string;
  onBookSeat: () => void;
  title?: string | null;
  subtitle?: string | null;
  backgroundStyle?: CSSProperties;
  backgroundType?: WebsiteBackgroundType;
  titleColor?: string;
  subtitleColor?: string;
  buttonColor?: string;
  buttonTextColor?: string;
}

const CTASection = ({
  brandColor,
  onBookSeat,
  title,
  subtitle,
  backgroundStyle,
  backgroundType = "color",
  titleColor = "#ffffff",
  subtitleColor = "#ffffff",
  buttonColor = "#ffffff",
  buttonTextColor = "#0f172a",
}: CTASectionProps) => (
  <section className="py-20" style={backgroundStyle || { background: `linear-gradient(135deg, ${brandColor}, ${brandColor}cc)` }}>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="container mx-auto px-4 text-center"
    >
      <div className={backgroundType === "image" ? "mx-auto max-w-3xl rounded-3xl bg-black/25 p-8 backdrop-blur-sm" : ""}>
        <h2 className="mb-4 text-3xl font-bold font-display sm:text-4xl" style={{ color: titleColor }}>
          {title || "Book Your Seat Today"}
        </h2>
        <p className="mx-auto mb-8 max-w-md" style={{ color: subtitleColor }}>
          {subtitle || "Join hundreds of focused students. Limited seats available - reserve yours now."}
        </p>
        <Button
          size="lg"
          onClick={onBookSeat}
          className="font-semibold text-base px-8"
          style={{ backgroundColor: buttonColor, color: buttonTextColor }}
        >
          Book Now <ChevronRight className="w-5 h-5 ml-1" />
        </Button>
      </div>
    </motion.div>
  </section>
);

export default CTASection;

