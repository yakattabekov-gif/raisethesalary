import { Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ListTodo, Brain, Globe, Settings, Bot, Sparkles,
  FlaskConical, MapPin, SlidersHorizontal, Building2, User, Users, LogOut,
  StickyNote, MessageCircle,
} from "lucide-react";
import sparkLogo from "@/assets/spark-logo.png";
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { useAuth, useProfile, useUserRole } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

const mainNavItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/requests", icon: ListTodo, label: "Заявки" },
  { to: "/logs/ai", icon: Brain, label: "Логи AI" },
  { to: "/logs/curl", icon: Globe, label: "Логи запросов" },
  { to: "/directions", icon: MapPin, label: "Направления" },
  { to: "/endpoints", icon: SlidersHorizontal, label: "Поля" },
  { to: "/cities", icon: Building2, label: "Города" },
  { to: "/notes", icon: StickyNote, label: "Заметки" },
  { to: "/messenger", icon: MessageCircle, label: "Мессенджер" },
];

const settingsNavItems = [
  { to: "/settings", icon: Settings, label: "Настройки" },
  { to: "/profile", icon: User, label: "Профиль" },
  { to: "/users", icon: Users, label: "Пользователи" },
];

const SidebarInner = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { profile } = useProfile(user?.id);
  const { isAdmin } = useUserRole(user?.id);
  const { data: settings } = useSettings();
  const updateSetting = useUpdateSetting();

  const getSetting = (key: string) => settings?.find((s) => s.key === key)?.value;
  const botEnabled = getSetting("bot_enabled") !== "false";
  const aiEnabled = getSetting("ai_enabled") === "true";
  const dryRun = getSetting("dry_run") === "true";

  const toggleSetting = (key: string, current: boolean) => {
    updateSetting.mutate({ key, value: current ? "false" : "true" });
  };

  const initials = (profile?.full_name || user?.email || "U").substring(0, 2).toUpperCase();


  const filteredSettingsNav = settingsNavItems.filter(
    (item) => item.to !== "/users" || isAdmin
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img src={sparkLogo} alt="Spark" className={collapsed ? "h-6 object-contain" : "h-8 object-contain"} />
        </div>

        {/* Main nav */}
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Навигация</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map(({ to, icon: Icon, label }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={to}
                      end={to === "/"}
                      className="hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <Icon className="w-4 h-4 mr-2 shrink-0" />
                      {!collapsed && <span>{label}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Settings nav */}
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Управление</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredSettingsNav.map(({ to, icon: Icon, label }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={to}
                      className="hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <Icon className="w-4 h-4 mr-2 shrink-0" />
                      {!collapsed && <span>{label}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Toggles */}
        {!collapsed && (
          <div className="px-4 mt-2 space-y-3">
            <Separator />
            <div className="space-y-2">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="flex items-center gap-2 text-xs text-sidebar-foreground">
                  <Bot className="w-3.5 h-3.5" /> Бот
                </span>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${botEnabled ? "bg-success animate-pulse" : "bg-muted-foreground/30"}`} />
                  <Switch checked={botEnabled} onCheckedChange={() => toggleSetting("bot_enabled", botEnabled)} className="scale-75" />
                </div>
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="flex items-center gap-2 text-xs text-sidebar-foreground">
                  <Sparkles className="w-3.5 h-3.5" /> AI
                </span>
                <Switch checked={aiEnabled} onCheckedChange={() => toggleSetting("ai_enabled", aiEnabled)} className="scale-75" />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="flex items-center gap-2 text-xs text-sidebar-foreground">
                  <FlaskConical className="w-3.5 h-3.5" /> Dry-run
                </span>
                <div className="flex items-center gap-2">
                  {dryRun && <span className="text-[10px] font-semibold text-warning">ON</span>}
                  <Switch checked={dryRun} onCheckedChange={() => toggleSetting("dry_run", dryRun)} className="scale-75" />
                </div>
              </label>
            </div>
          </div>
        )}

        {/* User */}
        <div className="mt-auto border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2">
            <Avatar className="w-8 h-8 shrink-0">
              <AvatarImage src={profile?.avatar_url} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs">{initials}</AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{profile?.full_name || user?.email}</p>
                <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
              </div>
            )}
            <button onClick={signOut} className="p-1.5 rounded-lg hover:bg-sidebar-accent text-muted-foreground shrink-0" title="Выйти">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </SidebarContent>
    </Sidebar>
  );
};

const AdminLayout = () => {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <SidebarInner />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center border-b border-border px-4 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
            <SidebarTrigger />
          </header>
          <main className="flex-1 p-3 sm:p-6 max-w-7xl w-full mx-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AdminLayout;
