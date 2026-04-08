import { useState, useEffect } from "react";
import {
  useEndpointFieldConfig,
  useToggleFieldMutable,
  useAddFieldConfig,
  useUpdateFieldDescription,
  useDeleteFieldConfig,
} from "@/hooks/useEndpointFieldConfig";
import { useSettings, useUpdateSetting } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Trash2, Save, ChevronDown, ChevronRight, Copy, RotateCcw, Check, X,
} from "lucide-react";

// ─── Payment types / methods reference ───
const PAYMENT_TYPES: Record<number, string> = {
  1: "Оплата отправителем",
  2: "Оплата получателем",
};

const PAYMENT_METHODS: Record<number, string> = {
  1: "Безналичный расчёт (счёт)",
  2: "Kaspi / Безнал / Платежи",
  3: "Перечисление",
  4: "Наличные",
};

const SHIPMENT_TYPES: Record<number, string> = {
  1: "Авто (Стандарт)",
  2: "Экспресс",
  3: "Авиа",
};

// ─── Built-in prompt (default) ───
const BUILT_IN_PROMPT = `Ты — строгий парсер заявок из Jira Service Desk. 

ТВОЯ ЗАДАЧА — определить ВСЕ действия, которые клиент просит выполнить в одной заявке. Заявка может содержать НЕСКОЛЬКО действий одновременно.

Поддерживаемые действия:
1. ОТМЕНА ЗАКАЗА (action: "cancel") — клиент ЯВНО просит ОТМЕНИТЬ заказ/накладную (слова: "отменить", "отмена заказа", "аннулировать", "удалить заявку", "удалить заказ", "удалить накладную")
2. СМЕНА АДРЕСА ДОСТАВКИ (action: "update_receiver") — клиент просит изменить адрес доставки (только ПОЛУЧАТЕЛЯ!)
3. СМЕНА ДАННЫХ ПОЛУЧАТЕЛЯ (action: "update_receiver") — клиент просит изменить ФИО и/или телефон ПОЛУЧАТЕЛЯ, а также ДОБАВИТЬ ДОП.НОМЕР
4. СМЕНА ОПЛАТЫ (action: "update_payment") — клиент просит изменить способ или тип оплаты, а также ВНЕСТИ СУММУ
5. СМЕНА НАПРАВЛЕНИЯ (action: "change_direction") — клиент просит изменить ГОРОД НАЗНАЧЕНИЯ/ДОСТАВКИ (получателя)
6. СМЕНА ТИПА ПЕРЕВОЗКИ (action: "change_shipment_type") — клиент просит сменить тип перевозки (авто/авиа)
7. СМЕНА АДРЕСА ОТПРАВИТЕЛЯ (action: "update_sender") — клиент просит изменить адрес/данные ОТПРАВИТЕЛЯ
8. СМЕНА НАПРАВЛЕНИЯ ОТПРАВИТЕЛЯ (action: "change_sender_direction") — клиент просит изменить ГОРОД ОТПРАВИТЕЛЯ/ЗАБОРА
9. СМЕНА НОМЕРА АВР (action: "change_act_number") — клиент просит сменить номер АВР для ФТЛ заказов
10. ВОССТАНОВЛЕНИЕ ЗАКАЗА (action: "restore_order") — клиент просит ВОССТАНОВИТЬ ранее отменённый заказ

ВЕРНИ ТОЛЬКО JSON, без текста вокруг.`;

// ─── Actions and their Spark API details ───
const ENDPOINT_REFERENCE: Record<string, {
  label: string;
  endpoints: { method: string; path: string; description: string }[];
  requestFields: string[];
  responseFields: string[];
  reference?: Record<string, Record<number, string>>;
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
    reference: {
      payment_type: PAYMENT_TYPES,
      payment_method: PAYMENT_METHODS,
      shipment_type: SHIPMENT_TYPES,
    },
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
    reference: {
      shipment_type: SHIPMENT_TYPES,
      payment_type: PAYMENT_TYPES,
      payment_method: PAYMENT_METHODS,
    },
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
  const updateDesc = useUpdateFieldDescription();
  const deleteField = useDeleteFieldConfig();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const updateSetting = useUpdateSetting();

  const [expandedActions, setExpandedActions] = useState<Record<string, boolean>>({});
  const [editingDesc, setEditingDesc] = useState<string | null>(null);
  const [editDescValue, setEditDescValue] = useState("");
  
  // Per-action prompt state
  const [actionPrompts, setActionPrompts] = useState<Record<string, string>>({});
  const [dirtyPrompts, setDirtyPrompts] = useState<Record<string, boolean>>({});
  
  // Global prompt
  const [globalPrompt, setGlobalPrompt] = useState<string | null>(null);
  const [globalPromptDirty, setGlobalPromptDirty] = useState(false);

  // Load prompts from settings
  useEffect(() => {
    if (!settings || settingsLoading) return;
    const loaded: Record<string, string> = {};
    for (const s of settings) {
      if (s.key.startsWith("ai_prompt_")) {
        const action = s.key.replace("ai_prompt_", "");
        loaded[action] = s.value;
      }
    }
    setActionPrompts(prev => {
      // Only set if not already dirty
      const next = { ...prev };
      for (const [k, v] of Object.entries(loaded)) {
        if (!dirtyPrompts[k]) next[k] = v;
      }
      return next;
    });
  }, [settings, settingsLoading]);

  const currentGlobalPrompt = settings?.find(s => s.key === "ai_system_prompt")?.value || "";

  const groupedByAction = configs?.reduce((acc, cfg) => {
    if (!acc[cfg.action]) acc[cfg.action] = [];
    acc[cfg.action].push(cfg);
    return acc;
  }, {} as Record<string, typeof configs>) || {};

  const toggleExpand = (action: string) => {
    setExpandedActions(prev => ({ ...prev, [action]: !prev[action] }));
  };

  // Click a field badge: if not in config → add it; if in config → toggle mutable
  const handleFieldClick = (action: string, fieldName: string) => {
    const fields = groupedByAction[action] || [];
    const existing = fields.find((c: any) => c.field_name === fieldName);
    if (existing) {
      toggleMutable.mutate(
        { id: existing.id, is_mutable: !existing.is_mutable },
        {
          onSuccess: () => toast.success(`${fieldName}: ${!existing.is_mutable ? "изменяемое ✅" : "сохраняемое 🔒"}`),
          onError: (e: any) => toast.error(e.message),
        }
      );
    } else {
      addField.mutate(
        { action, field_name: fieldName, is_mutable: true },
        {
          onSuccess: () => toast.success(`${fieldName} добавлено как изменяемое ✅`),
          onError: (e: any) => toast.error(e.message),
        }
      );
    }
  };

  const handleDeleteField = (id: string, name: string) => {
    if (!confirm(`Удалить поле "${name}" из конфигурации?`)) return;
    deleteField.mutate(id, {
      onSuccess: () => toast.success("Поле удалено"),
      onError: (e: any) => toast.error(e.message),
    });
  };

  const handleSaveDesc = (id: string) => {
    updateDesc.mutate(
      { id, description: editDescValue },
      {
        onSuccess: () => { setEditingDesc(null); toast.success("Описание обновлено"); },
        onError: (e: any) => toast.error(e.message),
      }
    );
  };

  const handleSaveGlobalPrompt = async () => {
    if (globalPrompt === null) return;
    try {
      await updateSetting.mutateAsync({ key: "ai_system_prompt", value: globalPrompt });
      setGlobalPromptDirty(false);
      toast.success("Глобальный промт сохранён");
    } catch {
      toast.error("Ошибка сохранения");
    }
  };

  const handleSaveActionPrompt = async (action: string) => {
    const value = actionPrompts[action] || "";
    try {
      await updateSetting.mutateAsync({ key: `ai_prompt_${action}`, value });
      setDirtyPrompts(prev => ({ ...prev, [action]: false }));
      toast.success(`Промт для ${action} сохранён`);
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
          Кликните на поле чтобы добавить/переключить. Зелёное = изменяемое, оранжевое = сохраняемое.
        </p>
      </div>

      {/* ─── Global AI Prompt ─── */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">🤖 Глобальный AI промт</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Основной промт для парсинга заявок. Применяется ко всем действиям, если нет индивидуального промта.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline"
              onClick={() => { setGlobalPrompt(BUILT_IN_PROMPT); setGlobalPromptDirty(true); toast.info("Встроенный промт загружен"); }}
              className="gap-1.5 rounded-xl"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Встроенный
            </Button>
            <Button
              size="sm" variant={globalPromptDirty ? "default" : "outline"}
              onClick={handleSaveGlobalPrompt}
              disabled={!globalPromptDirty || updateSetting.isPending}
              className="gap-1.5 rounded-xl"
            >
              <Save className="w-3.5 h-3.5" /> Сохранить
            </Button>
          </div>
        </div>
        <Textarea
          value={globalPrompt ?? currentGlobalPrompt}
          onChange={(e) => { setGlobalPrompt(e.target.value); setGlobalPromptDirty(true); }}
          placeholder="Нажмите «Встроенный» чтобы загрузить базовый промт..."
          className="text-xs font-mono rounded-xl min-h-[200px] leading-relaxed"
          rows={10}
        />
      </section>

      {/* ─── Per-action sections ─── */}
      {ACTION_KEYS.map((action) => {
        const ref = ENDPOINT_REFERENCE[action];
        const fields = groupedByAction[action] || [];
        const isExpanded = expandedActions[action];
        const actionPrompt = actionPrompts[action] || "";
        const isPromptDirty = dirtyPrompts[action] || false;

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
                    {fields.filter((f: any) => f.is_mutable).length}/{fields.length} полей
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
                          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(ep.path); toast.success("Скопировано"); }}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Request Fields — clickable badges */}
                {ref.requestFields.length > 0 && (
                  <div className="px-5 py-4">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Поля запроса <span className="text-[10px] font-normal">(кликните чтобы добавить/переключить)</span>
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {ref.requestFields.map((f) => {
                        const cfg = fields.find((c: any) => c.field_name === f);
                        const isConfigured = !!cfg;
                        const isMutable = cfg?.is_mutable ?? false;
                        return (
                          <button
                            key={f}
                            onClick={() => handleFieldClick(action, f)}
                            className={`text-[11px] font-mono px-2 py-1 rounded border cursor-pointer transition-all hover:scale-105 ${
                              isConfigured
                                ? isMutable
                                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20"
                                  : "bg-orange-500/10 text-orange-600 border-orange-500/30 hover:bg-orange-500/20"
                                : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                            }`}
                            title={isConfigured ? (isMutable ? "Изменяемое — клик для блокировки" : "Сохраняемое — клик для разблокировки") : "Не настроено — клик для добавления"}
                          >
                            {f}
                            {isConfigured && (isMutable ? " ✅" : " 🔒")}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Reference values for special fields */}
                {ref.reference && (
                  <div className="px-5 py-4">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Справочник значений</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {Object.entries(ref.reference).map(([fieldName, values]) => (
                        <div key={fieldName} className="space-y-1.5">
                          <span className="text-xs font-mono font-semibold text-foreground">{fieldName}</span>
                          <div className="space-y-1">
                            {Object.entries(values).map(([code, label]) => (
                              <div key={code} className="flex items-center gap-2 text-xs">
                                <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono font-bold min-w-[24px] text-center">{code}</span>
                                <span className="text-muted-foreground">{label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Response Fields */}
                {ref.responseFields.length > 0 && (
                  <div className="px-5 py-4">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Поля ответа</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {ref.responseFields.map((f) => (
                        <span key={f} className="text-[11px] font-mono px-2 py-1 rounded border bg-blue-500/10 text-blue-600 border-blue-500/20">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Configured fields with descriptions — editable */}
                {fields.length > 0 && (
                  <div className="px-5 py-4">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                      Настроенные поля
                    </h3>
                    <div className="divide-y divide-border/50">
                      {fields.map((field: any) => (
                        <div key={field.id} className="flex items-center justify-between py-2.5 gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono font-semibold text-foreground">{field.field_name}</span>
                              {field.is_mutable ? (
                                <span className="text-[10px] bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded">изменяемое</span>
                              ) : (
                                <span className="text-[10px] bg-orange-500/10 text-orange-600 px-1.5 py-0.5 rounded">сохраняемое</span>
                              )}
                            </div>
                            {editingDesc === field.id ? (
                              <div className="flex items-center gap-1.5 mt-1">
                                <Input
                                  value={editDescValue}
                                  onChange={(e) => setEditDescValue(e.target.value)}
                                  className="h-7 text-xs rounded-lg"
                                  placeholder="Описание поля..."
                                  autoFocus
                                />
                                <button onClick={() => handleSaveDesc(field.id)} className="text-emerald-600 hover:text-emerald-700"><Check className="w-3.5 h-3.5" /></button>
                                <button onClick={() => setEditingDesc(null)} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
                              </div>
                            ) : (
                              <p
                                className="text-xs text-muted-foreground mt-0.5 cursor-pointer hover:text-foreground"
                                onClick={() => { setEditingDesc(field.id); setEditDescValue(field.description || ""); }}
                              >
                                {field.description || "Нажмите чтобы добавить описание..."}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={field.is_mutable}
                              onCheckedChange={() => handleFieldClick(action, field.field_name)}
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

                {/* Per-action prompt */}
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Промт для {action}
                    </h3>
                    <Button
                      size="sm" variant={isPromptDirty ? "default" : "outline"}
                      onClick={() => handleSaveActionPrompt(action)}
                      disabled={!isPromptDirty || updateSetting.isPending}
                      className="gap-1.5 rounded-xl h-7 text-xs"
                    >
                      <Save className="w-3 h-3" /> Сохранить
                    </Button>
                  </div>
                  <Textarea
                    value={actionPrompt}
                    onChange={(e) => {
                      setActionPrompts(prev => ({ ...prev, [action]: e.target.value }));
                      setDirtyPrompts(prev => ({ ...prev, [action]: true }));
                    }}
                    placeholder={`Дополнительные инструкции для ${ref.label}... (оставьте пустым для использования глобального промта)`}
                    className="text-xs font-mono rounded-xl min-h-[80px] leading-relaxed"
                    rows={4}
                  />
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default EndpointConfig;
