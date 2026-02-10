-- Create helper functions for cron management
CREATE OR REPLACE FUNCTION public.schedule_cron_job(
  job_name text,
  cron_schedule text,
  function_url text,
  anon_key text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Remove existing job first
  PERFORM cron.unschedule(job_name);
EXCEPTION WHEN OTHERS THEN
  -- Job might not exist, ignore
  NULL;
END;
$$;

-- Now create the real version that both removes and creates
CREATE OR REPLACE FUNCTION public.schedule_cron_job(
  job_name text,
  cron_schedule text,
  function_url text,
  anon_key text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Try to remove existing job
  BEGIN
    PERFORM cron.unschedule(job_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  
  -- Schedule new job
  PERFORM cron.schedule(
    job_name,
    cron_schedule,
    format(
      'SELECT net.http_post(url:=%L, headers:=%L::jsonb, body:=%L::jsonb) AS request_id;',
      function_url,
      json_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key)::text,
      '{}'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unschedule_cron_job(job_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM cron.unschedule(job_name);
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;