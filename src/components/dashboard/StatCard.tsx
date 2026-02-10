import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  status?: "success" | "warning" | "error" | "idle";
}

const StatCard = ({ title, value, subtitle, icon: Icon, status }: StatCardProps) => {
  return (
    <div className="bg-card border border-border rounded-lg p-5 card-glow">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-semibold font-mono text-foreground">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
      {status && (
        <div className="mt-3 flex items-center gap-1.5">
          <span className={`status-dot-${status}`} />
          <span className="text-[11px] text-muted-foreground font-mono capitalize">{status}</span>
        </div>
      )}
    </div>
  );
};

export default StatCard;
