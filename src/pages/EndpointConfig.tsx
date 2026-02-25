import { useEndpointFieldConfig, useToggleFieldMutable } from "@/hooks/useEndpointFieldConfig";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const ACTION_LABELS: Record<string, string> = {
  update_payment: "💳 Обновление оплаты",
  update_receiver: "📦 Обновление получателя",
  update_sender: "📤 Обновление отправителя",
  change_direction: "🗺️ Смена направления",
  change_sender_direction: "🗺️ Смена направления отправителя",
  change_shipment_type: "✈️ Смена типа перевозки",
};

const EndpointConfig = () => {
  const { data: configs, isLoading } = useEndpointFieldConfig();
  const toggleMutable = useToggleFieldMutable();

  const groupedByAction = configs?.reduce((acc, cfg) => {
    if (!acc[cfg.action]) acc[cfg.action] = [];
    acc[cfg.action].push(cfg);
    return acc;
  }, {} as Record<string, typeof configs>) || {};

  const handleToggle = (id: string, current: boolean, fieldName: string) => {
    toggleMutable.mutate(
      { id, is_mutable: !current },
      {
        onSuccess: () => toast.success(`${fieldName}: ${!current ? "изменяемое" : "сохраняемое"}`),
        onError: (e: any) => toast.error(e.message),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-extrabold text-foreground tracking-tight">Конфигурация полей</h1></div>
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Конфигурация полей</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Определите какие поля бот может менять (✅) или должен сохранять текущие из Spark (⬜)
        </p>
      </div>

      <div className="grid gap-4">
        {Object.entries(groupedByAction).map(([action, fields]) => (
          <div key={action} className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-muted/50 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">
                {ACTION_LABELS[action] || action}
              </h2>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">action: {action}</p>
            </div>
            <div className="divide-y divide-border">
              {fields!.map((field) => (
                <div key={field.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-semibold text-foreground">{field.field_name}</span>
                      {field.is_mutable ? (
                        <span className="pill-success text-[10px]">изменяемое</span>
                      ) : (
                        <span className="pill-idle text-[10px]">сохраняемое</span>
                      )}
                    </div>
                    {field.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
                    )}
                  </div>
                  <Switch
                    checked={field.is_mutable}
                    onCheckedChange={() => handleToggle(field.id, field.is_mutable, field.field_name)}
                    className="scale-90"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EndpointConfig;
