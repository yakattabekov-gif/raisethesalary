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

  if (isLoading) return <div className="py-16 text-center text-muted-foreground">Загрузка настроек...</div>;

  const Field = ({ keyName, label, type = "text" }: { keyName: string; label: string; type?: "text" | "textarea" | "password" }) => (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        {type === "textarea" ? (
          <Textarea
            value={formValues[keyName] || ""}
            onChange={(e) => handleChange(keyName, e.target.value)}
            className="text-sm bg-background border-border rounded-xl focus:ring-2 focus:ring-primary/20"
            rows={3}
          />
        ) : (
          <Input
            type={type}
            value={formValues[keyName] || ""}
            onChange={(e) => handleChange(keyName, e.target.value)}
            className="text-sm bg-background border-border rounded-xl focus:ring-2 focus:ring-primary/20"
          />
        )}
        <Button size="sm" variant="outline" onClick={() => handleSave(keyName)} className="shrink-0 h-10 rounded-xl">
          <Save className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="bg-card rounded-2xl border border-border shadow-sm p-6 space-y-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Настройки</h1>
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
        <div className="flex items-center gap-2">
          <span className={formValues.spark_bearer_token ? "status-dot-success" : "status-dot-error"} />
          <span className="text-xs text-muted-foreground">
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
          <Label className="text-xs font-medium text-muted-foreground">Cron Schedule</Label>
          <div className="flex gap-2">
            <Input
              value={cronSchedule}
              onChange={(e) => setCronSchedule(e.target.value)}
              className="text-sm bg-background border-border rounded-xl"
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
              className="shrink-0 h-10 rounded-xl"
            >
              <Save className="w-3.5 h-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            */2 * * * * (каждые 2 мин) · */5 * * * * (каждые 5 мин) · 0 * * * * (каждый час)
          </p>
        </div>
        <Button onClick={handleTriggerCron} disabled={triggerLoading} className="gap-2 font-semibold rounded-full">
          <Play className="w-4 h-4" />
          {triggerLoading ? "Запуск..." : "Запустить крон"}
        </Button>
      </Section>
    </div>
  );
};

export default SettingsPage;
