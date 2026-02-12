import { Activity, CheckCircle2, XCircle, Timer, Play, Clock } from "lucide-react";
import { useCronRuns } from "@/hooks/useCronRuns";
import { useProcessedTasks } from "@/hooks/useProcessedTasks";
import { useSettings } from "@/hooks/useSettings";
import { formatDistanceToNow, format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { motion } from "framer-motion";

const Sparkline = ({ data }: { data: number[] }) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 140;
  const h = 48;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - (v / max) * h * 0.8 - h * 0.1;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} className="mt-2 opacity-70">
      <defs>
        <linearGradient id="spark-spatial" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(250, 80%, 65%)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="hsl(250, 80%, 65%)" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <polyline
        points={points}
        fill="none"
        stroke="url(#spark-spatial)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const stagger = {
  container: { transition: { staggerChildren: 0.08 } },
  item: {
    initial: { opacity: 0, y: 20, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] },
  },
};

const Dashboard = () => {
  const { data: cronRuns } = useCronRuns();
  const { data: tasks } = useProcessedTasks();
  const { data: settings } = useSettings();
  const [triggerLoading, setTriggerLoading] = useState(false);

  const lastRun = cronRuns?.[0];
  const botEnabled = settings?.find(s => s.key === "bot_enabled")?.value !== "false";
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
    if (status === "running") return <span className="pill-warning">⟳ Работает</span>;
    if (status === "error") return <span className="pill-error">✕ Ошибка</span>;
    return <span className="pill-idle">{status}</span>;
  };

  const stats = [
    {
      label: "Статус",
      value: botEnabled ? "Online" : "Off",
      sub: lastRun ? formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true, locale: ru }) : "—",
      icon: Timer,
      color: "text-success",
      glow: botEnabled,
    },
    {
      label: "Обработано",
      value: totalProcessed,
      sub: "всего задач",
      icon: Activity,
      color: "text-primary",
      sparkline: true,
    },
    {
      label: "Успешно",
      value: successCount,
      sub: totalProcessed > 0 ? `${Math.round((successCount / totalProcessed) * 100)}%` : "—",
      icon: CheckCircle2,
      color: "text-success",
    },
    {
      label: "Ошибки",
      value: errorCount,
      sub: totalProcessed > 0 ? `${Math.round((errorCount / totalProcessed) * 100)}%` : "—",
      icon: XCircle,
      color: errorCount > 0 ? "text-destructive" : "text-muted-foreground",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"
      >
        <div>
          <h1 className="text-4xl font-extrabold text-foreground tracking-tight">
            Обзор системы
          </h1>
          <p className="text-muted-foreground mt-2 text-sm flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            {lastRun
              ? `Последний запуск ${formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true, locale: ru })}`
              : "Нет данных"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dryRun && <span className="pill-warning text-[10px]">DRY-RUN</span>}
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={handleTrigger}
            disabled={triggerLoading}
            className="glass rounded-full px-5 py-2.5 flex items-center gap-2 text-sm font-semibold text-foreground hover:glow-primary transition-all disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {triggerLoading ? "Запуск..." : "Запустить"}
          </motion.button>
        </div>
      </motion.div>

      {/* Bento Stats */}
      <motion.div
        variants={stagger.container}
        initial="initial"
        animate="animate"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {stats.map((card) => (
          <motion.div
            key={card.label}
            variants={stagger.item}
            className={`glass rounded-[24px] p-6 group hover:scale-[1.02] transition-transform duration-300 ${
              card.glow ? "glow-success" : ""
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{card.label}</p>
              <card.icon className={`w-5 h-5 ${card.color} ${card.glow ? "breathing" : ""}`} />
            </div>
            <p className="text-4xl font-extralight text-foreground tracking-tighter">{card.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
            {card.sparkline && sparklineData.length >= 2 && <Sparkline data={sparklineData} />}
          </motion.div>
        ))}
      </motion.div>

      {/* Recent runs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <h2 className="text-lg font-semibold text-foreground mb-4">Последние запуски</h2>
        <div className="glass rounded-[24px] overflow-hidden">
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
                    <td className="text-sm font-medium text-foreground">{run.tasks_found}</td>
                    <td className="text-sm font-medium text-foreground">{run.tasks_processed}</td>
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
      </motion.div>
    </div>
  );
};

export default Dashboard;
