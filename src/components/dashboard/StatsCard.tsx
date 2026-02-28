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
    <div className="bg-card rounded-xl border border-border p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-1">{title}</p>
          <p className="text-2xl font-bold font-display text-foreground">{value}</p>
          {change && (
            <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trend === "up" ? "text-success" : "text-destructive"}`}>
              {trend === "up" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {change}
            </div>
          )}
        </div>
        <div className={`w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
      </div>
    </div>
  );
};

export default StatsCard;
