import { useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, MapPin, Clock, Users, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";

const plans = [
  { name: "4 Hour", price: "₹2,000/mo", features: ["Any 4-hour slot", "Reserved seat", "Wi-Fi access"] },
  { name: "6 Hour", price: "₹3,000/mo", features: ["Any 6-hour slot", "Reserved seat", "Wi-Fi access", "Locker"] },
  { name: "Full Day", price: "₹4,500/mo", features: ["6AM – 10PM access", "Reserved seat", "Wi-Fi + Locker", "Priority support"], popular: true },
];

const slots = [
  { label: "Morning (6AM–10AM)", available: 3 },
  { label: "Forenoon (10AM–2PM)", available: 7 },
  { label: "Afternoon (2PM–6PM)", available: 12 },
  { label: "Evening (6PM–10PM)", available: 1 },
];

const LibraryPublicPage = () => {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-hero-gradient text-primary-foreground py-16 sm:py-24">
        <div className="container mx-auto px-4 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="w-14 h-14 rounded-2xl bg-primary/30 flex items-center justify-center mx-auto mb-6">
              <BookOpen className="w-7 h-7 text-primary-foreground" />
            </div>
            <h1 className="text-3xl sm:text-5xl font-bold font-display mb-4">City Study Hub</h1>
            <div className="flex items-center justify-center gap-4 text-primary-foreground/60 text-sm">
              <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> Koramangala, Bangalore</span>
              <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> 6AM – 10PM</span>
              <span className="flex items-center gap-1"><Users className="w-4 h-4" /> 40 seats</span>
            </div>
          </motion.div>
        </div>
      </header>

      {/* Live Availability */}
      <section className="py-12">
        <div className="container mx-auto px-4 max-w-4xl">
          <h2 className="text-2xl font-bold font-display text-foreground mb-6">Live Seat Availability</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {slots.map((slot) => (
              <div key={slot.label} className="bg-card rounded-xl border border-border p-4 text-center">
                <p className="text-xs text-muted-foreground mb-2">{slot.label}</p>
                <p className={`text-2xl font-bold font-display ${slot.available <= 3 ? "text-destructive" : "text-success"}`}>
                  {slot.available}
                </p>
                <p className="text-xs text-muted-foreground">seats left</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section className="py-12 bg-secondary/30">
        <div className="container mx-auto px-4 max-w-4xl">
          <h2 className="text-2xl font-bold font-display text-foreground mb-6">Plans</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <div key={plan.name} className={`relative bg-card rounded-xl border p-6 ${plan.popular ? "border-primary shadow-glow" : "border-border"}`}>
                {plan.popular && (
                  <Badge className="absolute -top-2.5 left-4 bg-accent text-accent-foreground">Popular</Badge>
                )}
                <h3 className="text-lg font-bold font-display text-foreground">{plan.name}</h3>
                <p className="text-2xl font-bold font-display text-primary mt-2">{plan.price}</p>
                <ul className="mt-4 space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full mt-6 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => setShowForm(true)}
                >
                  Book Now <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Admission Form */}
      {showForm && (
        <section className="py-12" id="admission">
          <div className="container mx-auto px-4 max-w-lg">
            <motion.div
              className="bg-card rounded-2xl border border-border p-6 sm:p-8"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h2 className="text-xl font-bold font-display text-foreground mb-6">Admission Form</h2>
              <div className="space-y-4">
                <div>
                  <Label>Full Name</Label>
                  <Input placeholder="Enter your name" className="mt-1" />
                </div>
                <div>
                  <Label>Phone Number</Label>
                  <Input placeholder="10-digit number" className="mt-1" />
                </div>
                <div>
                  <Label>Preferred Plan</Label>
                  <Select>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select a plan" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="4hour">4 Hour – ₹2,000/mo</SelectItem>
                      <SelectItem value="6hour">6 Hour – ₹3,000/mo</SelectItem>
                      <SelectItem value="fullday">Full Day – ₹4,500/mo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Preferred Slot</Label>
                  <Select>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select time slot" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="morning">Morning (6AM–10AM)</SelectItem>
                      <SelectItem value="forenoon">Forenoon (10AM–2PM)</SelectItem>
                      <SelectItem value="afternoon">Afternoon (2PM–6PM)</SelectItem>
                      <SelectItem value="evening">Evening (6PM–10PM)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Start Date</Label>
                  <Input type="date" className="mt-1" />
                </div>
                <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 mt-2">
                  Submit & Proceed to Payment
                </Button>
              </div>
            </motion.div>
          </div>
        </section>
      )}

      {/* Footer link */}
      <div className="py-8 text-center">
        <Link to="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
          Powered by <span className="font-semibold">SwiftGrowth</span>
        </Link>
      </div>
    </div>
  );
};

export default LibraryPublicPage;
