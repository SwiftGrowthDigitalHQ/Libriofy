import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface CTASectionProps {
  brandColor: string;
  onBookSeat: () => void;
}

const CTASection = ({ brandColor, onBookSeat }: CTASectionProps) => (
  <section className="py-20" style={{ background: `linear-gradient(135deg, ${brandColor}, ${brandColor}cc)` }}>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="container mx-auto px-4 text-center"
    >
      <h2 className="text-3xl sm:text-4xl font-bold font-display text-primary-foreground mb-4">
        Book Your Seat Today
      </h2>
      <p className="text-primary-foreground/80 mb-8 max-w-md mx-auto">
        Join hundreds of focused students. Limited seats available — reserve yours now.
      </p>
      <Button
        size="lg"
        onClick={onBookSeat}
        className="bg-background text-foreground hover:bg-background/90 font-semibold text-base px-8"
      >
        Book Now <ChevronRight className="w-5 h-5 ml-1" />
      </Button>
    </motion.div>
  </section>
);

export default CTASection;
