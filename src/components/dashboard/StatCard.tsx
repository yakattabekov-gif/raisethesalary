import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  status?: "success" | "warning" | "error" | "idle";
}

const StatCard = ({ title, value, subtitle, icon: Icon, status }: StatCardProps) => {
  const iconColor = status === "success" ? "text-primary" : 
    status === "error" ? "text-destructive" : 
    status === "warning" ? "text-warning" : "text-muted-foreground";

  return (
    <div className="glass-card glow-border p-5 animate-slide-in">
      <div className="flex items-center justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          status === "success" ? "bg-primary/10" :
          status === "error" ? "bg-destructive/10" :
          status === "warning" ? "bg-warning/10" : "bg-secondary"
        }`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        {status && <span className={`status-dot-${status}`} />}
      </div>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">{title}</p>
      <p className="text-3xl font-bold font-mono text-foreground tracking-tight">{value}</p>
      {subtitle && (
        <p className="text-[12px] text-muted-foreground mt-1">{subtitle}</p>
      )}
    </div>
  );
};

export default StatCard;
