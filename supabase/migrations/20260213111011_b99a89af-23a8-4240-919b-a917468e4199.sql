
CREATE TABLE public.allowed_directions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_city text NOT NULL,
  child_city text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(parent_city, child_city)
);

ALTER TABLE public.allowed_directions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to allowed_directions"
ON public.allowed_directions
FOR ALL
USING (true)
WITH CHECK (true);
