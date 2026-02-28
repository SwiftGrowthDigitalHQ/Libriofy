import { motion } from "framer-motion";
import { 
  LayoutGrid, CreditCard, UserCheck, BarChart3, 
  CalendarClock, Bell, QrCode, Users 
} from "lucide-react";

const features = [
  { icon: LayoutGrid, title: "Visual Seat Map", desc: "Interactive seat grid with real-time availability and slot-based allocation." },
  { icon: CreditCard, title: "Automated Payments", desc: "Collect payments, track history, and auto-activate seats on confirmation." },
  { icon: CalendarClock, title: "Smart Renewals", desc: "Auto reminders before expiry. Seats release automatically on lapse." },
  { icon: QrCode, title: "QR Attendance", desc: "Students check in via QR code or mobile. No-show detection built in." },
  { icon: Users, title: "Waiting List", desc: "FIFO queue with auto-notifications and timed confirmation windows." },
  { icon: UserCheck, title: "Self-Service Admission", desc: "Students register online — pick plan, slot, seat, and pay instantly." },
  { icon: BarChart3, title: "Revenue Analytics", desc: "Track occupancy, revenue trends, and get smart pricing suggestions." },
  { icon: Bell, title: "Smart Notifications", desc: "Booking, payment, renewal, and expiry alerts — all automated." },
];

const FeaturesSection = () => {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div 
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="text-3xl sm:text-4xl font-bold font-display text-foreground mb-4">
            Everything you need to run a modern library
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            From admissions to analytics, every workflow is automated.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              className="group p-6 rounded-xl bg-card border border-border hover:border-primary/30 hover:shadow-lg transition-all duration-300"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold font-display text-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
