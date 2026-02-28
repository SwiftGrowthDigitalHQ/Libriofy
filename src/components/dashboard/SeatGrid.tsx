import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type SeatStatus = "available" | "occupied" | "reserved" | "maintenance";

interface Seat {
  id: string;
  status: SeatStatus;
  student?: string;
  slot?: string;
}

const generateSeats = (): Seat[] => {
  const rows = ["A", "B", "C", "D", "E"];
  const cols = 8;
  const seats: Seat[] = [];
  const statuses: SeatStatus[] = ["available", "occupied", "reserved", "maintenance"];
  const names = ["Aarav S.", "Priya M.", "Rahul K.", "Sneha T.", "Vikram P.", "Neha G."];

  for (const row of rows) {
    for (let col = 1; col <= cols; col++) {
      const status = statuses[Math.floor(Math.random() * 4)];
      seats.push({
        id: `${row}${col}`,
        status: status === "maintenance" && Math.random() > 0.1 ? "available" : status,
        student: status === "occupied" ? names[Math.floor(Math.random() * names.length)] : undefined,
        slot: status === "occupied" ? "9AM - 1PM" : undefined,
      });
    }
  }
  return seats;
};

const statusColors: Record<SeatStatus, string> = {
  available: "bg-success/20 border-success/40 text-success hover:bg-success/30",
  occupied: "bg-primary/20 border-primary/40 text-primary",
  reserved: "bg-warning/20 border-warning/40 text-warning",
  maintenance: "bg-muted border-border text-muted-foreground",
};

const SeatGrid = () => {
  const [seats] = useState(generateSeats);
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);

  const counts = {
    available: seats.filter((s) => s.status === "available").length,
    occupied: seats.filter((s) => s.status === "occupied").length,
    reserved: seats.filter((s) => s.status === "reserved").length,
  };

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-6">
        {[
          { status: "available", label: "Available", count: counts.available },
          { status: "occupied", label: "Occupied", count: counts.occupied },
          { status: "reserved", label: "Reserved", count: counts.reserved },
        ].map((item) => (
          <div key={item.status} className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className={`w-3 h-3 rounded-sm ${statusColors[item.status as SeatStatus].split(" ")[0]}`} />
            {item.label} ({item.count})
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-8 gap-2 sm:gap-3">
        {seats.map((seat) => (
          <Tooltip key={seat.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => seat.status === "available" && setSelectedSeat(seat.id)}
                className={`aspect-square rounded-lg border-2 flex items-center justify-center text-xs sm:text-sm font-medium transition-all cursor-pointer ${statusColors[seat.status]} ${
                  selectedSeat === seat.id ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
                } ${seat.status === "available" ? "cursor-pointer" : "cursor-default"}`}
              >
                {seat.id}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">Seat {seat.id}</p>
              <p className="text-xs capitalize">{seat.status}</p>
              {seat.student && <p className="text-xs">{seat.student} • {seat.slot}</p>}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};

export default SeatGrid;
