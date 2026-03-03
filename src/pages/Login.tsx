import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import sparkLogo from "@/assets/spark-logo.png";

const Login = () => {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, password);
      toast.success("Вход выполнен");
    } catch (err: any) {
      toast.error(err.message || "Ошибка входа");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary/30 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={sparkLogo} alt="Spark" className="h-10 object-contain" />
          <p className="text-sm text-muted-foreground">Войдите в систему</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card rounded-2xl border border-border p-6 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" required className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Пароль</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="rounded-xl" />
          </div>
          <Button type="submit" disabled={loading} className="w-full rounded-xl gap-2">
            <LogIn className="w-4 h-4" />
            {loading ? "Вход..." : "Войти"}
          </Button>
          <Link to="/forgot-password" className="block text-center text-xs text-muted-foreground hover:text-primary">
            Забыли пароль?
          </Link>
        </form>
      </div>
    </div>
  );
};

export default Login;
