import { useState, useEffect } from "react";
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Save, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const SettingsPage = () => {
  const { data: settings, isLoading } = useSettings();
  const updateSetting = useUpdateSetting();
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [triggerLoading, setTriggerLoading] = useState(false);

  useEffect(() => {
    if (settings) {
      const vals: Record<string, string> = {};
      settings.forEach((s) => (vals[s.key] = s.value));
      setFormValues(vals);
    }
  }, [settings]);

  const handleChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (key: string) => {
    try {
      await updateSetting.mutateAsync({ key, value: formValues[key] });
      toast.success(`${key} saved`);
    } catch {
      toast.error(`Failed to save ${key}`);
    }
  };

  const handleTriggerCron = async () => {
    setTriggerLoading(true);
    try {
      const { error } = await supabase.functions.invoke("process-jira-tasks");
      if (error) throw error;
      toast.success("Cron triggered manually");
    } catch (e: any) {
      toast.error(e.message || "Failed to trigger cron");
    } finally {
      setTriggerLoading(false);
    }
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading settings...</div>;

  const renderField = (key: string, label: string, type: "text" | "textarea" | "password" = "text") => (
    <div className="space-y-2" key={key}>
      <Label className="text-xs text-muted-foreground uppercase tracking-wider">{label}</Label>
      <div className="flex gap-2">
        {type === "textarea" ? (
          <Textarea
            value={formValues[key] || ""}
            onChange={(e) => handleChange(key, e.target.value)}
            className="font-mono text-sm bg-secondary border-border"
            rows={3}
          />
        ) : (
          <Input
            type={type}
            value={formValues[key] || ""}
            onChange={(e) => handleChange(key, e.target.value)}
            className="font-mono text-sm bg-secondary border-border"
          />
        )}
        <Button size="sm" variant="outline" onClick={() => handleSave(key)} className="shrink-0">
          <Save className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="p-8 space-y-8 max-w-3xl">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Конфигурация Jira, Spark и системы</p>
      </div>

      {/* Jira */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Jira Configuration</h2>
        {renderField("jira_base_url", "Base URL")}
        {renderField("jira_email", "Email")}
        {renderField("jira_api_token", "API Token", "password")}
        {renderField("jira_project_key", "Project Key")}
        {renderField("jira_queue_jql", "Queue JQL", "textarea")}
        {renderField("jira_cron_interval", "Cron Interval (seconds)")}
      </section>

      {/* Spark */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Spark Configuration</h2>
        {renderField("spark_base_url", "Base API URL")}
        {renderField("spark_bearer_token", "Bearer Token", "password")}
        <div className="flex items-center gap-2">
          <span className={`status-dot-${formValues.spark_bearer_token ? "success" : "error"}`} />
          <span className="text-xs font-mono text-muted-foreground">
            Token: {formValues.spark_bearer_token ? "Configured" : "Missing"}
          </span>
        </div>
        {renderField("yandex_geocoder_api_key", "Yandex Geocoder API Key", "password")}
      </section>

      {/* AI */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">AI Configuration (OpenAI)</h2>
        {renderField("openai_api_key", "OpenAI API Key", "password")}
      </section>

      {/* System */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">System</h2>
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm text-foreground">AI Parsing</p>
            <p className="text-xs text-muted-foreground">Использовать AI для парсинга заявок</p>
          </div>
          <Switch
            checked={formValues.ai_enabled === "true"}
            onCheckedChange={(checked) => {
              handleChange("ai_enabled", checked ? "true" : "false");
              updateSetting.mutate({ key: "ai_enabled", value: checked ? "true" : "false" });
            }}
          />
        </div>
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm text-foreground">Dry-Run Mode</p>
            <p className="text-xs text-muted-foreground">Не выполнять реальные действия в Spark</p>
          </div>
          <Switch
            checked={formValues.dry_run === "true"}
            onCheckedChange={(checked) => {
              handleChange("dry_run", checked ? "true" : "false");
              updateSetting.mutate({ key: "dry_run", value: checked ? "true" : "false" });
            }}
          />
        </div>
      </section>

      {/* Manual trigger */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Manual Actions</h2>
        <Button onClick={handleTriggerCron} disabled={triggerLoading} className="gap-2">
          <Play className="w-4 h-4" />
          {triggerLoading ? "Running..." : "Trigger Cron Now"}
        </Button>
      </section>
    </div>
  );
};

export default SettingsPage;
