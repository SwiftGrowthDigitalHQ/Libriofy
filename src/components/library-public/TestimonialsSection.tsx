import { Star } from "lucide-react";
import { motion } from "framer-motion";

interface Testimonial {
  name: string;
  text: string;
  rating: number;
}

interface TestimonialsSectionProps {
  testimonials?: Testimonial[];
}

const defaultTestimonials: Testimonial[] = [
  { name: "Priya Sharma", text: "Best library for deep focus. The silent zone is incredible - I cleared my exam in the first attempt!", rating: 5 },
  { name: "Rahul Verma", text: "Very silent environment with excellent facilities. AC, WiFi, and power backup make it perfect for long study sessions.", rating: 5 },
  { name: "Sneha Patel", text: "Comfortable seating and great ambiance. The staff is very supportive and the location is convenient.", rating: 5 },
];

const TestimonialsSection = ({ testimonials }: TestimonialsSectionProps) => {
  const items = testimonials && testimonials.length > 0 ? testimonials : defaultTestimonials;

  return (
    <section className="py-16">
      <div className="container mx-auto px-4 max-w-5xl">
        <h2 className="text-2xl sm:text-3xl font-bold font-display text-foreground text-center mb-2">
          What Our Students Say
        </h2>
        <p className="text-muted-foreground text-center mb-10">Trusted by hundreds of serious learners</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {items.map((t, i) => (
            <motion.div
              key={`${t.name}-${i}`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="bg-card rounded-xl border border-border p-6"
            >
              <div className="flex gap-0.5 mb-3">
                {Array.from({ length: Math.max(1, t.rating) }).map((_, j) => (
                  <Star key={j} className="w-4 h-4 fill-accent text-accent" />
                ))}
              </div>
              <p className="text-sm text-muted-foreground mb-4 italic">"{t.text}"</p>
              <p className="font-semibold font-display text-foreground text-sm">{t.name}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
