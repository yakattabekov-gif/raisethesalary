
CREATE POLICY "Allow insert to spark_cities" ON public.spark_cities FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow delete from spark_cities" ON public.spark_cities FOR DELETE USING (true);
CREATE POLICY "Allow update to spark_cities" ON public.spark_cities FOR UPDATE USING (true) WITH CHECK (true);
