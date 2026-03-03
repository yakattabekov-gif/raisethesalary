import { useState, useEffect } from "react";
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Save, Play, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const FEATURE_TOGGLES = [
  { key: "feature_change_sender_direction", label: "Смена направления отправителя", desc: "Обработка заявок на изменение направления" },
  { key: "feature_change_shipment_type", label: "Смена типа отправления", desc: "Обработка заявок на изменение типа" },
  { key: "feature_update_receiver", label: "Обновление получателя", desc: "Обработка заявок на обновление данных получателя" },
  { key: "feature_change_act_number", label: "Смена номера АВР (ФТЛ)", desc: "Обработка заявок на изменение номера АВР для ФТЛ заказов" },
];

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

  const renderField = (keyName: string, label: string, type: "text" | "textarea" | "password" = "text") => (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        {type === "textarea" ? (
          <Textarea
            value={formValues[keyName] || ""}
            onChange={(e) => handleChange(keyName, e.target.value)}
            className="text-sm rounded-xl"
            rows={3}
          />
        ) : (
          <Input
            type={type}
            value={formValues[keyName] || ""}
            onChange={(e) => handleChange(keyName, e.target.value)}
            className="text-sm rounded-xl"
          />
        )}
        <Button size="sm" variant="outline" onClick={() => handleSave(keyName)} className="shrink-0 h-10 rounded-xl">
          <Save className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Настройки</h1>
        <p className="text-sm text-muted-foreground mt-1">Конфигурация интеграций и управление функциями</p>
      </div>

      {/* Feature toggles */}
      <section className="bg-card rounded-2xl border border-border p-6">
        <h2 className="text-sm font-semibold text-foreground mb-4">Управление функциями</h2>
        <p className="text-xs text-muted-foreground mb-5">Включайте и выключайте отдельные функции обработки заявок</p>
        <div className="space-y-4">
          {FEATURE_TOGGLES.map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <Switch
                checked={formValues[key] !== "false"}
                onCheckedChange={() => toggleFeature(key)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Cron */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Расписание крона</h2>
        <div className="flex gap-2">
          <Input
            value={cronSchedule}
            onChange={(e) => setCronSchedule(e.target.value)}
            className="text-sm rounded-xl font-mono"
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
                toast.success(`Расписание обновлено: ${cronSchedule}`);
              } catch (e: any) {
                toast.error(e.message || "Ошибка");
              } finally {
                setCronLoading(false);
              }
            }}
            className="shrink-0 h-10 rounded-xl"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${cronLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Примеры: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">*/2 * * * *</code> (2 мин) ·{" "}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">*/5 * * * *</code> (5 мин) ·{" "}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">0 * * * *</code> (час)
        </p>
        <Button onClick={handleTriggerCron} disabled={triggerLoading} size="sm" className="gap-2 font-semibold rounded-full">
          <Play className="w-3.5 h-3.5" />
          {triggerLoading ? "Запуск..." : "Запустить вручную"}
        </Button>
      </section>

      {/* Jira */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Jira</h2>
        {renderField("jira_base_url", "Base URL")}
        {renderField("jira_email", "Email")}
        {renderField("jira_api_token", "API Token", "password")}
        {renderField("jira_project_key", "Project Key")}
        {renderField("jira_queue_jql", "JQL-запрос", "textarea")}
      </section>

      {/* Spark */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Spark API</h2>
        {renderField("spark_base_url", "Base URL")}
        {renderField("spark_bearer_token", "Bearer Token (авто-обновление)", "password")}
        {renderField("spark_login_url", "OAuth URL (по умолч. gateway.spark.kz/oauth/token)")}
        {renderField("spark_login_email", "Логин (username)")}
        {renderField("spark_login_password", "Пароль (или base64)", "password")}
        {renderField("spark_client_id", "Client ID (по умолч. 1)")}
        {renderField("spark_client_secret", "Client Secret", "password")}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl gap-2"
            onClick={async () => {
              try {
                toast.info("Обновление токена...");
                const { error } = await supabase.functions.invoke("refresh-spark-token");
                if (error) throw error;
                toast.success("Токен Spark обновлён");
              } catch (e: any) {
                toast.error(e.message || "Ошибка обновления токена");
              }
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Обновить токен сейчас
          </Button>
          <span className="text-xs text-muted-foreground">
            Последнее: {formValues.spark_token_last_refresh || "—"}
          </span>
        </div>
        {renderField("yandex_geocoder_api_key", "Yandex Geocoder API Key", "password")}
      </section>

      {/* Telegram */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Telegram</h2>
        <p className="text-xs text-muted-foreground">
          Укажите дополнительные Chat ID через запятую. Бот будет отправлять уведомления во все указанные чаты помимо основного.
          Для групповых чатов используйте отрицательный ID (например <code className="text-xs bg-muted px-1.5 py-0.5 rounded">-1001234567890</code>).
        </p>
        {renderField("telegram_chat_ids", "Дополнительные Chat ID (через запятую)")}
      </section>

      {/* AI */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">AI (OpenAI)</h2>
        {renderField("openai_api_key", "API Key", "password")}
      </section>
    </div>
  );
};

export default SettingsPage;
