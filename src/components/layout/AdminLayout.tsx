import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, ListTodo, Brain, Globe, Settings, Zap, Bot, Sparkles, FlaskConical } from "lucide-react";
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/requests", icon: ListTodo, label: "Заявки" },
  { to: "/logs/ai", icon: Brain, label: "AI" },
  { to: "/logs/curl", icon: Globe, label: "API" },
  { to: "/settings", icon: Settings, label: "Настройки" },
];

const AdminLayout = () => {
  const location = useLocation();
  const { data: settings } = useSettings();
  const updateSetting = useUpdateSetting();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const getSetting = (key: string) => settings?.find(s => s.key === key)?.value;
  const botEnabled = getSetting("bot_enabled") !== "false";
  const aiEnabled = getSetting("ai_enabled") === "true";
  const dryRun = getSetting("dry_run") === "true";

  const toggleSetting = (key: string, current: boolean) => {
    updateSetting.mutate({ key, value: current ? "false" : "true" });
  };

  return (
    <div className="spatial-bg min-h-screen relative">
      {/* Floating top bar with controls */}
      <header className="fixed top-0 left-0 right-0 z-40">
        <div className="max-w-7xl mx-auto px-6 pt-5">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
            className="glass-thick rounded-[28px] px-6 py-3 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="text-sm font-bold text-foreground tracking-tight">Spark Bot</span>
              <div className="flex items-center gap-1.5 ml-2">
                <span className={`w-2 h-2 rounded-full ${botEnabled ? "bg-success breathing" : "bg-muted-foreground/30"}`} />
                <span className="text-[11px] text-muted-foreground">
                  {botEnabled ? "Online" : "Off"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-5">
              {dryRun && (
                <span className="pill-warning text-[10px]">DRY-RUN</span>
              )}

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <FlaskConical className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  <span className="text-[11px] text-muted-foreground hidden lg:inline">Dry</span>
                  <Switch checked={dryRun} onCheckedChange={() => toggleSetting("dry_run", dryRun)} className="scale-[0.85]" />
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                  <Sparkles className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  <span className="text-[11px] text-muted-foreground hidden lg:inline">AI</span>
                  <Switch checked={aiEnabled} onCheckedChange={() => toggleSetting("ai_enabled", aiEnabled)} className="scale-[0.85]" />
                </label>

                <div className="w-px h-5 bg-border/50" />

                <label className="flex items-center gap-2 cursor-pointer group">
                  <Bot className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  <Switch checked={botEnabled} onCheckedChange={() => toggleSetting("bot_enabled", botEnabled)} />
                </label>
              </div>
            </div>
          </motion.div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 pt-28 pb-32">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Floating Dock - bottom center */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
          className="glass-dock rounded-full px-3 py-2.5 flex items-center gap-1"
        >
          {navItems.map(({ to, icon: Icon, label }, idx) => {
            const isActive = to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(to);
            const isHovered = hoveredIdx === idx;
            const scale = isHovered ? 1.2 : isActive ? 1.05 : 1;

            return (
              <NavLink
                key={to}
                to={to}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="relative group"
              >
                <motion.div
                  animate={{ scale }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  className={`flex items-center justify-center w-12 h-12 rounded-full transition-all duration-300 ${
                    isActive
                      ? "bg-primary/20 glow-primary"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <Icon className={`w-5 h-5 transition-colors duration-200 ${
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  }`} />
                </motion.div>
                {/* Tooltip */}
                <AnimatePresence>
                  {isHovered && (
                    <motion.span
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      className="absolute -top-9 left-1/2 -translate-x-1/2 text-[11px] font-medium text-foreground glass rounded-lg px-2.5 py-1 whitespace-nowrap"
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </NavLink>
            );
          })}
        </motion.div>
      </nav>
    </div>
  );
};

export default AdminLayout;
