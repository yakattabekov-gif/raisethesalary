
-- 1. Create profiles_public view (without security_invoker so it bypasses RLS on base table)
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT id, full_name, avatar_url, nickname
FROM public.profiles;

-- Grant access to authenticated users
GRANT SELECT ON public.profiles_public TO authenticated;
GRANT SELECT ON public.profiles_public TO anon;

-- 2. Drop the overly permissive policy that exposes phone numbers
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;

-- 3. Fix user_roles: add explicit restrictive INSERT policy for non-admins
CREATE POLICY "Only admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4. Fix conversations INSERT: restrict WITH CHECK to authenticated user
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
ON public.conversations
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);
