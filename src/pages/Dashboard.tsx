import { Activity, CheckCircle2, XCircle, Timer, Play, ArrowRight } from "lucide-react";
import StatCard from "@/components/dashboard/StatCard";
import { useCronRuns } from "@/hooks/useCronRuns";
import { useProcessedTasks } from "@/hooks/useProcessedTasks";
import { useSettings } from "@/hooks/useSettings";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";

const Dashboard = () => {
  const { data: cronRuns } = useCronRuns();
  const { data: tasks } = useProcessedTasks();
  const { data: settings } = useSettings();
  const [triggerLoading, setTriggerLoading] = useState(false);

  const lastRun = cronRuns?.[0];
  const isDryRun = settings?.find(s => s.key === "dry_run")?.value === "true";

  const successCount = tasks?.filter(t => t.status === "completed").length ?? 0;
  const errorCount = tasks?.filter(t => t.status === "error").length ?? 0;
  const totalProcessed = tasks?.length ?? 0;

  // Build sparkline from recent runs
  const sparklineData = cronRuns?.slice(0, 10).reverse().map(r => r.tasks_processed ?? 0) ?? [];

  const handleTrigger = async () => {
    setTriggerLoading(true);
    try {
      const { error } = await supabase.functions.invoke("process-jira-tasks");
      if (error) throw error;
      toast.success("Крон запущен вручную");
    } catch (e: any) {
      toast.error(e.message || "Ошибка запуска");
    } finally {
      setTriggerLoading(false);
    }
  };

  const statusPill = (status: string) => {
    if (status === "completed") return <span className="pill-success">Completed</span>;
    if (status === "running") return <span className="pill-warning">Running</span>;
    if (status === "error") return <span className="pill-error">Error</span>;
    return <span className="pill-idle">{status}</span>;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Мониторинг автоматизации Jira → Spark</p>
        </div>
        <Button
          onClick={handleTrigger}
          disabled={triggerLoading}
          className="rounded-full gap-2 font-semibold shadow-sm"
        >
          <Play className="w-3.5 h-3.5" />
          {triggerLoading ? "Запуск..." : "Запустить"}
        </Button>
      </div>

      {/* Bento Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Статус крона"
          value={lastRun?.status === "running" ? "Работает" : lastRun?.status === "completed" ? "Готов" : "—"}
          subtitle={lastRun ? `${lastRun.tasks_found} задач найдено` : "Нет запусков"}
          icon={Timer}
          status={lastRun?.status === "running" ? "warning" : lastRun?.status === "completed" ? "success" : "idle"}
        />
        <StatCard
          title="Обработано"
          value={totalProcessed}
          subtitle="Всего задач"
          icon={Activity}
          status="idle"
          sparkline={sparklineData.length >= 2 ? sparklineData : undefined}
        />
        <StatCard
          title="Успешно"
          value={successCount}
          icon={CheckCircle2}
          status="success"
        />
        <StatCard
          title="Ошибки"
          value={errorCount}
          icon={XCircle}
          status={errorCount > 0 ? "error" : "idle"}
        />
      </div>

      {/* Recent runs */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">Последние запуски</h2>
          {lastRun && (
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true })}
            </span>
          )}
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Статус</th>
                <th>Найдено</th>
                <th>Обработано</th>
                <th>Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {cronRuns?.slice(0, 10).map((run) => (
                <tr key={run.id}>
                  <td className="text-sm text-muted-foreground">
                    {new Date(run.started_at).toLocaleString()}
                  </td>
                  <td>{statusPill(run.status)}</td>
                  <td className="text-sm">{run.tasks_found}</td>
                  <td className="text-sm">{run.tasks_processed}</td>
                  <td className="text-sm text-destructive truncate max-w-[250px]">
                    {run.error_message || "—"}
                  </td>
                </tr>
              ))}
              {(!cronRuns || cronRuns.length === 0) && (
                <tr>
                  <td colSpan={5} className="text-center text-muted-foreground py-16">
                    Нет запусков. Настройте бота для начала работы.
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
