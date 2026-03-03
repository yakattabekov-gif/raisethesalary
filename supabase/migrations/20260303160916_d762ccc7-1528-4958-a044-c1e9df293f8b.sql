
-- Drop the old INSERT policy  
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;

-- Allow any authenticated user to create conversations
CREATE POLICY "Users can create conversations"
ON public.conversations FOR INSERT TO authenticated
WITH CHECK (true);

-- Create trigger to auto-set created_by
CREATE OR REPLACE FUNCTION public.set_conversation_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.created_by = auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_conversation_created_by_trigger ON public.conversations;
CREATE TRIGGER set_conversation_created_by_trigger
  BEFORE INSERT ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_conversation_created_by();
