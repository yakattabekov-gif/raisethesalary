import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { UserPlus, Shield } from "lucide-react";

interface UserWithProfile {
  id: string;
  email: string;
  full_name: string | null;
  nickname: string | null;
  role: string;
}

const UserManagement = () => {
  const { user } = useAuth();
  const { isAdmin } = useUserRole(user?.id);
  const [users, setUsers] = useState<UserWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<string>("user");
  const [creating, setCreating] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    const { data: profiles } = await supabase.from("profiles").select("*");
    const { data: roles } = await supabase.from("user_roles").select("*");

    if (profiles) {
      const merged = profiles.map((p: any) => ({
        id: p.id,
        email: "",
        full_name: p.full_name,
        nickname: p.nickname,
        role: roles?.find((r: any) => r.user_id === p.id)?.role || "user",
      }));
      setUsers(merged);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) fetchUsers();
  }, [isAdmin]);

  const handleCreateUser = async () => {
    if (!newEmail || !newPassword) {
      toast.error("Заполните email и пароль");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: { email: newEmail, password: newPassword, full_name: newName, role: newRole },
      });
      if (error) throw error;
      toast.success(`Пользователь ${newEmail} создан`);
      setNewEmail("");
      setNewPassword("");
      setNewName("");
      setNewRole("user");
      setDialogOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Ошибка создания");
    } finally {
      setCreating(false);
    }
  };

  if (!isAdmin) {
    return <div className="py-16 text-center text-muted-foreground">Доступ запрещён</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Пользователи</h1>
          <p className="text-sm text-muted-foreground mt-1">Управление пользователями системы</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 rounded-xl">
              <UserPlus className="w-4 h-4" />
              Создать
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Новый пользователь</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@example.com" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Пароль</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Имя</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Роль</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Пользователь</SelectItem>
                    <SelectItem value="admin">Администратор</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreateUser} disabled={creating} className="w-full rounded-xl gap-2">
                <UserPlus className="w-4 h-4" />
                {creating ? "Создание..." : "Создать пользователя"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="py-8 text-center text-muted-foreground">Загрузка...</div>
      ) : (
        <div className="bg-card rounded-2xl border border-border divide-y divide-border">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Avatar className="w-10 h-10">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm">
                    {(u.full_name || "U").substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium text-foreground">{u.full_name || "Без имени"}</p>
                  <p className="text-xs text-muted-foreground">{u.nickname || u.id.substring(0, 8)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`pill ${u.role === "admin" ? "pill-warning" : "pill-idle"}`}>
                  <Shield className="w-3 h-3" />
                  {u.role === "admin" ? "Админ" : "Пользователь"}
                </span>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="py-8 text-center text-muted-foreground text-sm">Нет пользователей</div>
          )}
        </div>
      )}
    </div>
  );
};

export default UserManagement;
