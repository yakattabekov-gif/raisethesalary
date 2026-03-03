import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { UserPlus, Shield, Trash2, Ban, CheckCircle, Pencil, Key } from "lucide-react";

interface UserWithProfile {
  id: string;
  email: string;
  full_name: string | null;
  nickname: string | null;
  role: string;
  is_blocked: boolean;
  phone: string | null;
  avatar_url: string | null;
}

const UserManagement = () => {
  const { user } = useAuth();
  const { isAdmin } = useUserRole(user?.id);
  const [users, setUsers] = useState<UserWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserWithProfile | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [resetPwdUser, setResetPwdUser] = useState<UserWithProfile | null>(null);
  const [resetPwdDialogOpen, setResetPwdDialogOpen] = useState(false);
  const [newPwd, setNewPwd] = useState("");

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<string>("user");
  const [creating, setCreating] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editNickname, setEditNickname] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("user");
  const [editSaving, setEditSaving] = useState(false);

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
        phone: p.phone,
        avatar_url: p.avatar_url,
        role: roles?.find((r: any) => r.user_id === p.id)?.role || "user",
        is_blocked: p.is_blocked || false,
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
      setNewEmail(""); setNewPassword(""); setNewName(""); setNewRole("user");
      setDialogOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Ошибка создания");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Удалить пользователя? Это действие необратимо.")) return;
    try {
      const { error } = await supabase.functions.invoke("admin-manage-user", {
        body: { action: "delete", user_id: userId },
      });
      if (error) throw error;
      toast.success("Пользователь удалён");
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Ошибка удаления");
    }
  };

  const handleToggleBlock = async (userId: string, currentlyBlocked: boolean) => {
    try {
      const { error } = await supabase.functions.invoke("admin-manage-user", {
        body: { action: currentlyBlocked ? "unblock" : "block", user_id: userId },
      });
      if (error) throw error;
      toast.success(currentlyBlocked ? "Пользователь разблокирован" : "Пользователь заблокирован");
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Ошибка");
    }
  };

  const openEditDialog = (u: UserWithProfile) => {
    setEditUser(u);
    setEditName(u.full_name || "");
    setEditNickname(u.nickname || "");
    setEditPhone(u.phone || "");
    setEditEmail(u.email || "");
    setEditRole(u.role);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editUser) return;
    setEditSaving(true);
    try {
      // Update profile
      const { error: profErr } = await supabase.functions.invoke("admin-manage-user", {
        body: {
          action: "update_profile",
          user_id: editUser.id,
          full_name: editName,
          nickname: editNickname,
          phone: editPhone,
        },
      });
      if (profErr) throw profErr;

      // Update email if changed
      if (editEmail && editEmail !== editUser.email) {
        const { error: emailErr } = await supabase.functions.invoke("admin-manage-user", {
          body: { action: "update_email", user_id: editUser.id, email: editEmail },
        });
        if (emailErr) throw emailErr;
      }

      // Update role if changed
      if (editRole !== editUser.role) {
        const { error: roleErr } = await supabase.functions.invoke("admin-manage-user", {
          body: { action: "update_role", user_id: editUser.id, role: editRole },
        });
        if (roleErr) throw roleErr;
      }

      toast.success("Данные обновлены");
      setEditDialogOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Ошибка обновления");
    } finally {
      setEditSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPwdUser || !newPwd) return;
    if (newPwd.length < 6) {
      toast.error("Минимум 6 символов");
      return;
    }
    try {
      const { error } = await supabase.functions.invoke("admin-manage-user", {
        body: { action: "reset_password", user_id: resetPwdUser.id, password: newPwd },
      });
      if (error) throw error;
      toast.success("Пароль сброшен");
      setResetPwdDialogOpen(false);
      setNewPwd("");
    } catch (err: any) {
      toast.error(err.message || "Ошибка сброса пароля");
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editUser) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      try {
        const { error } = await supabase.functions.invoke("admin-manage-user", {
          body: { action: "update_profile", user_id: editUser.id, avatar_url: base64 },
        });
        if (error) throw error;
        toast.success("Аватарка обновлена");
        fetchUsers();
      } catch (err: any) {
        toast.error(err.message || "Ошибка загрузки");
      }
    };
    reader.readAsDataURL(file);
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
              <UserPlus className="w-4 h-4" /> Создать
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Новый пользователь</DialogTitle></DialogHeader>
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
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
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
                  <AvatarImage src={u.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary text-sm">
                    {(u.full_name || "U").substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {u.full_name || "Без имени"}
                    {u.is_blocked && <span className="ml-2 text-xs text-destructive">(заблокирован)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{u.nickname || u.id.substring(0, 8)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`pill ${u.role === "admin" ? "pill-warning" : "pill-idle"}`}>
                  <Shield className="w-3 h-3" />
                  {u.role === "admin" ? "Админ" : "Пользователь"}
                </span>
                {u.id !== user?.id && (
                  <>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(u)} title="Редактировать">
                      <Pencil className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setResetPwdUser(u); setResetPwdDialogOpen(true); setNewPwd(""); }} title="Сбросить пароль">
                      <Key className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleToggleBlock(u.id, u.is_blocked)} title={u.is_blocked ? "Разблокировать" : "Заблокировать"}>
                      {u.is_blocked ? <CheckCircle className="w-4 h-4 text-success" /> : <Ban className="w-4 h-4 text-warning" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeleteUser(u.id)} title="Удалить">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="py-8 text-center text-muted-foreground text-sm">Нет пользователей</div>
          )}
        </div>
      )}

      {/* Edit user dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Редактировать пользователя</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16">
                <AvatarImage src={editUser?.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary">{(editName || "U").substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <label className="cursor-pointer">
                <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                <Button variant="outline" size="sm" className="rounded-xl" asChild><span>Загрузить фото</span></Button>
              </label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">ФИО</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Никнейм</Label>
              <Input value={editNickname} onChange={(e) => setEditNickname(e.target.value)} className="rounded-xl" placeholder="@username" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Телефон</Label>
              <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="rounded-xl" placeholder="+7 (700) 123-45-67" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Роль</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Пользователь</SelectItem>
                  <SelectItem value="admin">Администратор</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSaveEdit} disabled={editSaving} className="w-full rounded-xl gap-2">
              {editSaving ? "Сохранение..." : "Сохранить изменения"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={resetPwdDialogOpen} onOpenChange={setResetPwdDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Сброс пароля: {resetPwdUser?.full_name || resetPwdUser?.id.substring(0, 8)}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Новый пароль</Label>
              <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} className="rounded-xl" placeholder="Минимум 6 символов" />
            </div>
            <Button onClick={handleResetPassword} className="w-full rounded-xl gap-2">
              <Key className="w-4 h-4" /> Сбросить пароль
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
