import { Wifi, Wind, Zap, Shield, Droplets, VolumeX } from "lucide-react";
import { motion } from "framer-motion";

const facilities = [
  { icon: Wifi, label: "High Speed WiFi", desc: "Uninterrupted connectivity" },
  { icon: Wind, label: "Fully Air Conditioned", desc: "Comfortable temperature" },
  { icon: Zap, label: "Power Backup", desc: "24/7 electricity assured" },
  { icon: Shield, label: "CCTV Security", desc: "Safe & monitored space" },
  { icon: Droplets, label: "Drinking Water", desc: "RO purified water" },
  { icon: VolumeX, label: "Silent Study Zone", desc: "Zero disturbance policy" },
];

interface FacilitiesSectionProps {
  headingColor?: string;
}

const FacilitiesSection = ({ headingColor }: FacilitiesSectionProps) => (
  <section className="py-16">
    <div className="container mx-auto px-4 max-w-5xl">
      <h2 className="text-2xl sm:text-3xl font-bold font-display text-center mb-2" style={headingColor ? { color: headingColor } : undefined}>
        Facilities
      </h2>
      <p className="text-muted-foreground text-center mb-10">Everything you need for focused studying</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
        {facilities.map((f, i) => (
          <motion.div
            key={f.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
            className="bg-card rounded-xl border border-border p-6 text-center hover:shadow-lg transition-shadow"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <f.icon className="w-6 h-6 text-primary" />
            </div>
            <h3 className="font-semibold font-display text-foreground text-sm">{f.label}</h3>
            <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default FacilitiesSection;
