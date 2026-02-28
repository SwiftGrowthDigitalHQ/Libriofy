import DashboardLayout from "@/components/dashboard/DashboardLayout";
import SeatGrid from "@/components/dashboard/SeatGrid";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SeatMapPage = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Seat Map</h2>
            <p className="text-sm text-muted-foreground mt-1">Visual overview of all seats and their status</p>
          </div>
          <Select defaultValue="morning">
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select slot" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="morning">Morning (6AM–10AM)</SelectItem>
              <SelectItem value="forenoon">Forenoon (10AM–2PM)</SelectItem>
              <SelectItem value="afternoon">Afternoon (2PM–6PM)</SelectItem>
              <SelectItem value="evening">Evening (6PM–10PM)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-card rounded-xl border border-border p-6">
          <SeatGrid />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default SeatMapPage;
