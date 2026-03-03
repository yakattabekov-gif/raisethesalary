
-- Drop and recreate conversations INSERT policy as PERMISSIVE
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
ON public.conversations FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());

-- Also fix SELECT and UPDATE to be permissive
DROP POLICY IF EXISTS "Users can view own conversations" ON public.conversations;
CREATE POLICY "Users can view own conversations"
ON public.conversations FOR SELECT TO authenticated
USING (public.is_conversation_member(id, auth.uid()));

DROP POLICY IF EXISTS "Users can update own conversations" ON public.conversations;
CREATE POLICY "Users can update own conversations"
ON public.conversations FOR UPDATE TO authenticated
USING (public.is_conversation_member(id, auth.uid()));

-- Fix conversation_participants policies to be permissive
DROP POLICY IF EXISTS "Users can view participants of own conversations" ON public.conversation_participants;
CREATE POLICY "Users can view participants of own conversations"
ON public.conversation_participants FOR SELECT TO authenticated
USING (public.is_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Users can add participants" ON public.conversation_participants;
CREATE POLICY "Users can add participants"
ON public.conversation_participants FOR INSERT TO authenticated
WITH CHECK (public.is_conversation_member(conversation_id, auth.uid()) OR user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own participation" ON public.conversation_participants;
CREATE POLICY "Users can update own participation"
ON public.conversation_participants FOR UPDATE TO authenticated
USING (user_id = auth.uid());

-- Fix messages policies to be permissive
DROP POLICY IF EXISTS "Users can view messages in own conversations" ON public.messages;
CREATE POLICY "Users can view messages in own conversations"
ON public.messages FOR SELECT TO authenticated
USING (public.is_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Users can send messages to own conversations" ON public.messages;
CREATE POLICY "Users can send messages to own conversations"
ON public.messages FOR INSERT TO authenticated
WITH CHECK (sender_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Users can update own messages" ON public.messages;
CREATE POLICY "Users can update own messages"
ON public.messages FOR UPDATE TO authenticated
USING (sender_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own messages" ON public.messages;
CREATE POLICY "Users can delete own messages"
ON public.messages FOR DELETE TO authenticated
USING (sender_id = auth.uid());

-- Fix calls policies to be permissive
DROP POLICY IF EXISTS "Users can view calls in own conversations" ON public.calls;
CREATE POLICY "Users can view calls in own conversations"
ON public.calls FOR SELECT TO authenticated
USING (public.is_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Users can create calls in own conversations" ON public.calls;
CREATE POLICY "Users can create calls in own conversations"
ON public.calls FOR INSERT TO authenticated
WITH CHECK (caller_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Users can update calls in own conversations" ON public.calls;
CREATE POLICY "Users can update calls in own conversations"
ON public.calls FOR UPDATE TO authenticated
USING (public.is_conversation_member(conversation_id, auth.uid()));
