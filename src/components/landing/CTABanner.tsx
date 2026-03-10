import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const CTABanner = () => (
  <section className="py-24 bg-primary">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="container mx-auto px-4 text-center"
    >
      <h2 className="text-3xl sm:text-4xl font-bold font-display text-primary-foreground mb-4">
        Ready to automate your library?
      </h2>
      <p className="text-primary-foreground/70 mb-8 max-w-lg mx-auto text-lg">
        Join 500+ libraries saving hours every week. Start your 7-day free trial today.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Link to="/dashboard">
          <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground px-8 py-6 text-base font-semibold">
            Start Free Trial
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </Link>
        <Link to="/library/demo">
          <Button
            size="lg"
            variant="outline"
            className="border-2 border-primary-foreground/40 text-primary-foreground bg-transparent hover:bg-primary-foreground/10 px-8 py-6 text-base font-semibold"
          >
            View Demo
          </Button>
        </Link>
      </div>
    </motion.div>
  </section>
);

export default CTABanner;
