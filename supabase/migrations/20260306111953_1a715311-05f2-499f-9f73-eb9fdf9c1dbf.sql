
-- Drop legacy permissive policies if they exist
DROP POLICY IF EXISTS "Allow all access to settings" ON public.settings;
DROP POLICY IF EXISTS "Allow all access to processed_tasks" ON public.processed_tasks;
DROP POLICY IF EXISTS "Allow all access to execution_logs" ON public.execution_logs;
DROP POLICY IF EXISTS "Allow all access to cron_runs" ON public.cron_runs;

-- Ensure admin-only policies specify TO authenticated
-- Drop and recreate to add TO authenticated clause

DROP POLICY IF EXISTS "Admins can manage settings" ON public.settings;
CREATE POLICY "Admins can manage settings" ON public.settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can manage processed_tasks" ON public.processed_tasks;
CREATE POLICY "Admins can manage processed_tasks" ON public.processed_tasks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can manage execution_logs" ON public.execution_logs;
CREATE POLICY "Admins can manage execution_logs" ON public.execution_logs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can manage cron_runs" ON public.cron_runs;
CREATE POLICY "Admins can manage cron_runs" ON public.cron_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
