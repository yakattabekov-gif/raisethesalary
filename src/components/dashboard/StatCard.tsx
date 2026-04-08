import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  status?: "success" | "warning" | "error" | "idle";
  sparkline?: number[];
}

const MiniSparkline = ({ data, color }: { data: number[]; color: string }) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 28;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} className="mt-2">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const StatCard = ({ title, value, subtitle, icon: Icon, status, sparkline }: StatCardProps) => {
  const colorMap = {
    success: { icon: "text-success", bg: "bg-success/10", spark: "hsl(142, 71%, 45%)" },
    error: { icon: "text-destructive", bg: "bg-destructive/10", spark: "hsl(0, 72%, 51%)" },
    warning: { icon: "text-warning", bg: "bg-warning/10", spark: "hsl(38, 92%, 50%)" },
    idle: { icon: "text-muted-foreground", bg: "bg-muted", spark: "hsl(215, 16%, 47%)" },
  };

  const c = colorMap[status || "idle"];

  return (
    <div className="bg-card rounded-2xl border border-border p-5 shadow-sm hover:shadow-md transition-shadow duration-200 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">{title}</p>
          <p className="text-3xl font-extrabold text-foreground tracking-tight">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
          {sparkline && <MiniSparkline data={sparkline} color={c.spark} />}
        </div>
        <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-5 h-5 ${c.icon}`} />
        </div>
      </div>
    </div>
  );
};

export default StatCard;
