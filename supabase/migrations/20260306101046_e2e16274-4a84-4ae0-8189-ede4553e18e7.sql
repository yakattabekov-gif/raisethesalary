
-- 1. Make chat-attachments bucket private
UPDATE storage.buckets SET public = false WHERE id = 'chat-attachments';

-- 2. Restrict allowed_directions: drop permissive policy, add admin-only write + authenticated read
DROP POLICY IF EXISTS "Allow all access to allowed_directions" ON public.allowed_directions;
CREATE POLICY "Authenticated can read allowed_directions" ON public.allowed_directions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage allowed_directions" ON public.allowed_directions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Restrict spark_cities: drop permissive policies, add admin-only write + authenticated read
DROP POLICY IF EXISTS "Allow public read access to spark_cities" ON public.spark_cities;
DROP POLICY IF EXISTS "Allow insert to spark_cities" ON public.spark_cities;
DROP POLICY IF EXISTS "Allow delete from spark_cities" ON public.spark_cities;
DROP POLICY IF EXISTS "Allow update to spark_cities" ON public.spark_cities;
CREATE POLICY "Authenticated can read spark_cities" ON public.spark_cities FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage spark_cities" ON public.spark_cities FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. Restrict endpoint_field_config: drop permissive policy, add admin-only write + authenticated read
DROP POLICY IF EXISTS "Allow all access to endpoint_field_config" ON public.endpoint_field_config;
CREATE POLICY "Authenticated can read endpoint_field_config" ON public.endpoint_field_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage endpoint_field_config" ON public.endpoint_field_config FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
