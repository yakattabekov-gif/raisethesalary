import { useState, useEffect } from "react";
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Save, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
      toast.success(`${key} сохранён`);
    } catch {
      toast.error(`Ошибка сохранения ${key}`);
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

  if (isLoading) return <div className="p-10 text-muted-foreground">Загрузка настроек...</div>;

  const Field = ({ keyName, label, type = "text" }: { keyName: string; label: string; type?: "text" | "textarea" | "password" }) => (
    <div className="space-y-2">
      <Label className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">{label}</Label>
      <div className="flex gap-2">
        {type === "textarea" ? (
          <Textarea
            value={formValues[keyName] || ""}
            onChange={(e) => handleChange(keyName, e.target.value)}
            className="font-mono text-sm bg-input border-border/60 focus:border-primary/40"
            rows={3}
          />
        ) : (
          <Input
            type={type}
            value={formValues[keyName] || ""}
            onChange={(e) => handleChange(keyName, e.target.value)}
            className="font-mono text-sm bg-input border-border/60 focus:border-primary/40"
          />
        )}
        <Button size="sm" variant="outline" onClick={() => handleSave(keyName)} className="shrink-0 h-10">
          <Save className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="space-y-5">
      <h2 className="text-[13px] font-bold text-foreground uppercase tracking-wider border-b border-border/40 pb-3">{title}</h2>
      {children}
    </section>
  );

  return (
    <div className="p-6 lg:p-10 space-y-10 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Настройки</h1>
        <p className="text-sm text-muted-foreground mt-1">Конфигурация Jira, Spark и системы</p>
      </div>

      <Section title="Jira">
        <Field keyName="jira_base_url" label="Base URL" />
        <Field keyName="jira_email" label="Email" />
        <Field keyName="jira_api_token" label="API Token" type="password" />
        <Field keyName="jira_project_key" label="Project Key" />
        <Field keyName="jira_queue_jql" label="Queue JQL" type="textarea" />
        <Field keyName="jira_cron_interval" label="Cron Interval (seconds)" />
      </Section>

      <Section title="Spark">
        <Field keyName="spark_base_url" label="Base API URL" />
        <Field keyName="spark_bearer_token" label="Bearer Token" type="password" />
        <div className="flex items-center gap-2 mt-1">
          <span className={`status-dot-${formValues.spark_bearer_token ? "success" : "error"}`} />
          <span className="text-[11px] font-mono text-muted-foreground">
            Token: {formValues.spark_bearer_token ? "Настроен" : "Отсутствует"}
          </span>
        </div>
        <Field keyName="yandex_geocoder_api_key" label="Yandex Geocoder API Key" type="password" />
      </Section>

      <Section title="AI (OpenAI)">
        <Field keyName="openai_api_key" label="OpenAI API Key" type="password" />
      </Section>

      <Section title="Крон и ручной запуск">
        <div className="space-y-2">
          <Label className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Cron Schedule</Label>
          <div className="flex gap-2">
            <Input
              value={cronSchedule}
              onChange={(e) => setCronSchedule(e.target.value)}
              className="font-mono text-sm bg-input border-border/60"
              placeholder="*/2 * * * *"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={cronLoading}
              onClick={async () => {
                setCronLoading(true);
                try {
                  const { error } = await supabase.functions.invoke("update-cron-schedule", {
                    body: { schedule: cronSchedule },
                  });
                  if (error) throw error;
                  await updateSetting.mutateAsync({ key: "jira_cron_schedule", value: cronSchedule });
                  toast.success(`Крон обновлён: ${cronSchedule}`);
                } catch (e: any) {
                  toast.error(e.message || "Ошибка обновления крона");
                } finally {
                  setCronLoading(false);
                }
              }}
              className="shrink-0 h-10"
            >
              <Save className="w-3.5 h-3.5" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground font-mono">
            */2 * * * * (каждые 2 мин) · */5 * * * * (каждые 5 мин) · 0 * * * * (каждый час)
          </p>
        </div>
        <Button onClick={handleTriggerCron} disabled={triggerLoading} className="gap-2 font-semibold">
          <Play className="w-4 h-4" />
          {triggerLoading ? "Запуск..." : "Запустить крон"}
        </Button>
      </Section>
    </div>
  );
};

export default SettingsPage;
