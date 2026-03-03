
-- Grant access to conversations
GRANT ALL ON public.conversations TO authenticated;
GRANT SELECT ON public.conversations TO anon;

-- Grant access to conversation_participants  
GRANT ALL ON public.conversation_participants TO authenticated;
GRANT SELECT ON public.conversation_participants TO anon;

-- Grant access to messages
GRANT ALL ON public.messages TO authenticated;
GRANT SELECT ON public.messages TO anon;

-- Grant access to calls
GRANT ALL ON public.calls TO authenticated;
GRANT SELECT ON public.calls TO anon;
