import { useState, useEffect } from "react";
import { useAuth, useProfile, useUserRole } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Save, User, Phone, Shield, Key, Camera } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ProfileSettings = () => {
  const { user } = useAuth();
  const { profile, loading: profileLoading } = useProfile(user?.id);
  const { role } = useUserRole(user?.id);

  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // Phone verification state
  const [showPhoneVerify, setShowPhoneVerify] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [pendingAction, setPendingAction] = useState<"password" | null>(null);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setNickname(profile.nickname || "");
      setPhone(profile.phone || "");
      setAvatarUrl(profile.avatar_url || "");
    }
  }, [profile]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName, nickname, phone, avatar_url: avatarUrl })
        .eq("id", user.id);
      if (error) throw error;
      toast.success("Профиль обновлён");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const requestPhoneVerification = (action: "password") => {
    if (!phone) {
      toast.error("Сначала сохраните номер телефона в профиле");
      return;
    }
    // Generate 4-digit code
    const code = String(Math.floor(1000 + Math.random() * 9000));
    setGeneratedCode(code);
    setVerifyCode("");
    setPendingAction(action);
    setShowPhoneVerify(true);
    // In production, send SMS. For now, show in toast for testing.
    toast.info(`Код подтверждения: ${code}`, { duration: 15000 });
  };

  const handleVerifyAndExecute = async () => {
    if (verifyCode !== generatedCode) {
      toast.error("Неверный код подтверждения");
      return;
    }
    setShowPhoneVerify(false);
    if (pendingAction === "password") {
      await executePasswordChange();
    }
  };

  const executePasswordChange = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("Пароли не совпадают");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Минимум 6 символов");
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Пароль изменён");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setChangingPassword(false);
    }
  };

  const handleChangePassword = () => {
    if (!newPassword || !confirmPassword) {
      toast.error("Заполните оба поля пароля");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Пароли не совпадают");
      return;
    }
    requestPhoneVerification("password");
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        setAvatarUrl(base64);
        await supabase.from("profiles").update({ avatar_url: base64 }).eq("id", user.id);
        toast.success("Аватарка обновлена");
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (profileLoading) return <div className="py-16 text-center text-muted-foreground">Загрузка...</div>;

  const initials = (fullName || user?.email || "U").substring(0, 2).toUpperCase();

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Профиль</h1>
        <p className="text-sm text-muted-foreground mt-1">Настройки вашего аккаунта</p>
      </div>

      {/* Avatar */}
      <section className="bg-card rounded-2xl border border-border p-6">
        <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Camera className="w-4 h-4" /> Аватарка
        </h2>
        <div className="flex items-center gap-4">
          <Avatar className="w-20 h-20">
            <AvatarImage src={avatarUrl} />
            <AvatarFallback className="text-lg bg-primary/10 text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <label className="cursor-pointer">
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
              <Button variant="outline" size="sm" className="rounded-xl" asChild>
                <span>Загрузить фото</span>
              </Button>
            </label>
            <p className="text-xs text-muted-foreground mt-1">JPG, PNG до 2MB</p>
          </div>
        </div>
      </section>

      {/* Personal info */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <User className="w-4 h-4" /> Личные данные
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Имя</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Никнейм</Label>
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} className="rounded-xl" placeholder="@username" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Email</Label>
          <Input value={user?.email || ""} disabled className="rounded-xl bg-muted" />
        </div>
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Роль:</span>
          <span className="text-xs font-medium text-foreground capitalize">{role || "user"}</span>
        </div>
        <Button onClick={handleSaveProfile} disabled={saving} size="sm" className="gap-2 rounded-xl">
          <Save className="w-3.5 h-3.5" />
          {saving ? "Сохранение..." : "Сохранить"}
        </Button>
      </section>

      {/* Phone */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Phone className="w-4 h-4" /> Телефон
        </h2>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Номер телефона</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded-xl" placeholder="+7 (700) 123-45-67" />
        </div>
        <Button onClick={handleSaveProfile} disabled={saving} size="sm" variant="outline" className="gap-2 rounded-xl">
          <Save className="w-3.5 h-3.5" />
          Сохранить номер
        </Button>
      </section>

      {/* Password */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Key className="w-4 h-4" /> Смена пароля
        </h2>
        <p className="text-xs text-muted-foreground">Для смены пароля потребуется подтверждение по номеру телефона (4-значный код)</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Новый пароль</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Подтвердите пароль</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="rounded-xl" />
          </div>
        </div>
        <Button onClick={handleChangePassword} disabled={changingPassword} size="sm" variant="outline" className="gap-2 rounded-xl">
          <Key className="w-3.5 h-3.5" />
          {changingPassword ? "Изменение..." : "Изменить пароль"}
        </Button>
      </section>

      {/* Phone verification dialog */}
      <Dialog open={showPhoneVerify} onOpenChange={setShowPhoneVerify}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Подтверждение</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              Введите 4-значный код, отправленный на номер <strong>{phone}</strong>
            </p>
            <Input
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="0000"
              className="rounded-xl text-center text-2xl tracking-[0.5em] font-mono"
              maxLength={4}
            />
            <Button onClick={handleVerifyAndExecute} disabled={verifyCode.length !== 4} className="w-full rounded-xl">
              Подтвердить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProfileSettings;
