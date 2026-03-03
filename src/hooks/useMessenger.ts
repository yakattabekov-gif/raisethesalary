import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";

export interface Conversation {
  id: string;
  is_group: boolean;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  last_message?: Message | null;
  participants?: ConversationParticipant[];
  unread_count?: number;
}

export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string | null;
  profile?: { full_name: string | null; avatar_url: string | null; nickname: string | null };
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string | null;
  message_type: string;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  file_type: string | null;
  sticker_id: string | null;
  reply_to_id: string | null;
  is_edited: boolean;
  is_deleted: boolean;
  created_at: string;
  sender?: { full_name: string | null; avatar_url: string | null; nickname: string | null };
  reply_to?: Message | null;
}

export const useConversations = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["conversations", user?.id],
    queryFn: async () => {
      // Get conversations the user participates in
      const { data: participations, error: pErr } = await supabase
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", user!.id);
      if (pErr) throw pErr;
      if (!participations?.length) return [];

      const convIds = participations.map((p: any) => p.conversation_id);
      const { data: convs, error: cErr } = await supabase
        .from("conversations")
        .select("*")
        .in("id", convIds)
        .order("updated_at", { ascending: false });
      if (cErr) throw cErr;

      // Get participants with profiles for each conversation
      const { data: allParticipants } = await supabase
        .from("conversation_participants")
        .select("*")
        .in("conversation_id", convIds);

      // Get profiles for all participants
      const userIds = [...new Set((allParticipants || []).map((p: any) => p.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, nickname")
        .in("id", userIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

      // Get last message for each conversation
      const enriched = await Promise.all(
        (convs || []).map(async (conv: any) => {
          const { data: msgs } = await supabase
            .from("messages")
            .select("*")
            .eq("conversation_id", conv.id)
            .order("created_at", { ascending: false })
            .limit(1);

          const participants = (allParticipants || [])
            .filter((p: any) => p.conversation_id === conv.id)
            .map((p: any) => ({ ...p, profile: profileMap.get(p.user_id) }));

          return {
            ...conv,
            last_message: msgs?.[0] || null,
            participants,
          };
        })
      );

      return enriched as Conversation[];
    },
    enabled: !!user,
  });
};

export const useMessages = (conversationId: string | null) => {
  const qc = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => {
        qc.invalidateQueries({ queryKey: ["messages", conversationId] });
        qc.invalidateQueries({ queryKey: ["conversations"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, qc]);

  return useQuery({
    queryKey: ["messages", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Enrich with sender profiles
      const senderIds = [...new Set((data || []).map((m: any) => m.sender_id).filter(Boolean))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, nickname")
        .in("id", senderIds);
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

      // Enrich with reply_to messages
      const replyIds = [...new Set((data || []).map((m: any) => m.reply_to_id).filter(Boolean))];
      let replyMap = new Map();
      if (replyIds.length) {
        const { data: replies } = await supabase.from("messages").select("*").in("id", replyIds);
        replyMap = new Map((replies || []).map((r: any) => [r.id, r]));
      }

      return (data || []).map((m: any) => ({
        ...m,
        sender: profileMap.get(m.sender_id),
        reply_to: replyMap.get(m.reply_to_id) || null,
      })) as Message[];
    },
    enabled: !!conversationId,
  });
};

export const useSendMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (msg: {
      conversation_id: string;
      sender_id: string;
      content?: string;
      message_type?: string;
      file_url?: string;
      file_name?: string;
      file_size?: number;
      file_type?: string;
      sticker_id?: string;
      reply_to_id?: string;
    }) => {
      const { error } = await supabase.from("messages").insert({
        ...msg,
        message_type: msg.message_type || "text",
      });
      if (error) throw error;
      // Update conversation updated_at
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", msg.conversation_id);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["messages", vars.conversation_id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
};

export const useCreateConversation = () => {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (params: { participantIds: string[]; name?: string; isGroup?: boolean }) => {
      // If 1-on-1, check if conversation already exists
      if (!params.isGroup && params.participantIds.length === 1) {
        const { data: existing } = await supabase
          .from("conversation_participants")
          .select("conversation_id")
          .eq("user_id", user!.id);
        
        if (existing?.length) {
          const { data: otherParticipant } = await supabase
            .from("conversation_participants")
            .select("conversation_id")
            .eq("user_id", params.participantIds[0])
            .in("conversation_id", existing.map((e: any) => e.conversation_id));
          
          if (otherParticipant?.length) {
            // Check if any of these are non-group
            const { data: conv } = await supabase
              .from("conversations")
              .select("*")
              .in("id", otherParticipant.map((o: any) => o.conversation_id))
              .eq("is_group", false)
              .limit(1);
            if (conv?.length) return conv[0].id as string;
          }
        }
      }

      const { data: conv, error } = await supabase
        .from("conversations")
        .insert({
          is_group: params.isGroup || false,
          name: params.name || null,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;

      // Add participants
      const participants = [user!.id, ...params.participantIds].map((uid) => ({
        conversation_id: conv.id,
        user_id: uid,
      }));
      const { error: pErr } = await supabase.from("conversation_participants").insert(participants);
      if (pErr) throw pErr;

      return conv.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
};

export const useAllUsers = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["all-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, nickname")
        .neq("id", user!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};
