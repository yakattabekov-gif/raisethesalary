import { Clock, Activity, CheckCircle2, XCircle, Timer, Zap } from "lucide-react";
import StatCard from "@/components/dashboard/StatCard";
import { useCronRuns } from "@/hooks/useCronRuns";
import { useProcessedTasks } from "@/hooks/useProcessedTasks";
import { useSettings } from "@/hooks/useSettings";
import { formatDistanceToNow } from "date-fns";

const Dashboard = () => {
  const { data: cronRuns } = useCronRuns();
  const { data: tasks } = useProcessedTasks();
  const { data: settings } = useSettings();

  const lastRun = cronRuns?.[0];
  const isDryRun = settings?.find(s => s.key === "dry_run")?.value === "true";
  const aiEnabled = settings?.find(s => s.key === "ai_enabled")?.value === "true";

  const successCount = tasks?.filter(t => t.status === "completed").length ?? 0;
  const errorCount = tasks?.filter(t => t.status === "error").length ?? 0;
  const totalProcessed = tasks?.length ?? 0;

  return (
    <div className="p-8 space-y-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Мониторинг автоматизации Jira → Spark</p>
      </div>

      {/* Status banner */}
      <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={isDryRun ? "status-dot-warning" : "status-dot-success"} />
            <span className="text-sm font-mono">
              {isDryRun ? "DRY-RUN" : "PRODUCTION"}
            </span>
          </div>
          <div className="w-px h-5 bg-border" />
          <div className="flex items-center gap-2">
            <span className={aiEnabled ? "status-dot-success" : "status-dot-idle"} />
            <span className="text-sm font-mono">AI {aiEnabled ? "ON" : "OFF"}</span>
          </div>
        </div>
        {lastRun && (
          <span className="text-xs text-muted-foreground font-mono">
            Last cron: {formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true })}
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Cron Status"
          value={lastRun?.status === "running" ? "Running" : lastRun?.status === "completed" ? "Idle" : "—"}
          subtitle={lastRun ? `${lastRun.tasks_found} tasks found` : "No runs yet"}
          icon={Timer}
          status={lastRun?.status === "running" ? "warning" : lastRun?.status === "completed" ? "success" : "idle"}
        />
        <StatCard
          title="Total Processed"
          value={totalProcessed}
          subtitle="All time"
          icon={Activity}
          status="idle"
        />
        <StatCard
          title="Successful"
          value={successCount}
          icon={CheckCircle2}
          status="success"
        />
        <StatCard
          title="Errors"
          value={errorCount}
          icon={XCircle}
          status={errorCount > 0 ? "error" : "idle"}
        />
      </div>

      {/* Recent cron runs */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Recent Cron Runs</h2>
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Time</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Found</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Processed</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cronRuns?.slice(0, 10).map((run) => (
                <tr key={run.id} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {new Date(run.started_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-mono ${
                      run.status === "completed" ? "text-primary" :
                      run.status === "running" ? "text-warning" : "text-destructive"
                    }`}>
                      <span className={`status-dot-${run.status === "completed" ? "success" : run.status === "running" ? "warning" : "error"}`} />
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{run.tasks_found}</td>
                  <td className="px-4 py-3 font-mono text-xs">{run.tasks_processed}</td>
                  <td className="px-4 py-3 text-xs text-destructive truncate max-w-[200px]">
                    {run.error_message || "—"}
                  </td>
                </tr>
              ))}
              {(!cronRuns || cronRuns.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No cron runs yet. Configure settings to start.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
