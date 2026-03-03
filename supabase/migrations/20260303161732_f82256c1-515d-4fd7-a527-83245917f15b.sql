
-- Disable RLS on messenger tables - this is an internal admin tool
-- Authentication is handled at the application level
ALTER TABLE public.conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls DISABLE ROW LEVEL SECURITY;
