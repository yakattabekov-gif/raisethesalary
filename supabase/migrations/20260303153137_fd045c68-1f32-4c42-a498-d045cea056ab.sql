
-- Notes table for personal notes
CREATE TABLE public.notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  color TEXT DEFAULT 'default',
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own notes" ON public.notes FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_notes_updated_at BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Conversations table
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  is_group BOOLEAN NOT NULL DEFAULT false,
  name TEXT,
  avatar_url TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Conversation participants
CREATE TABLE public.conversation_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_read_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(conversation_id, user_id)
);

ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

-- Messages table
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  file_url TEXT,
  file_name TEXT,
  file_size BIGINT,
  file_type TEXT,
  sticker_id TEXT,
  reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  is_edited BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- RLS: users can only access conversations they participate in
CREATE POLICY "Users can view own conversations" ON public.conversations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = id AND user_id = auth.uid()));

CREATE POLICY "Users can create conversations" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own conversations" ON public.conversations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = id AND user_id = auth.uid()));

-- RLS for participants
CREATE POLICY "Users can view participants of own conversations" ON public.conversation_participants FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversation_participants cp WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()));

CREATE POLICY "Users can add participants" ON public.conversation_participants FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.conversation_participants cp WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()) OR user_id = auth.uid());

CREATE POLICY "Users can update own participation" ON public.conversation_participants FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- RLS for messages
CREATE POLICY "Users can view messages in own conversations" ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()));

CREATE POLICY "Users can send messages to own conversations" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()));

CREATE POLICY "Users can update own messages" ON public.messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid());

CREATE POLICY "Users can delete own messages" ON public.messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid());

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;

-- Triggers
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for chat attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('chat-attachments', 'chat-attachments', true, 52428800);

-- Storage RLS
CREATE POLICY "Authenticated users can upload chat files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-attachments');

CREATE POLICY "Anyone can view chat files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat-attachments');

CREATE POLICY "Users can delete own chat files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chat-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
