import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconBg?: string;
  iconColor?: string;
  trend?: { value: string; direction: "up" | "down" | "neutral" };
}

export function StatCard({
  label,
  value,
  icon: Icon,
  iconBg = "bg-surface-container-high",
  iconColor = "text-secondary",
  trend,
}: StatCardProps) {
  return (
    <div className="card-shadow flex flex-col rounded-xl border border-surface-variant bg-surface-container-lowest p-6">
      <div className="mb-4 flex items-start justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg} ${iconColor} shrink-0`}>
          <Icon className="h-5 w-5" />
        </div>
        {trend && (
          <div
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${
              trend.direction === "up"
                ? "bg-secondary-container/30 text-secondary"
                : trend.direction === "down"
                ? "bg-surface-variant/50 text-on-surface-variant"
                : "bg-surface-variant/50 text-on-surface-variant"
            }`}
          >
            {trend.direction === "up" ? (
              <TrendingUp className="h-4 w-4" />
            ) : trend.direction === "down" ? (
              <TrendingDown className="h-4 w-4" />
            ) : null}
            {trend.value}
          </div>
        )}
      </div>
      <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-on-surface-variant">
        {label}
      </h3>
      <p className="text-4xl font-bold text-on-surface">{value}</p>
    </div>
  );
}
