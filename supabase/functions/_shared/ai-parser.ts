import { VERSION, normalizePhone } from "./helpers.ts";

export async function parseWithAI(
  settings: Record<string, string>, summary: string, description: string,
  supabase: any, taskId: string
) {
  const apiKey = settings.openai_api_key;
  if (!apiKey) throw new Error("OpenAI API Key not configured in settings");

  // Use custom prompt from settings if available, otherwise use built-in
  const customPrompt = settings.ai_system_prompt;
  const systemPrompt = (customPrompt && customPrompt.trim().length > 50) ? customPrompt : `Ты — строгий парсер заявок из Jira Service Desk. 

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

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Тема: ${summary}\n\nОписание: ${description}` },
      ],
      temperature: 0,
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    throw new Error(`OpenAI API error ${aiResponse.status}: ${errText}`);
  }

  const aiData = await aiResponse.json();
  const aiContent = aiData.choices?.[0]?.message?.content || "";

  const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
  let aiResult: any = { actions: [] };
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.actions && Array.isArray(parsed.actions)) {
      aiResult = parsed;
    } else if (parsed.action) {
      aiResult = { actions: [parsed] };
    }
  }

  // Post-AI phone validation
  const fullText = `${summary} ${description}`;
  const phoneRegex = /(?:\+?\s*[78])[\s\-]*(?:\d[\s\-]*){10}/g;
  const rawPhoneMatches = fullText.match(phoneRegex);
  const extractedPhones = rawPhoneMatches
    ? rawPhoneMatches.map(m => normalizePhone(m.replace(/[\s\-()]/g, "")))
    : [];
  if (extractedPhones.length > 0) {
    console.log(`[${VERSION}] Extracted phones from text: ${JSON.stringify(extractedPhones)}`);
  }

  // Fix phones in legacy single-action format
  if (aiResult.receiver?.phone && extractedPhones.length > 0) {
    const aiPhone = normalizePhone(aiResult.receiver.phone);
    if (!extractedPhones.includes(aiPhone)) {
      console.log(`[${VERSION}] Phone mismatch! AI="${aiPhone}", original="${extractedPhones[0]}". Using original.`);
      aiResult.receiver.phone = extractedPhones[0];
    }
  }
  if (aiResult.sender?.phone && extractedPhones.length > 0) {
    const aiSenderPhone = normalizePhone(aiResult.sender.phone);
    if (!extractedPhones.includes(aiSenderPhone)) {
      console.log(`[${VERSION}] Sender phone mismatch (legacy)! AI="${aiSenderPhone}", original="${extractedPhones[0]}". Using original.`);
      aiResult.sender.phone = extractedPhones[0];
    }
  }

  // Fix phones in multi-action format
  if (aiResult.actions && extractedPhones.length > 0) {
    for (const action of aiResult.actions) {
      if (action.receiver?.phone) {
        const aiPhone = normalizePhone(action.receiver.phone);
        if (!extractedPhones.includes(aiPhone)) {
          console.log(`[${VERSION}] Action phone mismatch! AI="${aiPhone}", original="${extractedPhones[0]}". Using original.`);
          action.receiver.phone = extractedPhones[0];
        }
      }
      if (action.receiver?.additional_phone) {
        const aiAdditional = normalizePhone(action.receiver.additional_phone);
        if (!extractedPhones.includes(aiAdditional)) {
          const correctedPhone = action.receiver.phone ? normalizePhone(action.receiver.phone) : null;
          if (correctedPhone && aiAdditional !== correctedPhone) {
            console.log(`[${VERSION}] Action additional_phone "${aiAdditional}" is invalid — clearing to let execution use old phone`);
            action.receiver.additional_phone = null;
          }
        }
      }
      if (action.sender?.phone) {
        const aiSenderPhone = normalizePhone(action.sender.phone);
        if (!extractedPhones.includes(aiSenderPhone)) {
          console.log(`[${VERSION}] Sender phone mismatch! AI="${aiSenderPhone}", original="${extractedPhones[0]}". Using original.`);
          action.sender.phone = extractedPhones[0];
        }
      }
    }
  }

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "ai_parse", step: "parse_ticket",
    request_data: { summary, description },
    response_data: aiResult, success: true,
  });

  return aiResult;
}
