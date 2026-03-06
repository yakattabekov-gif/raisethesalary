
DROP POLICY "Allow all access to processed_tasks" ON public.processed_tasks;
CREATE POLICY "Admins can manage processed_tasks" ON public.processed_tasks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY "Allow all access to execution_logs" ON public.execution_logs;
CREATE POLICY "Admins can manage execution_logs" ON public.execution_logs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY "Allow all access to cron_runs" ON public.cron_runs;
CREATE POLICY "Admins can manage cron_runs" ON public.cron_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
