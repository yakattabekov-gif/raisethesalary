import { useState, useEffect } from "react";
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Save, Play, RefreshCw, Zap, Brain, Globe2, Key } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";

const FEATURE_TOGGLES = [
  { key: "feature_change_sender_direction", label: "Смена направления", desc: "Обработка заявок на изменение направления отправителя" },
  { key: "feature_change_shipment_type", label: "Смена типа отправления", desc: "Обработка заявок на изменение типа" },
  { key: "feature_update_receiver", label: "Обновление получателя", desc: "Обработка заявок на обновление данных получателя" },
];

const stagger = {
  container: { transition: { staggerChildren: 0.1 } },
  item: {
    initial: { opacity: 0, y: 20, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] },
  },
};

const SettingsPage = () => {
  const { data: settings, isLoading } = useSettings();
  const updateSetting = useUpdateSetting();
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [cronSchedule, setCronSchedule] = useState("*/2 * * * *");
  const [cronLoading, setCronLoading] = useState(false);

  useEffect(() => {
    if (settings) {
      const vals: Record<string, string> = {};
      settings.forEach((s) => (vals[s.key] = s.value));
      setFormValues(vals);
      if (vals.jira_cron_schedule) setCronSchedule(vals.jira_cron_schedule);
    }
  }, [settings]);

  const handleChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (key: string) => {
    try {
      await updateSetting.mutateAsync({ key, value: formValues[key] });
      toast.success("Сохранено");
    } catch {
      toast.error("Ошибка сохранения");
    }
  };

  const handleTriggerCron = async () => {
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

  const toggleFeature = (key: string) => {
    const current = formValues[key] === "true";
    const newVal = current ? "false" : "true";
    setFormValues(prev => ({ ...prev, [key]: newVal }));
    updateSetting.mutate({ key, value: newVal });
  };

  if (isLoading) return <div className="py-16 text-center text-muted-foreground">Загрузка...</div>;

  const GlassInput = ({ keyName, label, type = "text" }: { keyName: string; label: string; type?: string }) => (
    <div className="space-y-2">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      <div className="flex gap-2">
        <input
          type={type}
          value={formValues[keyName] || ""}
          onChange={(e) => handleChange(keyName, e.target.value)}
          className="input-glass flex-1 text-foreground"
        />
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={() => handleSave(keyName)}
          className="glass rounded-2xl w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <Save className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  );

  const GlassTextarea = ({ keyName, label }: { keyName: string; label: string }) => (
    <div className="space-y-2">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      <div className="flex gap-2 items-start">
        <textarea
          value={formValues[keyName] || ""}
          onChange={(e) => handleChange(keyName, e.target.value)}
          className="input-glass flex-1 text-foreground min-h-[80px] resize-none"
          rows={3}
        />
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={() => handleSave(keyName)}
          className="glass rounded-2xl w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <Save className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  );

  return (
    <motion.div
      variants={stagger.container}
      initial="initial"
      animate="animate"
      className="space-y-6 max-w-4xl mx-auto"
    >
      <motion.div variants={stagger.item}>
        <h1 className="text-4xl font-extrabold text-foreground tracking-tight">Настройки</h1>
        <p className="text-sm text-muted-foreground mt-2">Управление интеграциями и функциями бота</p>
      </motion.div>

      {/* Feature toggles */}
      <motion.section variants={stagger.item} className="glass rounded-[28px] p-7">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-2xl bg-primary/15 flex items-center justify-center">
            <Zap className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Управление функциями</h2>
            <p className="text-[11px] text-muted-foreground">Включайте и выключайте обработку заявок</p>
          </div>
        </div>
        <div className="space-y-1">
          {FEATURE_TOGGLES.map(({ key, label, desc }) => (
            <div
              key={key}
              className="flex items-center justify-between py-4 px-4 rounded-2xl hover:bg-muted/20 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <Switch
                checked={formValues[key] !== "false"}
                onCheckedChange={() => toggleFeature(key)}
              />
            </div>
          ))}
        </div>
      </motion.section>

      {/* Cron */}
      <motion.section variants={stagger.item} className="glass rounded-[28px] p-7 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-accent/15 flex items-center justify-center">
            <RefreshCw className="w-4.5 h-4.5 text-accent" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Расписание крона</h2>
            <p className="text-[11px] text-muted-foreground">Cron-выражение для автоматического запуска</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            value={cronSchedule}
            onChange={(e) => setCronSchedule(e.target.value)}
            className="input-glass flex-1 font-mono text-foreground"
            placeholder="*/2 * * * *"
          />
          <motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            disabled={cronLoading}
            onClick={async () => {
              setCronLoading(true);
              try {
                const { error } = await supabase.functions.invoke("update-cron-schedule", {
                  body: { schedule: cronSchedule },
                });
                if (error) throw error;
                await updateSetting.mutateAsync({ key: "jira_cron_schedule", value: cronSchedule });
                toast.success(`Расписание: ${cronSchedule}`);
              } catch (e: any) {
                toast.error(e.message || "Ошибка");
              } finally {
                setCronLoading(false);
              }
            }}
            className="glass rounded-2xl w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${cronLoading ? "animate-spin" : ""}`} />
          </motion.button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          <code className="text-[11px] bg-muted/30 px-2 py-0.5 rounded-lg">*/2 * * * *</code> — 2 мин ·{" "}
          <code className="text-[11px] bg-muted/30 px-2 py-0.5 rounded-lg">*/5 * * * *</code> — 5 мин ·{" "}
          <code className="text-[11px] bg-muted/30 px-2 py-0.5 rounded-lg">0 * * * *</code> — час
        </p>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleTriggerCron}
          disabled={triggerLoading}
          className="glass rounded-full px-5 py-2.5 flex items-center gap-2 text-sm font-semibold text-foreground hover:glow-primary transition-all disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" />
          {triggerLoading ? "Запуск..." : "Запустить вручную"}
        </motion.button>
      </motion.section>

      {/* Jira */}
      <motion.section variants={stagger.item} className="glass rounded-[28px] p-7 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-warning/15 flex items-center justify-center">
            <Globe2 className="w-4.5 h-4.5 text-warning" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Jira</h2>
        </div>
        <GlassInput keyName="jira_base_url" label="Base URL" />
        <GlassInput keyName="jira_email" label="Email" />
        <GlassInput keyName="jira_api_token" label="API Token" type="password" />
        <GlassInput keyName="jira_project_key" label="Project Key" />
        <GlassTextarea keyName="jira_queue_jql" label="JQL-запрос" />
      </motion.section>

      {/* Spark */}
      <motion.section variants={stagger.item} className="glass rounded-[28px] p-7 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-success/15 flex items-center justify-center">
            <Zap className="w-4.5 h-4.5 text-success" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Spark API</h2>
        </div>
        <GlassInput keyName="spark_base_url" label="Base URL" />
        <GlassInput keyName="spark_bearer_token" label="Bearer Token" type="password" />
        <GlassInput keyName="yandex_geocoder_api_key" label="Yandex Geocoder API Key" type="password" />
      </motion.section>

      {/* AI */}
      <motion.section variants={stagger.item} className="glass rounded-[28px] p-7 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-primary/15 flex items-center justify-center">
            <Brain className="w-4.5 h-4.5 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">AI (OpenAI)</h2>
        </div>
        <GlassInput keyName="openai_api_key" label="API Key" type="password" />
      </motion.section>
    </motion.div>
  );
};

export default SettingsPage;
