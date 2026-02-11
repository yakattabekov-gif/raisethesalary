
-- Create table for Spark city ID mappings
CREATE TABLE public.spark_cities (
  id INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL
);

-- Enable RLS (public read, no auth needed for lookup)
ALTER TABLE public.spark_cities ENABLE ROW LEVEL SECURITY;

-- Allow public read access (city lookup from edge functions uses service role anyway)
CREATE POLICY "Allow public read access to spark_cities"
ON public.spark_cities
FOR SELECT
USING (true);
