import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string;
  change?: string;
  trend?: "up" | "down";
  icon: LucideIcon;
  iconColor?: string;
}

const StatsCard = ({ title, value, change, trend, icon: Icon, iconColor = "text-primary" }: StatsCardProps) => {
  return (
    <div className="group relative overflow-hidden rounded-[24px] border border-slate-200/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.88))] p-5 shadow-[0_14px_32px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.72)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,23,42,0.09),inset_0_1px_0_rgba(255,255,255,0.82)]">
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/75 to-transparent" />
      <div className="pointer-events-none absolute -right-6 top-2 h-20 w-20 rounded-full bg-cyan-300/10 blur-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="relative flex items-start justify-between">
        <div>
          <p className="mb-1 text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold font-display text-foreground">{value}</p>
          {change && (
            <div className={`mt-2 flex items-center gap-1 text-xs font-medium ${trend === "up" ? "text-success" : "text-destructive"}`}>
              {trend === "up" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {change}
            </div>
          )}
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(240,249,255,0.78))] shadow-[0_10px_22px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]">
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
      </div>
    </div>
  );
};

export default StatsCard;
