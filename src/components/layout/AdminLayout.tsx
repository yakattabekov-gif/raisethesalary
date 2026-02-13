import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, ListTodo, Brain, Globe, Settings, Zap, Bot, Sparkles, FlaskConical, MapPin } from "lucide-react";
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/requests", icon: ListTodo, label: "Заявки" },
  { to: "/logs/ai", icon: Brain, label: "Логи AI" },
  { to: "/logs/curl", icon: Globe, label: "Логи запросов" },
  { to: "/directions", icon: MapPin, label: "Направления" },
  { to: "/settings", icon: Settings, label: "Настройки" },
];

const AdminLayout = () => {
  const location = useLocation();
  const { data: settings } = useSettings();
  const updateSetting = useUpdateSetting();

  const getSetting = (key: string) => settings?.find(s => s.key === key)?.value;
  const botEnabled = getSetting("bot_enabled") !== "false";
  const aiEnabled = getSetting("ai_enabled") === "true";
  const dryRun = getSetting("dry_run") === "true";

  const toggleSetting = (key: string, current: boolean) => {
    updateSetting.mutate({ key, value: current ? "false" : "true" });
  };

  return (
    <div className="min-h-screen bg-secondary/30">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="text-base font-bold text-foreground tracking-tight">Spark Bot</span>
            </div>

            <nav className="hidden md:flex items-center gap-1">
              {navItems.map(({ to, icon: Icon, label }) => {
                const isActive = to === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(to);
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-5">
            {dryRun && <span className="pill-warning text-[11px] font-semibold">DRY-RUN</span>}

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <FlaskConical className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground hidden lg:inline">Dry-run</span>
                <Switch checked={dryRun} onCheckedChange={() => toggleSetting("dry_run", dryRun)} className="scale-90" />
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground hidden lg:inline">AI</span>
                <Switch checked={aiEnabled} onCheckedChange={() => toggleSetting("ai_enabled", aiEnabled)} className="scale-90" />
              </label>

              <div className="w-px h-6 bg-border" />

              <label className="flex items-center gap-2 cursor-pointer">
                <Bot className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground hidden lg:inline">Бот</span>
                <Switch checked={botEnabled} onCheckedChange={() => toggleSetting("bot_enabled", botEnabled)} />
              </label>

              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${botEnabled ? "bg-success animate-pulse" : "bg-muted-foreground/30"}`} />
                <span className="text-[11px] text-muted-foreground hidden lg:inline">
                  {botEnabled ? "Активен" : "Выкл"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
};

export default AdminLayout;
