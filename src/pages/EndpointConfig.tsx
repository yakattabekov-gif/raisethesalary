import { useState } from "react";
import { useEndpointFieldConfig, useToggleFieldMutable, useAddFieldConfig, useDeleteFieldConfig } from "@/hooks/useEndpointFieldConfig";
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Save, ChevronDown, ChevronRight, Copy } from "lucide-react";

// ─── All actions with their Spark API endpoints and fields ───
const ENDPOINT_REFERENCE: Record<string, {
  label: string;
  endpoints: { method: string; path: string; description: string }[];
  requestFields: string[];
  responseFields: string[];
}> = {
  cancel: {
    label: "❌ Отмена заказа",
    endpoints: [
      { method: "GET", path: "/admin/logistics-info?search={invoice}", description: "Поиск накладной" },
      { method: "POST", path: "/logistics-info/{id}/cancel", description: "Отмена заказа" },
    ],
    requestFields: [],
    responseFields: ["id", "status"],
  },
  restore_order: {
    label: "🔄 Восстановление заказа",
    endpoints: [
      { method: "GET", path: "/admin/logistics-info?search={invoice}", description: "Поиск накладной" },
      { method: "POST", path: "/logistics-info/{id}/restore", description: "Восстановление заказа" },
    ],
    requestFields: ["takeDate", "periodId"],
    responseFields: ["id", "status"],
  },
  update_receiver: {
    label: "📦 Обновление получателя",
    endpoints: [
      { method: "GET", path: "/admin/logistics-info?search={invoice}", description: "Поиск накладной" },
      { method: "GET", path: "/logistics-info/{id}", description: "Полная информация" },
      { method: "PUT", path: "/receivers/{receiver.id}", description: "Обновление получателя" },
      { method: "GET", path: "geocode-maps.yandex.ru/1.x", description: "Геокодирование адреса" },
    ],
    requestFields: [
      "title", "entity", "full_name", "phone", "additional_phone",
      "city_id", "latitude", "longitude", "street", "house",
      "full_address", "flat", "comment", "office", "index",
      "company_id", "id", "sender_id", "warehouse_id",
    ],
    responseFields: ["receiver_id", "city", "title", "full_name", "phone", "city_id", "latitude", "longitude"],
  },
  update_sender: {
    label: "📤 Обновление отправителя",
    endpoints: [
      { method: "GET", path: "/admin/logistics-info?search={invoice}", description: "Поиск накладной" },
      { method: "GET", path: "/logistics-info/{id}", description: "Полная информация" },
      { method: "GET", path: "gateway.spark.kz/cabinet/api/invoice-status/{invoice}", description: "Проверка статуса (225)" },
      { method: "PUT", path: "/senders/{sender.id}", description: "Обновление отправителя" },
      { method: "GET", path: "geocode-maps.yandex.ru/1.x", description: "Геокодирование адреса" },
    ],
    requestFields: [
      "title", "entity", "full_name", "phone", "additional_phone",
      "city_id", "latitude", "longitude", "street", "house",
      "full_address", "comment", "office", "index",
      "company_id", "id", "warehouse_id",
    ],
    responseFields: ["sender_id", "city", "title", "full_name", "phone"],
  },
  update_payment: {
    label: "💳 Обновление оплаты",
    endpoints: [
      { method: "GET", path: "/admin/logistics-info?search={invoice}", description: "Поиск накладной" },
      { method: "GET", path: "/logistics-info/{id}", description: "Полная информация" },
      { method: "PUT", path: "/logistics-info/{id}", description: "Обновление данных" },
    ],
    requestFields: [
      "additional_service", "product_name", "dop_invoice_number", "annotation",
      "cod_payment", "declared_price", "take_date", "period_id",
      "places", "weight", "width", "height", "depth", "volume",
      "cargo_name", "should_return_document", "shipment_type",
      "payment_type", "payment_method", "cash_sum",
      "verify", "is_dangerous", "temperature_regime_type_id",
      "invoice_files", "certificate_of_safety_files", "temperature_regime_safety_files",
    ],
    responseFields: ["payment_type", "payment_method", "cash_sum", "cod_payment", "shipment_type"],
  },
  change_direction: {
    label: "🗺️ Смена направления",
    endpoints: [
      { method: "GET", path: "gateway.spark.kz/cabinet/api/invoice-status/{invoice}", description: "Проверка статуса (206)" },
      { method: "GET", path: "/admin/logistics-info?search={invoice}", description: "Поиск накладной" },
      { method: "GET", path: "/logistics-info/{id}", description: "Полная информация" },
      { method: "PUT", path: "/receivers/{receiver.id}", description: "Смена города получателя" },
      { method: "PUT", path: "/senders/{sender.id}", description: "Смена города отправителя (если пара)" },
      { method: "GET", path: "geocode-maps.yandex.ru/1.x", description: "Геокодирование" },
    ],
    requestFields: [
      "title", "entity", "full_name", "phone", "additional_phone",
      "city_id", "latitude", "longitude", "street", "house",
      "full_address", "flat", "comment", "office", "index",
      "company_id", "id", "sender_id", "warehouse_id",
    ],
    responseFields: ["receiver_id", "sender_id", "city", "city_id"],
  },
  change_sender_direction: {
    label: "🗺️ Смена направления отправителя",
    endpoints: [
      { method: "GET", path: "gateway.spark.kz/cabinet/api/invoice-status/{invoice}", description: "Проверка статуса (225)" },
      { method: "GET", path: "/admin/logistics-info?search={invoice}", description: "Поиск накладной" },
      { method: "GET", path: "/logistics-info/{id}", description: "Полная информация" },
      { method: "PUT", path: "/senders/{sender.id}", description: "Смена города отправителя" },
      { method: "GET", path: "geocode-maps.yandex.ru/1.x", description: "Геокодирование" },
    ],
    requestFields: [
      "title", "entity", "full_name", "phone", "additional_phone",
      "city_id", "latitude", "longitude", "street", "house",
      "full_address", "comment", "office", "index",
      "company_id", "id", "warehouse_id",
    ],
    responseFields: ["sender_id", "city", "city_id"],
  },
  change_shipment_type: {
    label: "✈️ Смена типа перевозки",
    endpoints: [
      { method: "GET", path: "gateway.spark.kz/cabinet/api/invoice-status/{invoice}", description: "Проверка статуса (206 waiting)" },
      { method: "GET", path: "/admin/logistics-info?search={invoice}", description: "Поиск накладной" },
      { method: "GET", path: "/logistics-info/{id}", description: "Полная информация" },
      { method: "PUT", path: "/logistics-info/{id}", description: "Обновление типа перевозки" },
    ],
    requestFields: [
      "additional_service", "product_name", "dop_invoice_number", "annotation",
      "cod_payment", "declared_price", "take_date", "period_id",
      "places", "weight", "width", "height", "depth", "volume",
      "cargo_name", "should_return_document", "shipment_type",
      "payment_type", "payment_method", "cash_sum",
      "verify", "is_dangerous", "temperature_regime_type_id",
      "invoice_files", "certificate_of_safety_files", "temperature_regime_safety_files",
    ],
    responseFields: ["shipment_type"],
  },
  change_act_number: {
    label: "📋 Смена номера АВР",
    endpoints: [
      { method: "PUT", path: "gateway.spark.kz/cabinet/api/v2/admin/ftl-orders/mass-change-act-number", description: "Массовая смена АВР" },
    ],
    requestFields: ["actNumber", "ftlOrderIds"],
    responseFields: [],
  },
};

const ACTION_KEYS = Object.keys(ENDPOINT_REFERENCE);

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  POST: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  PUT: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  DELETE: "bg-red-500/10 text-red-600 border-red-500/20",
};

const EndpointConfig = () => {
  const { data: configs, isLoading } = useEndpointFieldConfig();
  const toggleMutable = useToggleFieldMutable();
  const addField = useAddFieldConfig();
  const deleteField = useDeleteFieldConfig();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const updateSetting = useUpdateSetting();

  const [expandedActions, setExpandedActions] = useState<Record<string, boolean>>({});
  const [newField, setNewField] = useState({ action: "", field_name: "", description: "" });
  const [showAddForm, setShowAddForm] = useState(false);
  const [aiPrompt, setAiPrompt] = useState<string | null>(null);
  const [promptDirty, setPromptDirty] = useState(false);

  // Load AI prompt from settings
  const currentPrompt = settings?.find(s => s.key === "ai_system_prompt")?.value || "";
  if (aiPrompt === null && !settingsLoading) {
    // Don't set if already set
  }

  const groupedByAction = configs?.reduce((acc, cfg) => {
    if (!acc[cfg.action]) acc[cfg.action] = [];
    acc[cfg.action].push(cfg);
    return acc;
  }, {} as Record<string, typeof configs>) || {};

  const toggleExpand = (action: string) => {
    setExpandedActions(prev => ({ ...prev, [action]: !prev[action] }));
  };

  const handleToggle = (id: string, current: boolean, fieldName: string) => {
    toggleMutable.mutate(
      { id, is_mutable: !current },
      {
        onSuccess: () => toast.success(`${fieldName}: ${!current ? "изменяемое" : "сохраняемое"}`),
        onError: (e: any) => toast.error(e.message),
      }
    );
  };

  const handleAddField = () => {
    if (!newField.action || !newField.field_name) {
      toast.error("Укажите действие и имя поля");
      return;
    }
    addField.mutate(newField, {
      onSuccess: () => {
        toast.success("Поле добавлено");
        setNewField({ action: "", field_name: "", description: "" });
        setShowAddForm(false);
      },
      onError: (e: any) => toast.error(e.message),
    });
  };

  const handleDeleteField = (id: string, name: string) => {
    if (!confirm(`Удалить поле "${name}"?`)) return;
    deleteField.mutate(id, {
      onSuccess: () => toast.success("Поле удалено"),
      onError: (e: any) => toast.error(e.message),
    });
  };

  const handleSavePrompt = async () => {
    if (aiPrompt === null) return;
    try {
      await updateSetting.mutateAsync({ key: "ai_system_prompt", value: aiPrompt });
      setPromptDirty(false);
      toast.success("AI промт сохранён");
    } catch {
      toast.error("Ошибка сохранения промта");
    }
  };

  if (isLoading || settingsLoading) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-extrabold text-foreground tracking-tight">Эндпоинты и поля</h1></div>
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Эндпоинты и поля</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Все Spark API эндпоинты, отправляемые/получаемые поля и конфигурация мутабельности
        </p>
      </div>

      {/* ─── Endpoint Reference per Action ─── */}
      {ACTION_KEYS.map((action) => {
        const ref = ENDPOINT_REFERENCE[action];
        const fields = groupedByAction[action] || [];
        const isExpanded = expandedActions[action];

        return (
          <section key={action} className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            {/* Header */}
            <button
              onClick={() => toggleExpand(action)}
              className="w-full px-5 py-4 flex items-center justify-between bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-base font-bold text-foreground">{ref.label}</span>
                <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">{action}</span>
                {fields.length > 0 && (
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                    {fields.length} конфиг
                  </span>
                )}
              </div>
              {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </button>

            {isExpanded && (
              <div className="divide-y divide-border">
                {/* Endpoints */}
                <div className="px-5 py-4">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">API Эндпоинты</h3>
                  <div className="space-y-2">
                    {ref.endpoints.map((ep, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${METHOD_COLORS[ep.method] || "bg-muted text-foreground"}`}>
                          {ep.method}
                        </span>
                        <code className="text-xs font-mono text-foreground flex-1 truncate">{ep.path}</code>
                        <span className="text-xs text-muted-foreground hidden sm:block">{ep.description}</span>
                        <button
                          onClick={() => { navigator.clipboard.writeText(ep.path); toast.success("Скопировано"); }}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Request Fields */}
                {ref.requestFields.length > 0 && (
                  <div className="px-5 py-4">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                      Поля запроса (Request Body)
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {ref.requestFields.map((f) => {
                        const cfg = fields.find((c: any) => c.field_name === f);
                        return (
                          <span
                            key={f}
                            className={`text-[11px] font-mono px-2 py-1 rounded border ${
                              cfg
                                ? cfg.is_mutable
                                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                  : "bg-orange-500/10 text-orange-600 border-orange-500/20"
                                : "bg-muted text-muted-foreground border-border"
                            }`}
                          >
                            {f}
                            {cfg && (cfg.is_mutable ? " ✅" : " 🔒")}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Response Fields */}
                {ref.responseFields.length > 0 && (
                  <div className="px-5 py-4">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                      Поля ответа (Response)
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {ref.responseFields.map((f) => (
                        <span key={f} className="text-[11px] font-mono px-2 py-1 rounded border bg-blue-500/10 text-blue-600 border-blue-500/20">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Field Config (mutable toggles) */}
                {fields.length > 0 && (
                  <div className="px-5 py-4">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                      Конфигурация полей (изменяемое / сохраняемое)
                    </h3>
                    <div className="divide-y divide-border/50">
                      {fields.map((field: any) => (
                        <div key={field.id} className="flex items-center justify-between py-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono font-semibold text-foreground">{field.field_name}</span>
                              {field.is_mutable ? (
                                <span className="text-[10px] bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded">изменяемое</span>
                              ) : (
                                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">сохраняемое</span>
                              )}
                            </div>
                            {field.description && <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={field.is_mutable}
                              onCheckedChange={() => handleToggle(field.id, field.is_mutable, field.field_name)}
                              className="scale-90"
                            />
                            <button
                              onClick={() => handleDeleteField(field.id, field.field_name)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}

      {/* ─── Add New Field Config ─── */}
      <section className="bg-card rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">Добавить конфигурацию поля</h2>
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)} className="gap-1.5 rounded-xl">
            <Plus className="w-3.5 h-3.5" />
            {showAddForm ? "Скрыть" : "Добавить"}
          </Button>
        </div>
        {showAddForm && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Действие (action)</Label>
                <Select value={newField.action} onValueChange={(v) => setNewField(prev => ({ ...prev, action: v }))}>
                  <SelectTrigger className="rounded-xl text-sm">
                    <SelectValue placeholder="Выберите действие" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_KEYS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {ENDPOINT_REFERENCE[a].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Имя поля</Label>
                <Input
                  value={newField.field_name}
                  onChange={(e) => setNewField(prev => ({ ...prev, field_name: e.target.value }))}
                  placeholder="payment_type"
                  className="rounded-xl text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Описание</Label>
                <Input
                  value={newField.description}
                  onChange={(e) => setNewField(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Тип оплаты"
                  className="rounded-xl text-sm"
                />
              </div>
            </div>
            <Button size="sm" onClick={handleAddField} disabled={addField.isPending} className="gap-1.5 rounded-full font-semibold">
              <Plus className="w-3.5 h-3.5" />
              {addField.isPending ? "Добавление..." : "Добавить поле"}
            </Button>
          </div>
        )}
      </section>

      {/* ─── AI Prompt Editor ─── */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">AI Промт (System Prompt)</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Кастомный промт для парсинга заявок. Если пусто — используется встроенный промт.
            </p>
          </div>
          <Button
            size="sm"
            variant={promptDirty ? "default" : "outline"}
            onClick={handleSavePrompt}
            disabled={!promptDirty || updateSetting.isPending}
            className="gap-1.5 rounded-xl"
          >
            <Save className="w-3.5 h-3.5" />
            Сохранить
          </Button>
        </div>
        <Textarea
          value={aiPrompt ?? currentPrompt}
          onChange={(e) => { setAiPrompt(e.target.value); setPromptDirty(true); }}
          placeholder="Оставьте пустым для использования встроенного промта..."
          className="text-xs font-mono rounded-xl min-h-[300px] leading-relaxed"
          rows={15}
        />
        <p className="text-[10px] text-muted-foreground">
          ⚠️ Изменение промта влияет на точность парсинга заявок. Рекомендуется тестировать на dry-run режиме.
        </p>
      </section>
    </div>
  );
};

export default EndpointConfig;
