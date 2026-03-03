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
import { Plus, Trash2, Save, ChevronDown, ChevronRight, Copy, RotateCcw } from "lucide-react";

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

ВАЖНО: РАЗЛИЧАЙ "ТИП ПЕРЕВОЗКИ" и "ТИП ДОСТАВКИ"!
- "Тип перевозки" (авиа/авто/экспресс/стандарт) → change_shipment_type
- "Тип доставки" (курьерская/самовывоз/до двери/до склада) → ИГНОРИРУЙ! Это НЕ поддерживаемое действие.
- Если клиент пишет "сменить тип доставки на курьерскую" — это НЕ change_shipment_type! Игнорируй.

ВАЖНО: АДМИНИСТРАТИВНЫЕ ЗАПРОСЫ — ИГНОРИРУЙ!
- "Добавить направление", "добавить маршрут", "открыть направление" → ИГНОРИРУЙ! Это запросы на редактирование справочников.
- Такие запросы НЕ содержат конкретных накладных для обработки.

Для КАЖДОГО действия в заявке создай отдельный элемент в массиве "actions".

Формат ответа — СТРОГО JSON:
{
  "actions": [
    {
      "action": "cancel" | "update_receiver" | "update_payment" | "change_direction" | "change_shipment_type" | "update_sender" | "change_sender_direction" | "change_act_number" | "restore_order",
      "invoices": ["KXT110098207"],
      // Дополнительные поля в зависимости от action...
    }
  ]
}

Пример НЕСКОЛЬКИХ действий в одной заявке:
Текст: "SP00493934 — сменить телефон получателя на 87773954884. SP00493507 — отменить заказ."
{
  "actions": [
    {
      "action": "update_receiver",
      "invoices": ["SP00493934"],
      "address": null,
      "receiver": {"full_name": null, "phone": "+77773954884", "additional_phone": null, "entity": null}
    },
    {
      "action": "cancel",
      "invoices": ["SP00493507"]
    }
  ]
}

Пример УКАЗАНИЕ/ПОДТВЕРЖДЕНИЕ АДРЕСА ДОСТАВКИ:
Текст: "прошу указать адрес доставки. Адрес доставки: г. Павлодар, пл. Победы, 17 — корректный"
Это СМЕНА АДРЕСА! Клиент указывает новый адрес доставки. Даже если написано "корректный" — это значит что нужно УСТАНОВИТЬ этот адрес.
{
  "actions": [
    {
      "action": "update_receiver",
      "invoices": ["SP00493934", "SP00493937"],
      "address": {"city": "Павлодар", "street": "пл. Победы", "house": "17", "full_address": "г. Павлодар, пл. Победы, 17"},
      "receiver": null
    }
  ]
}

Пример СМЕНА ОПЛАТЫ (на получателя):
{
  "actions": [
    {
      "action": "update_payment",
      "invoices": ["KXT110098207"],
      "payment": {"payment_type": 2, "payment_method": 4, "cash_sum": null}
    }
  ]
}

Пример СМЕНА ОПЛАТЫ (на отправителя):
Текст: "Оплата отправителем 100 тнг" или "Оплату на отправителя 100"
{
  "actions": [
    {
      "action": "update_payment",
      "invoices": ["KXT110098207"],
      "payment": {"payment_type": 1, "payment_method": 4, "cash_sum": 100}
    }
  ]
}

Пример ВНЕСТИ СУММУ НА КАСПИЙ (несколько накладных с разными суммами):
Текст: "SP00489715 прошу внести сумму на каспий 3656 тг\\nSP00490201 26607 тг\\nSP00493407 29766 тг"
{
  "actions": [
    {"action": "update_payment", "invoices": ["SP00489715"], "payment": {"payment_type": 2, "payment_method": 2, "cash_sum": 3656}},
    {"action": "update_payment", "invoices": ["SP00490201"], "payment": {"payment_type": 2, "payment_method": 2, "cash_sum": 26607}},
    {"action": "update_payment", "invoices": ["SP00493407"], "payment": {"payment_type": 2, "payment_method": 2, "cash_sum": 29766}}
  ]
}

Пример СМЕНА НАПРАВЛЕНИЯ:
Текст: "Прошу сменить направление на Астану" или "Перенаправить заказ в Караганду"
{
  "actions": [
    {
      "action": "change_direction",
      "invoices": ["SP00493934"],
      "city": "Астана"
    }
  ]
}

Правила для change_direction:
- city: название города назначения. Указывай ТОЧНО как в тексте заявки.
- Если клиент пишет "сменить направление", "изменить город", "перенаправить" — это change_direction.

Пример СМЕНА ТИПА ПЕРЕВОЗКИ:
Текст: "Прошу сменить тип перевозки на экспресс" или "Сделать авиа доставку"
{
  "actions": [
    {
      "action": "change_shipment_type",
      "invoices": ["KXT110098207"],
      "shipment_type": 2
    }
  ]
}

Правила для change_shipment_type:
- shipment_type: 1 = Авто (Стандарт), 2 = Авиа (Экспресс)
- Слова "стандарт", "авто", "автоперевозка", "наземная" → shipment_type: 1
- Слова "экспресс", "авиа", "авиаперевозка", "срочная" → shipment_type: 2
- Фразы "поменять на авиа", "сменить на авиа", "переделать на авиа" → change_shipment_type, shipment_type: 2
- Фразы "поменять на авто", "сменить на авто", "переделать на стандарт" → change_shipment_type, shipment_type: 1
- ВАЖНО: Если в тексте упоминается только "авиа" или "авто" без другого контекста — это ВСЕГДА смена типа перевозки (change_shipment_type)

Пример СМЕНА АДРЕСА ОТПРАВИТЕЛЯ:
Текст: "Прошу изменить адрес отправителя на ул. Бекболата, 2/2"
{
  "actions": [
    {
      "action": "update_sender",
      "invoices": ["SP00493934"],
      "address": {"city": null, "street": "Бекболата", "house": "2/2", "full_address": "ул. Бекболата, 2/2"},
      "sender": null
    }
  ]
}

Пример СМЕНА ДАННЫХ ОТПРАВИТЕЛЯ:
Текст: "Изменить ФИО отправителя на Иванов Иван, тел: 87771234567"
{
  "actions": [
    {
      "action": "update_sender",
      "invoices": ["SP00493934"],
      "address": null,
      "sender": {"full_name": "Иванов Иван", "phone": "+77771234567", "entity": "Иванов Иван"}
    }
  ]
}

Пример СМЕНА НАПРАВЛЕНИЯ ОТПРАВИТЕЛЯ (только город):
Текст: "Сменить город забора на Астану" или "Изменить город отправителя на Караганду"
{
  "actions": [
    {
      "action": "change_sender_direction",
      "invoices": ["SP00493934"],
      "city": "Астана"
    }
  ]
}

Пример СМЕНА НАПРАВЛЕНИЯ ОТПРАВИТЕЛЯ С АДРЕСОМ И ДАННЫМИ:
Текст: "Прошу поменять город отправителя на Алмату Адрес Толе би 101 номер +77763136078 Мейржан"
{
  "actions": [
    {
      "action": "change_sender_direction",
      "invoices": ["SP00494613"],
      "city": "Алмата",
      "address": {"city": "Алмата", "street": "Толе би", "house": "101", "full_address": "Казахстан, г. Алмата, ул. Толе би, 101"},
      "sender": {"full_name": "Мейржан", "phone": "+77763136078", "entity": "Мейржан"}
    }
  ]
}

Правила для update_sender:
- Аналогично update_receiver, но для ОТПРАВИТЕЛЯ
- Слова "отправитель", "забор", "адрес забора", "данные отправителя" → update_sender
- Формат address и sender такой же как у update_receiver

Правила для change_sender_direction:
- Аналогично change_direction, но для ОТПРАВИТЕЛЯ
- Слова "город отправителя", "город забора", "сменить город отправки" → change_sender_direction
- ВАЖНО: Если помимо города указан адрес, телефон или ФИО — включи их в "address" и "sender" в том же действии change_sender_direction. НЕ создавай отдельный update_sender!

Пример СМЕНА НОМЕРА АВР:
Текст: "поменять номер АВР на этот БК000000313 по ФТЛ заказам ниже: 9590, 9518"
{
  "actions": [
    {
      "action": "change_act_number",
      "act_number": "БК000000313",
      "ftl_order_ids": ["9590", "9518"]
    }
  ]
}

Правила для change_act_number:
- act_number: номер АВР ТОЧНО как в тексте (например "БК000000313")
- ftl_order_ids: массив ID ФТЛ заказов. КАЖДЫЙ ID должен быть СТРОГО 4 цифры. Если ID длиннее или короче 4 цифр — ИГНОРИРУЙ его.
- Извлекай ФТЛ номера из текста: обычно это 4-значные числа (9590, 9518 и т.д.)
- НЕ путай с номерами накладных (KXT..., SP...) — это ДРУГОЕ
- У этого действия НЕТ поля "invoices" — используются ftl_order_ids

Пример ВОССТАНОВЛЕНИЕ ЗАКАЗА:
Текст: "Прошу восстановить заказ KXT110098207" или "Восстановить накладную SP00493934"
{
  "actions": [
    {
      "action": "restore_order",
      "invoices": ["KXT110098207"]
    }
  ]
}

Правила для restore_order:
- Слова "восстановить", "восстановить заказ", "восстановить накладную", "вернуть заказ" → restore_order
- НЕ путай с отменой! Восстановление — это ОБРАТНОЕ действие отмене.
- Формат аналогичен cancel — массив invoices.

Правила для payment:
- payment_type: 1 = оплата отправителем, 2 = оплата получателем. Если не указано — ставь 2.
- payment_method: 4 = наличка, 2 = платежи/безнал/каспий/kaspi.
- cash_sum: ТОЛЬКО если сумма ЯВНО указана. Иначе null.
- "внести сумму", "добавить сумму", "закинуть сумму" = update_payment с cash_sum.
- "на каспий" / "на kaspi" / "каспий" = payment_method: 2 (безнал).
- Если у каждой накладной СВОЯ сумма — создай ОТДЕЛЬНЫЙ update_payment для каждой накладной!

НАЛОЖНЫЙ ПЛАТЕЖ (НП / наложка):
- "НП", "наложный платеж", "наложка" — это поле cod_payment (цена за товар при доставке).
- "Убрать НП", "снять наложку", "убрать наложный платеж", "обнулить НП" → action: "update_payment" с payment: {"cod_payment": 0, "payment_type": null, "payment_method": null, "cash_sum": null}
- Когда cod_payment указан — НЕ ТРОГАЙ payment_type, payment_method и cash_sum! Эти поля про оплату за ПЕРЕВОЗКУ, а НП — это про товар!
- Если значения payment_type/payment_method/cash_sum равны null в payment — executor оставит текущие значения без изменений.

Пример УБРАТЬ НАЛОЖНЫЙ ПЛАТЕЖ:
Текст: "Убрать НП" или "Снять наложку" или "Убрать наложный платеж"
{
  "actions": [
    {
      "action": "update_payment",
      "invoices": ["SP00493934"],
      "payment": {"cod_payment": 0, "payment_type": null, "payment_method": null, "cash_sum": null}
    }
  ]
}

ПРАВИЛА ДЛЯ ФТЛ ЗАКАЗОВ (4-значные номера):
- Если номер накладной состоит РОВНО из 4 цифр (например 9590, 1234) — это ФТЛ заказ.
- ФТЛ заказы поддерживают ТОЛЬКО действие change_act_number!
- Если просят изменить себестоимость, сумму или любое ДРУГОЕ действие для 4-значного номера — ИГНОРИРУЙ! НЕ создавай action для таких накладных.
- Исключение: если действие change_act_number — тогда используй ftl_order_ids как обычно.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА ПАРСИНГА:

1. "СМЕНА ДАННЫХ" в теме (summary) — это НЕ действие! Это общий заголовок. Определяй действие ТОЛЬКО из описания (description). Тема содержит лишь накладные и общий контекст.

2. ВСЕ НАКЛАДНЫЕ ИЗ ЗАЯВКИ = ОДНО ДЕЙСТВИЕ: Если в теме/описании перечислены несколько накладных и указано ОДНО действие (например "смена типа перевозки на авиа"), то ВСЕ накладные относятся к ЭТОМУ действию. НЕ разделяй их на разные действия!
   Пример: Тема "смена данных SP00496685 SP00496647", Описание "SP00496685 SP00496647 смена типа перевозки на авиа"
   Правильно: {"actions": [{"action": "change_shipment_type", "invoices": ["SP00496685", "SP00496647"], "shipment_type": 2}]}
   НЕПРАВИЛЬНО: создавать update_sender для одной накладной и change_shipment_type для другой!

3. НОМЕР НАКЛАДНОЙ может быть в теме (summary) или в описании. ОБЯЗАТЕЛЬНО извлеки его. Формат: буквы + цифры (KXT110098207, SP00493507, SLQ0902260207...).
4. Если НЕТ номера накладной НО есть действие — верни {"actions": [], "needs_invoice": true, "detected_action": "<название_действия>"}.
5. Если НЕТ номера накладной И нет действия — верни {"actions": []}.
6. Если просят сменить ТОЛЬКО ФИО/телефон — НЕ включай "address", только "receiver".
7. Если просят сменить ТОЛЬКО адрес — НЕ включай "receiver", только "address".
8. Если просят и адрес, и ФИО/телефон — включи оба в ОДНОМ update_receiver.
9. Поле "entity" — это название организации/компании. Если упоминается — включи в receiver/sender как "entity".
10. При изменении данных получателя/отправителя — ВСЕГДА копируй entity из текста заявки.
11. Телефон КОПИРУЙ ТОЧНО. Только замени первую 8 на +7 (87773954884 → +77773954884).
12. ДОП.НОМЕР (additional_phone): Если в заявке 2 номера — первый в "phone", второй в "additional_phone". Если не указан — НЕ включай.
13. ГОРОД: Если не указан явно — city: null. НЕ УГАДЫВАЙ.
14. full_address: без города → "ул. {улица}, {дом}". С городом → "Казахстан, г. {город}, ул. {улица}, {дом}".
15. street и house — разделяй правильно. "С312 11" → street: "С312", house: "11".

ВЕРНИ ТОЛЬКО JSON, без текста вокруг.`;

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
              Редактируйте промт для парсинга заявок. Нажмите «Загрузить встроенный» чтобы начать с базового промта.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAiPrompt(BUILT_IN_PROMPT);
                setPromptDirty(true);
                toast.info("Встроенный промт загружен. Отредактируйте и сохраните.");
              }}
              className="gap-1.5 rounded-xl"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Загрузить встроенный
            </Button>
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
        </div>
        <Textarea
          value={aiPrompt ?? currentPrompt}
          onChange={(e) => { setAiPrompt(e.target.value); setPromptDirty(true); }}
          placeholder="Нажмите «Загрузить встроенный» чтобы загрузить базовый промт для редактирования..."
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
