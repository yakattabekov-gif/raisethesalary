-- Fix 1: chat-attachments uploads must go into the user's own folder
DROP POLICY IF EXISTS "Authenticated users can upload to chat-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload to chat-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload chat attachments" ON storage.objects;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass
      AND polcmd = 'a'
      AND pg_get_expr(polqual, polrelid) IS NULL
      AND pg_get_expr(polwithcheck, polrelid) ILIKE '%chat-attachments%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.polname);
  END LOOP;
END $$;

CREATE POLICY "Users can upload own chat attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can read own chat attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update own chat attachments"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete own chat attachments"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Fix 2: switch profiles_public view to security_invoker so RLS of querying user applies
ALTER VIEW public.profiles_public SET (security_invoker = true);