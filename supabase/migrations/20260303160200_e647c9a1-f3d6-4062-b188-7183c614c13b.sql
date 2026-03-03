
-- Security definer function to check conversation membership without recursion
CREATE OR REPLACE FUNCTION public.is_conversation_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = _conversation_id AND user_id = _user_id
  )
$$;

-- Drop old recursive policies on conversation_participants
DROP POLICY IF EXISTS "Users can view participants of own conversations" ON public.conversation_participants;
DROP POLICY IF EXISTS "Users can add participants" ON public.conversation_participants;

-- Recreate without recursion
CREATE POLICY "Users can view participants of own conversations"
ON public.conversation_participants FOR SELECT TO authenticated
USING (public.is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY "Users can add participants"
ON public.conversation_participants FOR INSERT TO authenticated
WITH CHECK (public.is_conversation_member(conversation_id, auth.uid()) OR user_id = auth.uid());

-- Fix conversations policies to use the function too
DROP POLICY IF EXISTS "Users can view own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON public.conversations;

CREATE POLICY "Users can view own conversations"
ON public.conversations FOR SELECT TO authenticated
USING (public.is_conversation_member(id, auth.uid()));

CREATE POLICY "Users can update own conversations"
ON public.conversations FOR UPDATE TO authenticated
USING (public.is_conversation_member(id, auth.uid()));

-- Fix messages policies
DROP POLICY IF EXISTS "Users can view messages in own conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages to own conversations" ON public.messages;

CREATE POLICY "Users can view messages in own conversations"
ON public.messages FOR SELECT TO authenticated
USING (public.is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY "Users can send messages to own conversations"
ON public.messages FOR INSERT TO authenticated
WITH CHECK (sender_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid()));

-- Fix calls policies
DROP POLICY IF EXISTS "Users can view calls in own conversations" ON public.calls;
DROP POLICY IF EXISTS "Users can create calls in own conversations" ON public.calls;
DROP POLICY IF EXISTS "Users can update calls in own conversations" ON public.calls;

CREATE POLICY "Users can view calls in own conversations"
ON public.calls FOR SELECT TO authenticated
USING (public.is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY "Users can create calls in own conversations"
ON public.calls FOR INSERT TO authenticated
WITH CHECK (caller_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY "Users can update calls in own conversations"
ON public.calls FOR UPDATE TO authenticated
USING (public.is_conversation_member(conversation_id, auth.uid()));
