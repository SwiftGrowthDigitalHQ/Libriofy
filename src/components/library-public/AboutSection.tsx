import { BookOpen, Target, Clock } from "lucide-react";
import { motion } from "framer-motion";

interface AboutSectionProps {
  libraryName: string;
  aboutText?: string | null;
  headingColor?: string;
}

const AboutSection = ({ libraryName, aboutText, headingColor }: AboutSectionProps) => (
  <section className="py-16 bg-secondary/30">
    <div className="container mx-auto px-4 max-w-4xl">
      <h2 className="text-2xl sm:text-3xl font-bold font-display text-center mb-2" style={headingColor ? { color: headingColor } : undefined}>
        About {libraryName}
      </h2>
      <p className="text-muted-foreground text-center mb-10 max-w-2xl mx-auto">
        {aboutText || "A premium, distraction-free study space designed for serious learners who value discipline, focus, and results."}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {[
          { icon: Target, title: "Focused Environment", desc: "Strict no-phone policy and silent zones ensure maximum productivity during your study hours." },
          { icon: BookOpen, title: "Quality Infrastructure", desc: "Ergonomic furniture, individual desk lights, and locker facilities for a comfortable experience." },
          { icon: Clock, title: "Flexible Timings", desc: "Multiple time slots to fit your schedule - morning, afternoon, evening, or full-day access." },
        ].map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="text-center"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <item.icon className="w-6 h-6 text-primary" />
            </div>
            <h3 className="font-semibold font-display text-foreground mb-1">{item.title}</h3>
            <p className="text-sm text-muted-foreground">{item.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default AboutSection;
