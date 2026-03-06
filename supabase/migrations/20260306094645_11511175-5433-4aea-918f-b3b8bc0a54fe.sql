
-- Re-enable RLS on messenger tables
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

-- Revoke anon SELECT grants
REVOKE SELECT ON public.conversations FROM anon;
REVOKE SELECT ON public.conversation_participants FROM anon;
REVOKE SELECT ON public.messages FROM anon;
REVOKE SELECT ON public.calls FROM anon;

-- Restrict settings table to authenticated admins only
DROP POLICY IF EXISTS "Allow all access to settings" ON public.settings;
CREATE POLICY "Admins can manage settings"
  ON public.settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
