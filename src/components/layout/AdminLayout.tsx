import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, ListTodo, ScrollText, Settings, Zap, Bot } from "lucide-react";
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/requests", icon: ListTodo, label: "Заявки" },
  { to: "/logs", icon: ScrollText, label: "Логи" },
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
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[260px] bg-sidebar flex flex-col shrink-0 border-r border-sidebar-border">
        {/* Logo */}
        <div className="px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <Zap className="w-[18px] h-[18px] text-primary" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold text-foreground tracking-tight">Spark Bot</h1>
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5">automation · v1.0</p>
            </div>
          </div>
        </div>

        {/* Bot master toggle */}
        <div className="mx-4 mb-3 p-3 rounded-xl bg-accent/60 border border-border/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Bot className="w-4 h-4 text-primary" />
              <span className="text-[13px] font-semibold text-foreground">Бот</span>
            </div>
            <Switch
              checked={botEnabled}
              onCheckedChange={() => toggleSetting("bot_enabled", botEnabled)}
            />
          </div>
          {botEnabled && (
            <div className="mt-3 space-y-2.5 pt-3 border-t border-border/40">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-muted-foreground">AI парсинг</span>
                <Switch
                  checked={aiEnabled}
                  onCheckedChange={() => toggleSetting("ai_enabled", aiEnabled)}
                  className="scale-[0.85]"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-muted-foreground">Dry-run</span>
                <Switch
                  checked={dryRun}
                  onCheckedChange={() => toggleSetting("dry_run", dryRun)}
                  className="scale-[0.85]"
                />
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-0.5">
          {navItems.map(({ to, icon: Icon, label }) => {
            const isActive = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
            return (
              <NavLink
                key={to}
                to={to}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
                {label}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-sidebar-border">
          <div className="flex items-center gap-2">
            <span className={botEnabled ? "status-dot-success" : "status-dot-idle"} />
            <span className="text-[11px] font-mono text-muted-foreground">
              {botEnabled ? "Бот активен" : "Бот выключен"}
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
};

export default AdminLayout;
