
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Create a cron job that calls the edge function every 2 minutes
SELECT cron.schedule(
  'process-jira-tasks-cron',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/process-jira-tasks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
