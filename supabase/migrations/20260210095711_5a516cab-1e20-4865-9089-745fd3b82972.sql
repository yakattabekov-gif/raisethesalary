
-- Settings table (key-value store for Jira, Spark, AI configs)
CREATE TABLE public.settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Processed tasks (idempotency)
CREATE TABLE public.processed_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  jira_issue_key TEXT NOT NULL UNIQUE,
  jira_summary TEXT,
  jira_description TEXT,
  action TEXT,
  ai_response JSONB,
  execution_result JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Execution logs
CREATE TABLE public.execution_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.processed_tasks(id),
  action TEXT NOT NULL,
  step TEXT,
  request_data JSONB,
  response_data JSONB,
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cron run history
CREATE TABLE public.cron_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  tasks_found INTEGER DEFAULT 0,
  tasks_processed INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT
);

-- Enable RLS
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

-- Public read/write for all tables (admin-only app, no user auth needed)
CREATE POLICY "Allow all access to settings" ON public.settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to processed_tasks" ON public.processed_tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to execution_logs" ON public.execution_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to cron_runs" ON public.cron_runs FOR ALL USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_processed_tasks_updated_at BEFORE UPDATE ON public.processed_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default settings
INSERT INTO public.settings (key, value, description, category) VALUES
  ('jira_base_url', '', 'Jira base URL (e.g. https://company.atlassian.net)', 'jira'),
  ('jira_email', '', 'Jira account email', 'jira'),
  ('jira_api_token', '', 'Jira API token', 'jira'),
  ('jira_project_key', 'SH', 'Jira project key', 'jira'),
  ('jira_queue_jql', 'project = SH AND status = Open', 'JQL query for polling', 'jira'),
  ('jira_cron_interval', '120', 'Cron interval in seconds', 'jira'),
  ('spark_base_url', 'https://gateway.spark-dev.team/cabinet/api/v2', 'Spark API base URL', 'spark'),
  ('spark_bearer_token', '', 'Spark Bearer token', 'spark'),
  ('ai_enabled', 'true', 'Enable AI parsing', 'ai'),
  ('dry_run', 'true', 'Dry-run mode (no actual API calls)', 'system');

-- Create indexes
CREATE INDEX idx_processed_tasks_jira_key ON public.processed_tasks(jira_issue_key);
CREATE INDEX idx_processed_tasks_status ON public.processed_tasks(status);
CREATE INDEX idx_execution_logs_task_id ON public.execution_logs(task_id);
CREATE INDEX idx_execution_logs_created_at ON public.execution_logs(created_at DESC);
CREATE INDEX idx_cron_runs_started_at ON public.cron_runs(started_at DESC);
