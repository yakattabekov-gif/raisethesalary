import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import sparkLogo from "@/assets/spark-logo.png";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
      toast.success("Ссылка для сброса отправлена на email");
    } catch (err: any) {
      toast.error(err.message || "Ошибка отправки");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary/30 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={sparkLogo} alt="Spark" className="h-10 object-contain" />
          <p className="text-sm text-muted-foreground">Сброс пароля</p>
        </div>

        {sent ? (
          <div className="bg-card rounded-2xl border border-border p-6 text-center space-y-4">
            <Mail className="w-10 h-10 text-primary mx-auto" />
            <p className="text-sm text-foreground">Письмо со ссылкой для сброса пароля отправлено на <strong>{email}</strong></p>
            <Link to="/login" className="text-xs text-primary hover:underline">Вернуться ко входу</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-card rounded-2xl border border-border p-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" required className="rounded-xl" />
            </div>
            <Button type="submit" disabled={loading} className="w-full rounded-xl gap-2">
              <Mail className="w-4 h-4" />
              {loading ? "Отправка..." : "Отправить ссылку"}
            </Button>
            <Link to="/login" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground justify-center">
              <ArrowLeft className="w-3 h-3" /> Назад ко входу
            </Link>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
