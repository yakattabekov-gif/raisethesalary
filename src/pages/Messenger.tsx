import { useState, useRef, useEffect } from "react";
import {
  Send, Paperclip, Mic, Smile, Plus, Search, ArrowLeft,
  File as FileIcon, Play, Pause, Reply, X, Phone, Video,
  PhoneOff, Trash2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useConversations, useMessages, useSendMessage, useCreateConversation,
  useAllUsers, useDeleteMessage, useVoiceRecorder,
  useStartCall, useActiveCall, useAnswerCall, useEndCall, useIncomingCalls,
  Conversation, Message, Call,
} from "@/hooks/useMessenger";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STICKER_PACKS = [
  { name: "Эмоции", stickers: ["😀", "😂", "🥰", "😎", "🤔", "😢", "😡", "🥳", "😴", "🤯", "🥺", "😈"] },
  { name: "Жесты", stickers: ["👍", "👎", "👋", "🤝", "✌️", "🤞", "👌", "🙏", "💪", "👏", "🫡", "🫶"] },
  { name: "Предметы", stickers: ["❤️", "🔥", "⭐", "🎉", "💯", "🚀", "💎", "🎁", "🏆", "🌟", "⚡", "💫"] },
];

const formatTime = (d: string) => new Date(d).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const formatDate = (d: string) => new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const formatDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Resolve storage path to short-lived signed URL (1 hour), with in-memory cache
const signedUrlCache = new Map<string, { url: string; expires: number }>();
const resolveFileUrl = async (path: string): Promise<string> => {
  // If it's already a full URL (legacy data), return as-is
  if (path.startsWith("http")) return path;
  const cached = signedUrlCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await supabase.storage.from("chat-attachments").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return path;
  signedUrlCache.set(path, { url: data.signedUrl, expires: Date.now() + 3500 * 1000 });
  return data.signedUrl;
};

const useResolvedUrl = (path: string | null) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    resolveFileUrl(path).then(setUrl);
  }, [path]);
  return url;
};

const getConvDisplayName = (conv: Conversation, userId: string) => {
  if (conv.is_group) return conv.name || "Групповой чат";
  const other = conv.participants?.find((p) => p.user_id !== userId);
  return other?.profile?.full_name || other?.profile?.nickname || "Пользователь";
};

const getConvAvatar = (conv: Conversation, userId: string) => {
  if (conv.is_group) return conv.avatar_url;
  const other = conv.participants?.find((p) => p.user_id !== userId);
  return other?.profile?.avatar_url;
};

// --- Conversation List Item ---
const ConvItem = ({ conv, userId, active, onClick }: { conv: Conversation; userId: string; active: boolean; onClick: () => void }) => {
  const displayName = getConvDisplayName(conv, userId);
  const avatar = getConvAvatar(conv, userId);
  const initials = (displayName || "U").substring(0, 2).toUpperCase();
  const lastMsg = conv.last_message;

  let preview = "";
  if (lastMsg) {
    if (lastMsg.is_deleted) preview = "Сообщение удалено";
    else if (lastMsg.message_type === "sticker") preview = "🎨 Стикер";
    else if (lastMsg.message_type === "voice") preview = "🎤 Голосовое";
    else if (lastMsg.message_type === "image") preview = "📷 Фото";
    else if (lastMsg.message_type === "file") preview = `📎 ${lastMsg.file_name || "Файл"}`;
    else preview = lastMsg.content || "";
  }

  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors text-left", active && "bg-accent")}>
      <Avatar className="w-10 h-10 shrink-0">
        <AvatarImage src={avatar || undefined} />
        <AvatarFallback className="bg-primary/10 text-primary text-xs">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {lastMsg && <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{formatTime(lastMsg.created_at)}</span>}
        </div>
        <p className="text-xs text-muted-foreground truncate">{preview}</p>
      </div>
    </button>
  );
};

// --- Message Bubble ---
const MessageBubble = ({ msg, isMine, onReply, onDelete }: { msg: Message; isMine: boolean; onReply: (m: Message) => void; onDelete: (id: string) => void }) => {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const resolvedUrl = useResolvedUrl(msg.file_url);

  if (msg.is_deleted) {
    return (
      <div className={cn("flex mb-1", isMine ? "justify-end" : "justify-start")}>
        <div className="px-3 py-1.5 rounded-xl bg-muted/50 text-xs text-muted-foreground italic max-w-[75%]">Сообщение удалено</div>
      </div>
    );
  }

  const renderContent = () => {
    switch (msg.message_type) {
      case "sticker":
        return <span className="text-5xl">{msg.sticker_id}</span>;
      case "image":
        return (
          <div className="space-y-1">
            {resolvedUrl ? <img src={resolvedUrl} alt={msg.file_name || "image"} className="max-w-[250px] rounded-lg cursor-pointer" onClick={() => window.open(resolvedUrl, "_blank")} /> : <span className="text-xs text-muted-foreground">Загрузка...</span>}
            {msg.content && <p className="text-sm">{msg.content}</p>}
          </div>
        );
      case "voice":
        return (
          <div className="flex items-center gap-2 min-w-[150px]">
            <button onClick={() => { if (audioRef.current) { playing ? audioRef.current.pause() : audioRef.current.play(); setPlaying(!playing); } }} className="p-1.5 rounded-full bg-primary/20">
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <div className="flex-1 h-1 bg-foreground/20 rounded-full"><div className="h-full w-1/2 bg-primary rounded-full" /></div>
            <audio ref={audioRef} src={resolvedUrl || ""} onEnded={() => setPlaying(false)} />
          </div>
        );
      case "file":
        return (
          <a href={resolvedUrl || "#"} target="_blank" rel="noopener" className="flex items-center gap-2 text-sm hover:underline">
            <FileIcon className="w-4 h-4 shrink-0" />
            <span className="truncate">{msg.file_name || "Файл"}</span>
            {msg.file_size && <span className="text-[10px] text-muted-foreground shrink-0">{(msg.file_size / 1024).toFixed(0)} KB</span>}
          </a>
        );
      default:
        return <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>;
    }
  };

  return (
    <div className={cn("flex mb-1 group", isMine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[75%] relative")}>
        {!isMine && msg.sender && (
          <p className="text-[10px] text-muted-foreground mb-0.5 px-1">{msg.sender.full_name || msg.sender.nickname}</p>
        )}
        {msg.reply_to && (
          <div className={cn("text-[10px] px-2 py-1 mb-0.5 rounded-lg border-l-2 border-primary/50", isMine ? "bg-primary/5" : "bg-muted/50")}>
            <p className="font-medium truncate">{msg.reply_to.content?.substring(0, 50) || "Вложение"}</p>
          </div>
        )}
        <div className={cn("px-3 py-1.5 rounded-2xl relative", isMine ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md")}>
          {renderContent()}
          <span className={cn("text-[9px] mt-0.5 block text-right", isMine ? "text-primary-foreground/70" : "text-muted-foreground")}>
            {formatTime(msg.created_at)} {msg.is_edited && "✎"}
          </span>
        </div>
        {/* Actions */}
        <div className={cn("absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-0.5", isMine ? "-left-14" : "-right-14")}>
          <button onClick={() => onReply(msg)} className="p-1 rounded hover:bg-accent" title="Ответить">
            <Reply className="w-3 h-3 text-muted-foreground" />
          </button>
          {isMine && (
            <button onClick={() => onDelete(msg.id)} className="p-1 rounded hover:bg-destructive/10" title="Удалить">
              <Trash2 className="w-3 h-3 text-destructive" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Call UI Overlay ---
const CallOverlay = ({ call, isIncoming, convName, onAnswer, onDecline, onEnd }: {
  call: Call;
  isIncoming: boolean;
  convName: string;
  onAnswer: () => void;
  onDecline: () => void;
  onEnd: () => void;
}) => {
  const [elapsed, setElapsed] = useState(0);
  const isActive = call.status === "active";

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  return (
    <div className="fixed inset-0 z-50 bg-background/95 flex flex-col items-center justify-center gap-6">
      <Avatar className="w-24 h-24">
        <AvatarFallback className="bg-primary/10 text-primary text-2xl">{convName.substring(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="text-center">
        <h2 className="text-xl font-semibold">{convName}</h2>
        <p className="text-muted-foreground text-sm mt-1">
          {call.call_type === "video" ? "Видеозвонок" : "Аудиозвонок"}
          {isActive && ` · ${formatDuration(elapsed)}`}
          {!isActive && isIncoming && " · Входящий звонок..."}
          {!isActive && !isIncoming && " · Вызов..."}
        </p>
      </div>
      <div className="flex gap-4">
        {isIncoming && !isActive && (
          <>
            <Button size="lg" variant="destructive" className="rounded-full w-14 h-14" onClick={onDecline}>
              <PhoneOff className="w-6 h-6" />
            </Button>
            <Button size="lg" className="rounded-full w-14 h-14 bg-green-600 hover:bg-green-700" onClick={onAnswer}>
              <Phone className="w-6 h-6" />
            </Button>
          </>
        )}
        {(isActive || !isIncoming) && (
          <Button size="lg" variant="destructive" className="rounded-full w-14 h-14" onClick={onEnd}>
            <PhoneOff className="w-6 h-6" />
          </Button>
        )}
      </div>
    </div>
  );
};

// --- Main Messenger ---
const Messenger = () => {
  const { user } = useAuth();
  const { data: conversations, isLoading: convsLoading } = useConversations();
  const { data: allUsers } = useAllUsers();
  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();
  const deleteMessage = useDeleteMessage();
  const voiceRecorder = useVoiceRecorder();
  const startCall = useStartCall();
  const answerCall = useAnswerCall();
  const endCall = useEndCall();

  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showStickers, setShowStickers] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [activeCallState, setActiveCallState] = useState<Call | null>(null);

  const { data: messages } = useMessages(activeConv);
  const { data: currentCall } = useActiveCall(activeConv);
  const { data: incomingCalls } = useIncomingCalls();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Track active call
  useEffect(() => {
    if (currentCall) setActiveCallState(currentCall);
    else if (activeCallState?.status === "ended" || activeCallState?.status === "declined") setActiveCallState(null);
  }, [currentCall]);

  // Incoming call notification
  useEffect(() => {
    if (incomingCalls?.length) {
      const call = incomingCalls[0];
      if (!activeCallState) setActiveCallState(call);
    }
  }, [incomingCalls]);

  const activeConversation = conversations?.find((c) => c.id === activeConv);

  const handleSend = async () => {
    if (!text.trim() || !activeConv || !user) return;
    try {
      await sendMessage.mutateAsync({
        conversation_id: activeConv,
        sender_id: user.id,
        content: text.trim(),
        message_type: "text",
        reply_to_id: replyTo?.id,
      });
      setText("");
      setReplyTo(null);
    } catch (err: any) {
      toast.error("Ошибка отправки: " + (err?.message || "Неизвестная ошибка"));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConv || !user) return;
    try {
      const path = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage.from("chat-attachments").upload(path, file);
      if (uploadErr) throw uploadErr;
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      await sendMessage.mutateAsync({
        conversation_id: activeConv,
        sender_id: user.id,
        message_type: isImage ? "image" : isVideo ? "file" : "file",
        file_url: path,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type,
        reply_to_id: replyTo?.id,
      });
      setReplyTo(null);
      toast.success("Файл отправлен");
    } catch (err: any) {
      toast.error("Ошибка загрузки: " + (err?.message || ""));
    }
    e.target.value = "";
  };

  const handleVoice = async () => {
    if (voiceRecorder.isRecording) {
      try {
        const blob = await voiceRecorder.stop();
        if (!activeConv || !user) return;
        const path = `${user.id}/${Date.now()}-voice.webm`;
        const { error } = await supabase.storage.from("chat-attachments").upload(path, blob);
        if (error) throw error;
        await sendMessage.mutateAsync({
          conversation_id: activeConv,
          sender_id: user.id,
          message_type: "voice",
          file_url: path,
          file_name: "voice.webm",
          file_size: blob.size,
          file_type: "audio/webm",
        });
        toast.success("Голосовое отправлено");
      } catch {
        toast.error("Ошибка записи");
      }
    } else {
      try {
        await voiceRecorder.start();
      } catch {
        toast.error("Нет доступа к микрофону");
      }
    }
  };

  const handleSticker = async (sticker: string) => {
    if (!activeConv || !user) return;
    await sendMessage.mutateAsync({
      conversation_id: activeConv,
      sender_id: user.id,
      message_type: "sticker",
      sticker_id: sticker,
    });
    setShowStickers(false);
  };

  const handleDelete = async (messageId: string) => {
    if (!activeConv) return;
    try {
      await deleteMessage.mutateAsync({ messageId, conversationId: activeConv });
    } catch {
      toast.error("Ошибка удаления");
    }
  };

  const handleNewChat = async (userId: string) => {
    try {
      const convId = await createConversation.mutateAsync({ participantIds: [userId] });
      setActiveConv(convId);
      setShowNewChat(false);
      setMobileShowChat(true);
    } catch (err: any) {
      toast.error("Ошибка создания чата: " + (err?.message || ""));
    }
  };

  const handleStartCall = async (type: "audio" | "video") => {
    if (!activeConv || !user) return;
    try {
      const call = await startCall.mutateAsync({ conversationId: activeConv, callerId: user.id, callType: type });
      setActiveCallState(call);
    } catch {
      toast.error("Ошибка вызова");
    }
  };

  const handleAnswerCall = async () => {
    if (!activeCallState) return;
    await answerCall.mutateAsync({ callId: activeCallState.id, action: "answer" });
  };

  const handleDeclineCall = async () => {
    if (!activeCallState) return;
    await answerCall.mutateAsync({ callId: activeCallState.id, action: "decline" });
    setActiveCallState(null);
  };

  const handleEndCall = async () => {
    if (!activeCallState) return;
    await endCall.mutateAsync(activeCallState.id);
    setActiveCallState(null);
  };

  const filteredConvs = conversations?.filter((c) => {
    if (!searchQuery) return true;
    return getConvDisplayName(c, user!.id).toLowerCase().includes(searchQuery.toLowerCase());
  });

  const callConvName = activeCallState
    ? (() => {
        const c = conversations?.find((cv) => cv.id === activeCallState.conversation_id);
        return c ? getConvDisplayName(c, user!.id) : "Звонок";
      })()
    : "";

  return (
    <div className="h-[calc(100vh-7rem)] flex rounded-xl border border-border overflow-hidden bg-background">
      {/* Call overlay */}
      {activeCallState && (activeCallState.status === "ringing" || activeCallState.status === "active") && (
        <CallOverlay
          call={activeCallState}
          isIncoming={activeCallState.caller_id !== user?.id}
          convName={callConvName}
          onAnswer={handleAnswerCall}
          onDecline={handleDeclineCall}
          onEnd={handleEndCall}
        />
      )}

      {/* Conversations sidebar */}
      <div className={cn("w-full md:w-80 border-r border-border flex flex-col shrink-0", mobileShowChat && "hidden md:flex")}>
        <div className="p-3 border-b border-border flex items-center gap-2">
          <h2 className="font-semibold text-sm flex-1">Чаты</h2>
          <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setShowNewChat(true)}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Поиск..." className="pl-8 h-8 text-xs" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {convsLoading ? (
            <div className="flex justify-center py-8"><div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" /></div>
          ) : !filteredConvs?.length ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              <p>Нет чатов</p>
              <Button variant="link" size="sm" className="text-xs mt-1" onClick={() => setShowNewChat(true)}>Начать новый</Button>
            </div>
          ) : (
            filteredConvs.map((c) => (
              <ConvItem key={c.id} conv={c} userId={user!.id} active={activeConv === c.id} onClick={() => { setActiveConv(c.id); setMobileShowChat(true); }} />
            ))
          )}
        </ScrollArea>
      </div>

      {/* Chat area */}
      <div className={cn("flex-1 flex flex-col min-w-0", !mobileShowChat && "hidden md:flex")}>
        {activeConv && activeConversation ? (
          <>
            {/* Chat header */}
            <div className="h-14 border-b border-border flex items-center px-4 gap-3">
              <button className="md:hidden p-1" onClick={() => setMobileShowChat(false)}>
                <ArrowLeft className="w-5 h-5" />
              </button>
              <Avatar className="w-8 h-8">
                <AvatarImage src={getConvAvatar(activeConversation, user!.id) || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-xs">{getConvDisplayName(activeConversation, user!.id).substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{getConvDisplayName(activeConversation, user!.id)}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="w-8 h-8" title="Аудиозвонок" onClick={() => handleStartCall("audio")}>
                  <Phone className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="w-8 h-8" title="Видеозвонок" onClick={() => handleStartCall("video")}>
                  <Video className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-1">
                {messages?.map((msg, i) => {
                  const showDate = i === 0 || formatDate(messages[i - 1].created_at) !== formatDate(msg.created_at);
                  return (
                    <div key={msg.id}>
                      {showDate && (
                        <div className="flex justify-center my-3">
                          <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">{formatDate(msg.created_at)}</span>
                        </div>
                      )}
                      <MessageBubble msg={msg} isMine={msg.sender_id === user?.id} onReply={setReplyTo} onDelete={handleDelete} />
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Reply bar */}
            {replyTo && (
              <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center gap-2">
                <Reply className="w-3.5 h-3.5 text-primary shrink-0" />
                <p className="text-xs text-muted-foreground truncate flex-1">{replyTo.content || "Вложение"}</p>
                <button onClick={() => setReplyTo(null)}><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {/* Input area */}
            <div className="border-t border-border p-3">
              {voiceRecorder.isRecording ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
                    <span className="text-sm text-muted-foreground">{formatDuration(voiceRecorder.duration)}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => voiceRecorder.cancel()}>Отмена</Button>
                  <Button size="sm" onClick={handleVoice}><Send className="w-4 h-4" /></Button>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt" />
                  <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0" onClick={() => fileInputRef.current?.click()}>
                    <Paperclip className="w-4 h-4" />
                  </Button>
                  <div className="relative flex-1">
                    <Input
                      placeholder="Сообщение..."
                      className="pr-10 text-sm"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    />
                    <button onClick={() => setShowStickers(!showStickers)} className="absolute right-2 top-1/2 -translate-y-1/2">
                      <Smile className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                    </button>
                    {showStickers && (
                      <div className="absolute bottom-full right-0 mb-2 w-64 bg-popover border border-border rounded-xl shadow-lg p-3 z-50">
                        {STICKER_PACKS.map((pack) => (
                          <div key={pack.name} className="mb-2">
                            <p className="text-[10px] text-muted-foreground font-medium mb-1">{pack.name}</p>
                            <div className="grid grid-cols-6 gap-1">
                              {pack.stickers.map((s) => (
                                <button key={s} onClick={() => handleSticker(s)} className="text-xl hover:bg-accent rounded p-1 transition-colors">{s}</button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0" onClick={handleVoice}>
                    <Mic className="w-4 h-4" />
                  </Button>
                  <Button size="icon" className="w-8 h-8 shrink-0" onClick={handleSend} disabled={!text.trim()}>
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Выберите чат или начните новый
          </div>
        )}
      </div>

      {/* New chat dialog */}
      <Dialog open={showNewChat} onOpenChange={setShowNewChat}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый чат</DialogTitle>
            <DialogDescription>Выберите пользователя для начала диалога</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {allUsers?.length ? allUsers.map((u: any) => (
              <button key={u.id} onClick={() => handleNewChat(u.id)} className="w-full flex items-center gap-3 p-2 hover:bg-accent rounded-lg transition-colors">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={u.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">{(u.full_name || u.nickname || "U").substring(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="text-sm">{u.full_name || u.nickname || "Пользователь"}</span>
              </button>
            )) : (
              <p className="text-sm text-muted-foreground text-center py-4">Нет доступных пользователей</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Messenger;
