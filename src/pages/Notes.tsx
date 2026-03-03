import { useState } from "react";
import { Plus, Pin, Trash2, Edit3, X, Check } from "lucide-react";
import { useNotes, useCreateNote, useUpdateNote, useDeleteNote, Note } from "@/hooks/useNotes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

const NOTE_COLORS = [
  { id: "default", bg: "bg-card", border: "border-border" },
  { id: "yellow", bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-800" },
  { id: "green", bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-800" },
  { id: "blue", bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800" },
  { id: "pink", bg: "bg-pink-50 dark:bg-pink-950/30", border: "border-pink-200 dark:border-pink-800" },
  { id: "purple", bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800" },
];

const NoteCard = ({ note, onEdit, onDelete, onTogglePin }: { note: Note; onEdit: (n: Note) => void; onDelete: (id: string) => void; onTogglePin: (n: Note) => void }) => {
  const color = NOTE_COLORS.find((c) => c.id === note.color) || NOTE_COLORS[0];
  return (
    <Card className={`${color.bg} ${color.border} group hover:shadow-md transition-shadow`}>
      <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
        <h3 className="font-semibold text-sm truncate flex-1">{note.title || "Без названия"}</h3>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onTogglePin(note)} className="p-1 hover:bg-background/50 rounded" title={note.pinned ? "Открепить" : "Закрепить"}>
            <Pin className={`w-3.5 h-3.5 ${note.pinned ? "fill-current text-primary" : "text-muted-foreground"}`} />
          </button>
          <button onClick={() => onEdit(note)} className="p-1 hover:bg-background/50 rounded"><Edit3 className="w-3.5 h-3.5 text-muted-foreground" /></button>
          <button onClick={() => onDelete(note.id)} className="p-1 hover:bg-background/50 rounded"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">{note.content}</p>
        <p className="text-[10px] text-muted-foreground/60 mt-2">{new Date(note.updated_at).toLocaleDateString("ru-RU")}</p>
      </CardContent>
    </Card>
  );
};

const Notes = () => {
  const { data: notes, isLoading } = useNotes();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [color, setColor] = useState("default");

  const openCreate = () => { setEditing(null); setTitle(""); setContent(""); setColor("default"); setDialogOpen(true); };
  const openEdit = (n: Note) => { setEditing(n); setTitle(n.title); setContent(n.content); setColor(n.color || "default"); setDialogOpen(true); };

  const handleSave = async () => {
    try {
      if (editing) {
        await updateNote.mutateAsync({ id: editing.id, title, content, color });
        toast.success("Заметка обновлена");
      } else {
        await createNote.mutateAsync({ title, content, color });
        toast.success("Заметка создана");
      }
      setDialogOpen(false);
    } catch { toast.error("Ошибка"); }
  };

  const handleDelete = async (id: string) => {
    try { await deleteNote.mutateAsync(id); toast.success("Удалено"); } catch { toast.error("Ошибка"); }
  };

  const handleTogglePin = async (note: Note) => {
    await updateNote.mutateAsync({ id: note.id, pinned: !note.pinned });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Заметки</h1>
        <Button onClick={openCreate} size="sm"><Plus className="w-4 h-4 mr-1" /> Новая</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" /></div>
      ) : !notes?.length ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Нет заметок</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={openCreate}>Создать первую</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {notes.map((n) => <NoteCard key={n.id} note={n} onEdit={openEdit} onDelete={handleDelete} onTogglePin={handleTogglePin} />)}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Редактировать" : "Новая заметка"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea placeholder="Содержание..." value={content} onChange={(e) => setContent(e.target.value)} rows={6} />
            <div className="flex gap-2">
              {NOTE_COLORS.map((c) => (
                <button key={c.id} onClick={() => setColor(c.id)} className={`w-6 h-6 rounded-full border-2 ${c.bg} ${color === c.id ? "ring-2 ring-primary ring-offset-2" : c.border}`} />
              ))}
            </div>
            <Button onClick={handleSave} className="w-full" disabled={createNote.isPending || updateNote.isPending}>
              {editing ? "Сохранить" : "Создать"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Notes;
