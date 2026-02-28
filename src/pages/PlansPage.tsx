import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus, Edit2, Clock } from "lucide-react";

const plans = [
  { name: "4 Hour", price: "₹2,000", duration: "4 hours/day", students: 12 },
  { name: "6 Hour", price: "₹3,000", duration: "6 hours/day", students: 14 },
  { name: "Full Day", price: "₹4,500", duration: "16 hours/day", students: 8 },
];

const timeSlots = [
  { label: "Morning", time: "6:00 AM – 10:00 AM", capacity: 40 },
  { label: "Forenoon", time: "10:00 AM – 2:00 PM", capacity: 40 },
  { label: "Afternoon", time: "2:00 PM – 6:00 PM", capacity: 40 },
  { label: "Evening", time: "6:00 PM – 10:00 PM", capacity: 40 },
];

const PlansPage = () => (
  <DashboardLayout>
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold font-display text-foreground">Plans & Slots</h2>
        <p className="text-sm text-muted-foreground mt-1">Configure pricing plans and time slots</p>
      </div>

      {/* Plans */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold font-display text-foreground">Plans</h3>
          <Button size="sm" variant="outline"><Plus className="w-4 h-4 mr-1" /> Add Plan</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {plans.map((p) => (
            <Card key={p.name} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold font-display text-foreground">{p.name}</h4>
                  <p className="text-2xl font-bold text-primary mt-1">{p.price}<span className="text-sm text-muted-foreground font-normal">/mo</span></p>
                </div>
                <Button size="icon" variant="ghost"><Edit2 className="w-4 h-4" /></Button>
              </div>
              <p className="text-sm text-muted-foreground mt-2">{p.duration}</p>
              <p className="text-xs text-muted-foreground mt-1">{p.students} active students</p>
            </Card>
          ))}
        </div>
      </div>

      {/* Time Slots */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold font-display text-foreground">Time Slots</h3>
          <Button size="sm" variant="outline"><Plus className="w-4 h-4 mr-1" /> Add Slot</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {timeSlots.map((s) => (
            <Card key={s.label} className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-primary" />
                <h4 className="font-semibold font-display text-foreground">{s.label}</h4>
              </div>
              <p className="text-sm text-muted-foreground">{s.time}</p>
              <p className="text-xs text-muted-foreground mt-1">Capacity: {s.capacity} seats</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  </DashboardLayout>
);

export default PlansPage;
