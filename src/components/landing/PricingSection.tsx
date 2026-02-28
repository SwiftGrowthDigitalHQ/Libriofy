import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const plans = [
  {
    name: "Starter",
    price: "₹999",
    period: "/month",
    desc: "Perfect for single-branch libraries",
    features: ["Up to 50 seats", "1 branch", "Seat management", "Basic analytics", "Email notifications"],
    highlighted: false,
  },
  {
    name: "Growth",
    price: "₹2,499",
    period: "/month",
    desc: "For growing library networks",
    features: ["Up to 200 seats", "3 branches", "QR attendance", "Smart insights", "Priority support", "Payment tracking"],
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For large-scale operations",
    features: ["Unlimited seats", "Unlimited branches", "Custom integrations", "Dedicated support", "API access", "White-label"],
    highlighted: false,
  },
];

const PricingSection = () => {
  return (
    <section className="py-24 bg-secondary/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div 
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="text-3xl sm:text-4xl font-bold font-display text-foreground mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-lg text-muted-foreground">Start free. Scale as you grow.</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              className={`relative rounded-2xl p-8 ${
                plan.highlighted
                  ? "bg-primary text-primary-foreground shadow-glow scale-105"
                  : "bg-card border border-border"
              }`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              {plan.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-accent text-accent-foreground text-xs font-semibold">
                  Most Popular
                </div>
              )}
              <h3 className="text-xl font-bold font-display mb-2">{plan.name}</h3>
              <p className={`text-sm mb-6 ${plan.highlighted ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                {plan.desc}
              </p>
              <div className="mb-6">
                <span className="text-4xl font-bold font-display">{plan.price}</span>
                <span className={`text-sm ${plan.highlighted ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                  {plan.period}
                </span>
              </div>
              <ul className="space-y-3 mb-8">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Check className={`w-4 h-4 flex-shrink-0 ${plan.highlighted ? "text-accent" : "text-primary"}`} />
                    {f}
                  </li>
                ))}
              </ul>
              <Link to="/dashboard">
                <Button
                  className={`w-full ${
                    plan.highlighted
                      ? "bg-accent hover:bg-accent/90 text-accent-foreground"
                      : "bg-primary hover:bg-primary/90 text-primary-foreground"
                  }`}
                >
                  Get Started
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
