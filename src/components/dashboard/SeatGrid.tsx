import { useMemo, useState } from "react";
import { MoonStar, Sun, SunMedium, Sunrise } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SeatSlotStatus = "available" | "booked";
export type SeatSlotKey = "forenoon" | "afternoon" | "morning" | "evening";

export interface SeatSlotItem {
  key: SeatSlotKey;
  label: string;
  shortLabel: string;
  slotId: string | null;
  slotName: string;
  status: SeatSlotStatus;
  student?: string;
  timeLabel?: string;
}

export interface SeatItem {
  id: string;
  bookedCount: number;
  slotStates: SeatSlotItem[];
}

interface SeatGridProps {
  seats: SeatItem[];
  isLoading?: boolean;
  emptyMessage?: string;
  highlightedSlotId?: string | null;
  highlightedSlotName?: string | null;
}

const slotColors: Record<SeatSlotStatus, string> = {
  available: "border-[#22c55e] bg-[#e6f7ee] text-[#166534]",
  booked: "border-[#facc15] bg-[#fff8db] text-[#854d0e]",
};

const slotBadgeColors: Record<SeatSlotStatus, string> = {
  available: "border-[#b7e7c8] bg-white/85 text-[#166534]",
  booked: "border-[#f4da75] bg-white/75 text-[#854d0e]",
};

const quadrantPositionClasses = [
  "items-start justify-start rounded-tl-[0.7rem]",
  "items-start justify-end rounded-tr-[0.7rem]",
  "items-end justify-start rounded-bl-[0.7rem]",
  "items-end justify-end rounded-br-[0.7rem]",
] as const;

const slotMeta = {
  morning: { icon: Sunrise, label: "Morning" },
  forenoon: { icon: SunMedium, label: "Forenoon" },
  afternoon: { icon: Sun, label: "Afternoon" },
  evening: { icon: MoonStar, label: "Evening" },
} as const;

const tooltipSlotOrder: SeatSlotKey[] = ["morning", "forenoon", "afternoon", "evening"];

const SeatGrid = ({
  seats,
  isLoading = false,
  emptyMessage = "No seats found.",
  highlightedSlotId = null,
  highlightedSlotName = null,
}: SeatGridProps) => {
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);

  const counts = useMemo(
    () =>
      seats.reduce(
        (totals, seat) => {
          for (const slot of seat.slotStates) {
            totals[slot.status] += 1;
          }
          return totals;
        },
        { available: 0, booked: 0 },
      ),
    [seats],
  );

  const tooltipSeats = useMemo(
    () =>
      seats.map((seat) => ({
        ...seat,
        tooltipSlotStates: [...seat.slotStates].sort(
          (a, b) => tooltipSlotOrder.indexOf(a.key) - tooltipSlotOrder.indexOf(b.key),
        ),
      })),
    [seats],
  );

  if (isLoading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading seat map...</p>;
  }

  if (seats.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="rounded-[28px] border border-[#e7ece6] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,251,248,0.98))] p-4 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.22)] sm:p-5">
      <div className="mb-5 flex flex-wrap gap-3">
        {[
          { key: "available", label: "Available slots", count: counts.available, dotClass: "border border-[#22c55e] bg-[#e6f7ee]" },
          { key: "booked", label: "Booked slots", count: counts.booked, dotClass: "border border-[#facc15] bg-[#fff8db]" },
          { key: "seats", label: "Total seats", count: seats.length, dotClass: "border border-[#d9e2d5] bg-white" },
        ].map((item) => (
          <div
            key={item.key}
            className="inline-flex items-center gap-2 rounded-full border border-[#edf2eb] bg-white/90 px-3 py-2 text-sm text-[#5f6f64] shadow-[0_8px_20px_-18px_rgba(15,23,42,0.3)]"
          >
            <span className={cn("h-3 w-3 rounded-full shadow-sm", item.dotClass)} />
            <span className="font-medium">{item.label}</span>
            <span className="text-[#1f2f26]">{item.count}</span>
          </div>
        ))}
      </div>

      {highlightedSlotName ? (
        <p className="mb-6 rounded-2xl border border-[#edf2eb] bg-white/75 px-4 py-3 text-sm text-[#6a7a70] shadow-[0_10px_30px_-24px_rgba(15,23,42,0.25)]">
          All slot states stay visible. <span className="font-semibold text-[#1f2f26]">{highlightedSlotName}</span> is highlighted across the grid.
        </p>
      ) : null}

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3 lg:grid-cols-8">
        {tooltipSeats.map((seat) => (
          <Tooltip key={seat.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-pressed={selectedSeat === seat.id}
                onClick={() => setSelectedSeat(seat.id)}
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-2xl border bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,250,246,0.95))] shadow-[0_14px_32px_-22px_rgba(15,23,42,0.3)] transition-[transform,box-shadow,border-color,background-color] duration-300 ease-out",
                  "hover:-translate-y-1 hover:scale-[1.03] hover:shadow-[0_24px_52px_-24px_rgba(15,23,42,0.34)]",
                  seat.bookedCount > 0 ? "border-[#f0df99] hover:border-[#facc15]" : "border-[#d8eadf] hover:border-[#22c55e]",
                  selectedSeat === seat.id ? "ring-2 ring-[#ccead5] ring-offset-2 ring-offset-background" : "",
                )}
              >
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px bg-[#edf2eb] p-px">
                  {seat.slotStates.map((slotState, index) => {
                    const SlotIcon = slotMeta[slotState.key].icon;
                    const isHighlighted = !!highlightedSlotId && slotState.slotId === highlightedSlotId;

                    return (
                      <div
                        key={slotState.key}
                        className={cn(
                          "flex border p-2 text-[11px] font-semibold transition-[background-color,border-color,opacity,box-shadow] duration-300 sm:p-3 sm:text-xs",
                          quadrantPositionClasses[index],
                          slotColors[slotState.status],
                          highlightedSlotId && !isHighlighted && "opacity-75 saturate-75",
                          isHighlighted && "shadow-[inset_0_0_0_1px_rgba(31,47,38,0.12)] ring-1 ring-inset ring-[#a7d8b6]",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold leading-none shadow-[0_8px_18px_-16px_rgba(15,23,42,0.35)] backdrop-blur-sm",
                            slotBadgeColors[slotState.status],
                          )}
                        >
                          <SlotIcon className="h-3 w-3" strokeWidth={2} />
                          {slotState.shortLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/90 bg-white/92 shadow-[0_18px_32px_-20px_rgba(15,23,42,0.45)] ring-1 ring-[#e6ece5] backdrop-blur-sm sm:h-16 sm:w-16">
                    <span className="text-xs font-semibold tracking-[0.08em] text-[#1f2f26] sm:text-sm">{seat.id}</span>
                  </div>
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent
              sideOffset={10}
              className="max-w-72 rounded-2xl border border-[#e7ece6] bg-white p-0 text-[#425248] shadow-[0_24px_60px_-30px_rgba(15,23,42,0.28)]"
            >
              <div className="border-b border-[#edf2eb] px-4 py-3">
                <p className="text-sm font-semibold text-[#1f2f26]">Seat {seat.id}</p>
                <p className="mt-1 text-xs text-[#738378]">{seat.bookedCount} of 4 slots booked</p>
              </div>
              <div className="space-y-2 px-4 py-3">
                {seat.tooltipSlotStates.map((slotState) => {
                  const SlotIcon = slotMeta[slotState.key].icon;

                  return (
                    <div key={slotState.key} className="rounded-xl border border-[#eef2eb] bg-[#fafcf9] px-3 py-2 shadow-[0_10px_24px_-24px_rgba(15,23,42,0.35)]">
                      <div className="flex items-center gap-2 text-xs text-[#4c5b52]">
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#e3ebe1] bg-white px-2 py-1 font-semibold text-[#304136]">
                          <SlotIcon className="h-3 w-3" strokeWidth={2} />
                          {slotState.shortLabel}
                        </span>
                        <span className="font-medium text-[#1f2f26]">{slotState.slotName || slotState.label}</span>
                      </div>
                      <p className="mt-2 text-xs text-[#5d6d63]">
                        {slotState.slotName || slotState.label} {"->"} {slotState.status === "booked" ? "Booked" : "Available"}
                        {slotState.student ? ` (${slotState.student})` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};

export default SeatGrid;
