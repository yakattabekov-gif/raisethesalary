import { Activity, CheckCircle2, XCircle, Timer, Play, Clock, Zap, TrendingUp } from "lucide-react";
import { useCronRuns } from "@/hooks/useCronRuns";
import { useProcessedTasks } from "@/hooks/useProcessedTasks";
import { useSettings } from "@/hooks/useSettings";
import { formatDistanceToNow, format } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";

const MiniSparkline = ({ data }: { data: number[] }) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 120;
  const h = 40;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - (v / max) * h * 0.8 - h * 0.1;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} className="opacity-60">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="1" />
        </linearGradient>
      </defs>
      <polyline
        points={points}
        fill="none"
        stroke="url(#spark-grad)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const StatusDot = ({ active }: { active: boolean }) => (
  <span className={`inline-block w-2 h-2 rounded-full ${active ? "bg-success animate-pulse" : "bg-muted-foreground/30"}`} />
);

const Dashboard = () => {
  const { data: cronRuns } = useCronRuns();
  const { data: tasks } = useProcessedTasks();
  const { data: settings } = useSettings();
  const [triggerLoading, setTriggerLoading] = useState(false);

  const lastRun = cronRuns?.[0];
  const botEnabled = settings?.find(s => s.key === "bot_enabled")?.value !== "false";
  const aiEnabled = settings?.find(s => s.key === "ai_enabled")?.value === "true";
  const dryRun = settings?.find(s => s.key === "dry_run")?.value === "true";

  const successCount = tasks?.filter(t => t.status === "completed").length ?? 0;
  const errorCount = tasks?.filter(t => t.status === "error").length ?? 0;
  const totalProcessed = tasks?.length ?? 0;
  const sparklineData = cronRuns?.slice(0, 12).reverse().map(r => r.tasks_processed ?? 0) ?? [];

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

  const statusBadge = (status: string) => {
    if (status === "completed") return <span className="pill-success">✓ Готов</span>;
    if (status === "running") return <span className="pill-warning">⟳ В работе</span>;
    if (status === "error") return <span className="pill-error">✕ Ошибка</span>;
    return <span className="pill-idle">{status}</span>;
  };

  return (
    <div className="space-y-8">
      {/* Hero header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">
            Обзор системы
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Автоматизация Jira → Spark · {lastRun
              ? `Последний запуск ${formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true, locale: ru })}`
              : "Нет данных"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dryRun && <span className="pill-warning text-[11px] font-semibold">DRY-RUN</span>}
          <Button
            onClick={handleTrigger}
            disabled={triggerLoading}
            size="sm"
            className="rounded-full gap-2 font-semibold shadow-sm"
          >
            <Play className="w-3.5 h-3.5" />
            {triggerLoading ? "Запуск..." : "Запустить сейчас"}
          </Button>
        </div>
      </div>

      {/* System status bar */}
      <div className="bg-card border border-border rounded-2xl p-4 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <StatusDot active={botEnabled} />
          <span className="text-sm font-medium text-foreground">Бот {botEnabled ? "активен" : "выключен"}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <StatusDot active={aiEnabled} />
          <span className="text-sm text-muted-foreground">AI-парсинг {aiEnabled ? "вкл" : "выкл"}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Крон: каждые {settings?.find(s => s.key === "jira_cron_schedule")?.value || "2 мин"}
          </span>
        </div>
      </div>

      {/* Bento stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Статус крона",
            value: lastRun?.status === "completed" ? "Готов" : lastRun?.status === "running" ? "Работает" : "—",
            sub: lastRun ? `${lastRun.tasks_found} задач найдено` : "Нет запусков",
            icon: Timer,
            accent: lastRun?.status === "completed" ? "text-success" : "text-warning",
            bgAccent: lastRun?.status === "completed" ? "bg-success/10" : "bg-warning/10",
          },
          {
            label: "Обработано",
            value: totalProcessed,
            sub: "всего задач",
            icon: Activity,
            accent: "text-primary",
            bgAccent: "bg-primary/10",
            sparkline: true,
          },
          {
            label: "Успешно",
            value: successCount,
            sub: totalProcessed > 0 ? `${Math.round((successCount / totalProcessed) * 100)}%` : "—",
            icon: CheckCircle2,
            accent: "text-success",
            bgAccent: "bg-success/10",
          },
          {
            label: "Ошибки",
            value: errorCount,
            sub: totalProcessed > 0 ? `${Math.round((errorCount / totalProcessed) * 100)}%` : "—",
            icon: XCircle,
            accent: errorCount > 0 ? "text-destructive" : "text-muted-foreground",
            bgAccent: errorCount > 0 ? "bg-destructive/10" : "bg-muted",
          },
        ].map((card) => (
          <div key={card.label} className="bg-card border border-border rounded-2xl p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{card.label}</p>
              <div className={`w-9 h-9 rounded-xl ${card.bgAccent} flex items-center justify-center`}>
                <card.icon className={`w-4.5 h-4.5 ${card.accent}`} />
              </div>
            </div>
            <p className="text-3xl font-extrabold text-foreground tracking-tight">{card.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
            {card.sparkline && sparklineData.length >= 2 && (
              <div className="mt-2">
                <MiniSparkline data={sparklineData} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Recent runs table */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4">Последние запуски</h2>
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Статус</th>
                <th>Найдено</th>
                <th>Обработано</th>
                <th>Длительность</th>
                <th>Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {cronRuns?.slice(0, 15).map((run) => {
                const duration = run.finished_at
                  ? Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)
                  : null;
                return (
                  <tr key={run.id}>
                    <td className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(run.started_at), "dd.MM HH:mm:ss")}
                    </td>
                    <td>{statusBadge(run.status)}</td>
                    <td className="text-sm font-medium">{run.tasks_found}</td>
                    <td className="text-sm font-medium">{run.tasks_processed}</td>
                    <td className="text-sm text-muted-foreground">
                      {duration !== null ? `${duration}с` : "—"}
                    </td>
                    <td className="text-sm text-destructive truncate max-w-[200px]">
                      {run.error_message || "—"}
                    </td>
                  </tr>
                );
              })}
              {(!cronRuns || cronRuns.length === 0) && (
                <tr>
                  <td colSpan={6} className="text-center text-muted-foreground py-16">
                    Нет данных о запусках
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
