import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const plans = [
  {
    name: "Starter",
    price: "Rs 2,999",
    period: "/month",
    desc: "Perfect for single-branch libraries",
    features: ["Up to 50 seats", "Up to 30 lockers", "Seat management", "Basic analytics", "Notifications"],
    highlighted: false,
  },
  {
    name: "Growth",
    price: "₹4,999",
    period: "/month",
    desc: "For growing library networks",
    features: [
      "Up to 150 seats",
      "Up to 80 lockers",
      "Seat management",
      "Advanced analytics",
      "Notifications",
      "Export",
      "WhatsApp Payment Reminders (Automated)",
    ],
    highlighted: true,
  },
  {
    name: "Pro",
    price: "₹9,999",
    period: "/month",
    desc: "For large-scale operations",
    features: [
      "Up to 500 seats",
      "Up to 200 lockers",
      "AI Calling Reminders (Auto voice calls)",
      "WhatsApp Reminders (Advanced automation)",
      "All features",
      "Custom domain",
      "Priority support",
    ],
    highlighted: false,
  },
];

const PricingSection = () => {
  return (
    <section className="bg-secondary/30 py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          className="mb-16 text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="mb-4 text-3xl font-bold font-display text-foreground sm:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="text-lg text-muted-foreground">Start with a 7-day free trial. Scale as you grow.</p>
        </motion.div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 md:grid-cols-3">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              className={`relative rounded-2xl p-8 ${
                plan.highlighted ? "scale-105 bg-primary text-primary-foreground shadow-glow" : "border border-border bg-card"
              }`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
            >
              {plan.highlighted ? (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 py-1 text-xs font-semibold text-accent-foreground">
                  Most Popular
                </div>
              ) : null}

              <h3 className="mb-2 text-xl font-bold font-display">{plan.name}</h3>
              <p className={`mb-6 text-sm ${plan.highlighted ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                {plan.desc}
              </p>
              <div className="mb-6">
                <span className="text-4xl font-bold font-display">{plan.price}</span>
                <span className={`text-sm ${plan.highlighted ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                  {plan.period}
                </span>
              </div>
              <ul className="mb-8 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className={`h-4 w-4 flex-shrink-0 ${plan.highlighted ? "text-accent" : "text-primary"}`} />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link to="/dashboard">
                <Button
                  className={`w-full ${
                    plan.highlighted
                      ? "bg-accent text-accent-foreground hover:bg-accent/90"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  }`}
                >
                  Start Free Trial
                </Button>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
