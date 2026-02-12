import { Clock, Activity, CheckCircle2, XCircle, Timer, Play } from "lucide-react";
import StatCard from "@/components/dashboard/StatCard";
import { useCronRuns } from "@/hooks/useCronRuns";
import { useProcessedTasks } from "@/hooks/useProcessedTasks";
import { useSettings } from "@/hooks/useSettings";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Мониторинг автоматизации Jira → Spark</p>
        </div>
        <div className="flex items-center gap-3">
          {isDryRun && (
            <span className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-warning/10 text-warning border border-warning/20">
              DRY-RUN
            </span>
          )}
          <Button onClick={handleTrigger} disabled={triggerLoading} size="sm" className="gap-2 font-semibold">
            <Play className="w-3.5 h-3.5" />
            {triggerLoading ? "Запуск..." : "Запустить"}
          </Button>
        </div>
      </div>

      {/* Stats */}
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
          subtitle="Всего"
          icon={Activity}
          status="idle"
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
          <h2 className="text-sm font-semibold text-foreground">Последние запуски</h2>
          {lastRun && (
            <span className="text-[11px] font-mono text-muted-foreground">
              {formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true })}
            </span>
          )}
        </div>
        <div className="glass-card overflow-hidden">
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
                  <td className="font-mono text-xs text-muted-foreground">
                    {new Date(run.started_at).toLocaleString()}
                  </td>
                  <td>
                    <span className={`inline-flex items-center gap-2 text-xs font-mono ${
                      run.status === "completed" ? "text-primary" :
                      run.status === "running" ? "text-warning" : "text-destructive"
                    }`}>
                      <span className={`status-dot-${run.status === "completed" ? "success" : run.status === "running" ? "warning" : "error"}`} />
                      {run.status}
                    </span>
                  </td>
                  <td className="font-mono text-xs">{run.tasks_found}</td>
                  <td className="font-mono text-xs">{run.tasks_processed}</td>
                  <td className="text-xs text-destructive truncate max-w-[250px]">
                    {run.error_message || "—"}
                  </td>
                </tr>
              ))}
              {(!cronRuns || cronRuns.length === 0) && (
                <tr>
                  <td colSpan={5} className="text-center text-muted-foreground py-12">
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
