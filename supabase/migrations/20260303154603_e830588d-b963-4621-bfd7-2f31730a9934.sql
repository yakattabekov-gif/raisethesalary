
-- Create calls table for signaling
CREATE TABLE public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL,
  call_type text NOT NULL DEFAULT 'audio', -- 'audio' or 'video'
  status text NOT NULL DEFAULT 'ringing', -- 'ringing', 'active', 'ended', 'declined', 'missed'
  started_at timestamptz DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view calls in own conversations" ON public.calls
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = calls.conversation_id AND cp.user_id = auth.uid()
  ));

CREATE POLICY "Users can create calls in own conversations" ON public.calls
  FOR INSERT TO authenticated
  WITH CHECK (
    caller_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = calls.conversation_id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update calls in own conversations" ON public.calls
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = calls.conversation_id AND cp.user_id = auth.uid()
  ));

-- Enable realtime for calls
ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
