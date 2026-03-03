import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Key } from "lucide-react";
import { useNavigate } from "react-router-dom";
import sparkLogo from "@/assets/spark-logo.png";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check for recovery session in URL hash
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setReady(true);
    }
    // Also listen for auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Пароли не совпадают");
      return;
    }
    if (password.length < 6) {
      toast.error("Минимум 6 символов");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Пароль успешно изменён");
      navigate("/");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary/30 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={sparkLogo} alt="Spark" className="h-10 object-contain" />
          <p className="text-sm text-muted-foreground">Установите новый пароль</p>
        </div>

        {!ready ? (
          <div className="bg-card rounded-2xl border border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">Ожидание подтверждения сессии...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-card rounded-2xl border border-border p-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Новый пароль</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Подтвердите пароль</Label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className="rounded-xl" />
            </div>
            <Button type="submit" disabled={loading} className="w-full rounded-xl gap-2">
              <Key className="w-4 h-4" />
              {loading ? "Сохранение..." : "Сохранить пароль"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
