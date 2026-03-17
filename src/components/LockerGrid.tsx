import { cn } from "@/lib/utils";

export type LockerStatus = "available" | "maintenance" | "occupied";

export interface LockerGridItem {
  column: number;
  id: string;
  lockerNumber: string;
  monthlyPrice: number;
  paymentDueDate?: string | null;
  row: number;
  status: LockerStatus;
  studentName?: string | null;
}

interface LockerGridProps {
  emptyMessage?: string;
  isLoading?: boolean;
  lockers: LockerGridItem[];
  onLockerClick?: (locker: LockerGridItem) => void;
  selectedLockerId?: string | null;
}

const statusStyles: Record<LockerStatus, { badge: string; card: string; label: string }> = {
  available: {
    badge: "border-[#b7e7c8] bg-white/85 text-[#166534]",
    card: "border-[#22c55e] bg-[#e6f7ee] text-[#166534] hover:border-[#16a34a]",
    label: "Available",
  },
  occupied: {
    badge: "border-[#f4da75] bg-white/85 text-[#854d0e]",
    card: "border-[#facc15] bg-[#fff8db] text-[#854d0e] hover:border-[#eab308]",
    label: "Occupied",
  },
  maintenance: {
    badge: "border-[#f2b9b7] bg-white/85 text-[#991b1b]",
    card: "border-[#ef4444] bg-[#fff1f1] text-[#991b1b] hover:border-[#dc2626]",
    label: "Maintenance",
  },
};

const LockerGrid = ({
  emptyMessage = "No lockers found.",
  isLoading = false,
  lockers,
  onLockerClick,
  selectedLockerId = null,
}: LockerGridProps) => {
  if (isLoading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading locker map...</p>;
  }

  if (lockers.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
      {lockers.map((locker) => {
        const status = statusStyles[locker.status];

        return (
          <button
            key={locker.id}
            type="button"
            onClick={() => onLockerClick?.(locker)}
            className={cn(
              "rounded-[24px] border p-4 text-left shadow-[0_16px_34px_-26px_rgba(15,23,42,0.35)] transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:shadow-[0_24px_44px_-26px_rgba(15,23,42,0.38)]",
              status.card,
              selectedLockerId === locker.id && "ring-2 ring-[#1f2f26]/15",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-75">Locker</p>
                <h3 className="mt-1 text-lg font-semibold text-current">{locker.lockerNumber}</h3>
              </div>
              <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium", status.badge)}>{status.label}</span>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <p className="text-current/80">Status: {status.label}</p>
              <p className="min-h-10 text-current/90">
                {locker.studentName ? `Student: ${locker.studentName}` : "Student: Unassigned"}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default LockerGrid;
