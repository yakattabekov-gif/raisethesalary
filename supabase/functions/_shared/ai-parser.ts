import { VERSION, normalizePhone } from "./helpers.ts";

// ---- Stage 1: Strict structured parser ----
async function callStrictParser(
  apiKey: string, systemPrompt: string, summary: string, description: string
): Promise<any> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
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
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// ---- Stage 2: Independent reviewer (no strict schema, just analyse) ----
async function callIndependentReviewer(
  apiKey: string, summary: string, description: string
): Promise<string> {
  const reviewPrompt = `Ты — независимый аналитик заявок логистической компании Spark. Прочитай заявку из Jira и определи:
1. Что КОНКРЕТНО просит клиент? Перечисли все действия своими словами.
2. Какие номера накладных упоминаются? (формат KXT..., SP..., SLQ..., AR... или чисто цифровой 12-15 цифр)
3. Какие данные клиент предоставил (телефоны, адреса, суммы, города)?
4. Есть ли что-то неоднозначное или подозрительное в заявке?

ВАЖНЫЙ КОНТЕКСТ:
- "Внести сумму на каспи" = установить сумму оплаты за перевозку способом Kaspi. Это СТАНДАРТНАЯ операция, НЕ требует никаких дополнительных деталей (номер счёта и т.п.).
- "Внести сумму наличку" = установить сумму оплаты за перевозку наличными. Тоже СТАНДАРТНАЯ операция.
- Каспи (Kaspi) — это способ оплаты (payment_method), а НЕ банковский счёт. Не нужны детали "на какой счёт".
- Не путай "внести сумму" (cash_sum — оплата за перевозку) с "НП/наложка" (cod_payment — наложенный платёж).

Отвечай кратко, по пунктам. НЕ форматируй как JSON. Просто анализ.`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: reviewPrompt },
        { role: "user", content: `Тема: ${summary}\n\nОписание: ${description}` },
      ],
      temperature: 0.2,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI reviewer error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// ---- Stage 3: Comparator — decides if actions are correct ----
async function callComparator(
  apiKey: string, parserResult: string, reviewerAnalysis: string, summary: string, description: string
): Promise<{ approved: boolean; corrected_actions?: any; reason: string }> {
  const comparatorPrompt = `Ты — финальный арбитр. Твоя задача — сравнить результат парсера (JSON) с независимым анализом заявки и решить, правильно ли парсер определил действия.

ПРАВИЛА:
1. Сравни действия парсера с анализом рецензента.
2. Проверь: совпадают ли действия? Правильные ли накладные? Верны ли данные (телефоны, адреса, суммы)?
3. Если всё совпадает и ты УВЕРЕН — верни approved: true.
4. Если есть расхождения или ошибки — верни approved: false и объясни причину.
5. Если можешь исправить — верни corrected_actions с правильным JSON.

ВАЖНО: Если в заявке ЯВНО написано "отмена заказа", "отменить", "прошу отменить", "нужно отменить" — ВСЕГДА ОДОБРЯЙ отмену! Не блокируй и не отклоняй отмену если клиент чётко просит отменить. Для СТАНДАРТНЫХ операций (внести сумму, сменить адрес, сменить оплату) — если парсер правильно определил действие, накладную и данные — ОДОБРЯЙ.

НЕ ОТКЛОНЯЙ заявки по следующим причинам:
- "не указан счёт Каспи" — Каспи это просто способ оплаты (payment_method=2), счёт не нужен
- "не указаны детали оплаты" — если есть накладная + сумма + способ, этого ДОСТАТОЧНО
- "неоднозначность" без реальной проблемы — если рецензент сам распознал то же действие

КРИТИЧЕСКИ ВАЖНО ДЛЯ НП (наложный платёж / наложка):
- Если заявка про "убрать НП" / "снять наложку" / "добавить НП" — парсер ПРАВИЛЬНО ставит cod_payment и null в остальных полях payment.
- НЕ ИЗМЕНЯЙ payment_type, payment_method, cash_sum в corrected_actions если речь только про НП!
- НЕ ВЫДУМЫВАЙ значения типа "remove_cod" — используй ТОЛЬКО числа (1,2,3,4) или null!
- Если парсер вернул cod_payment=0 и остальное null — это ПРАВИЛЬНО для "убрать НП". ОДОБРЯЙ!

Формат ответа — СТРОГО JSON:
{
  "approved": true/false,
  "reason": "краткое объяснение решения",
  "corrected_actions": null или исправленный массив actions (только если approved=false и ты можешь исправить)
}

ВЕРНИ ТОЛЬКО JSON.`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: comparatorPrompt },
        { role: "user", content: `ОРИГИНАЛЬНАЯ ЗАЯВКА:\nТема: ${summary}\nОписание: ${description}\n\nРЕЗУЛЬТАТ ПАРСЕРА (JSON):\n${parserResult}\n\nНЕЗАВИСИМЫЙ АНАЛИЗ:\n${reviewerAnalysis}` },
      ],
      temperature: 0,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI comparator error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return { approved: true, reason: "Failed to parse comparator response, defaulting to approved" };
    }
  }
  return { approved: true, reason: "No JSON in comparator response, defaulting to approved" };
}

// ---- Parse JSON from AI content ----
function parseAIContent(aiContent: string): any {
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
  // Normalize each action to fix common AI mistakes
  normalizeActions(aiResult);
  return aiResult;
}

// ---- Normalize actions: fix common AI field naming mistakes ----
function normalizeActions(aiResult: any) {
  if (!aiResult.actions || !Array.isArray(aiResult.actions)) return;
  for (const action of aiResult.actions) {
    // Fix invoice_number / invoice → invoices[]
    if (!action.invoices || (Array.isArray(action.invoices) && action.invoices.length === 0)) {
      if (action.invoice_number) {
        action.invoices = Array.isArray(action.invoice_number) ? action.invoice_number : [action.invoice_number];
        delete action.invoice_number;
      } else if (action.invoice) {
        action.invoices = Array.isArray(action.invoice) ? action.invoice : [action.invoice];
        delete action.invoice;
      }
    }

    // Fix update_payment: amount/sum/cash_sum at top level → payment object
    if (action.action === "update_payment") {
      if (!action.payment) action.payment = {};
      // Move top-level amount/sum into payment.cash_sum
      if (action.amount !== undefined && action.amount !== null) {
        if (action.payment.cash_sum === undefined || action.payment.cash_sum === null) {
          action.payment.cash_sum = Number(action.amount);
        }
        delete action.amount;
      }
      if (action.sum !== undefined && action.sum !== null) {
        if (action.payment.cash_sum === undefined || action.payment.cash_sum === null) {
          action.payment.cash_sum = Number(action.sum);
        }
        delete action.sum;
      }
      // Move top-level payment_type/payment_method into payment
      if (action.payment_type !== undefined) {
        if (action.payment.payment_type === undefined) action.payment.payment_type = action.payment_type;
        delete action.payment_type;
      }
      if (action.payment_method !== undefined) {
        if (action.payment.payment_method === undefined) action.payment.payment_method = action.payment_method;
        delete action.payment_method;
      }
      if (action.cash_sum !== undefined) {
        if (action.payment.cash_sum === undefined || action.payment.cash_sum === null) action.payment.cash_sum = Number(action.cash_sum);
        delete action.cash_sum;
      }
      if (action.cod_payment !== undefined) {
        if (action.payment.cod_payment === undefined) action.payment.cod_payment = action.cod_payment;
        delete action.cod_payment;
      }
    }
  }
}

// ---- Phone validation (unchanged logic) ----
function validatePhones(aiResult: any, summary: string, description: string) {
  const fullText = `${summary} ${description}`;
  const phoneRegex = /(?:\+?\s*[78])[\s\-]*(?:\d[\s\-]*){10}/g;
  const rawPhoneMatches = fullText.match(phoneRegex);
  const extractedPhones = rawPhoneMatches
    ? rawPhoneMatches.map(m => normalizePhone(m.replace(/[\s\-()]/g, "")))
    : [];
  if (extractedPhones.length > 0) {
    console.log(`[${VERSION}] Extracted phones from text: ${JSON.stringify(extractedPhones)}`);
  }

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
      aiResult.sender.phone = extractedPhones[0];
    }
  }

  if (aiResult.actions && extractedPhones.length > 0) {
    for (const action of aiResult.actions) {
      if (action.receiver?.phone) {
        const aiPhone = normalizePhone(action.receiver.phone);
        if (!extractedPhones.includes(aiPhone)) {
          action.receiver.phone = extractedPhones[0];
        }
      }
      if (action.receiver?.additional_phone) {
        const aiAdditional = normalizePhone(action.receiver.additional_phone);
        if (!extractedPhones.includes(aiAdditional)) {
          const correctedPhone = action.receiver.phone ? normalizePhone(action.receiver.phone) : null;
          if (correctedPhone && aiAdditional !== correctedPhone) {
            action.receiver.additional_phone = null;
          }
        }
      }
      if (action.sender?.phone) {
        const aiSenderPhone = normalizePhone(action.sender.phone);
        if (!extractedPhones.includes(aiSenderPhone)) {
          action.sender.phone = extractedPhones[0];
        }
      }
    }
  }
}

// ---- Main export: 3-stage AI pipeline ----
export async function parseWithAI(
  settings: Record<string, string>, summary: string, description: string,
  supabase: any, taskId: string
) {
  const apiKey = settings.openai_api_key;
  if (!apiKey) throw new Error("OpenAI API Key not configured in settings");

  const customPrompt = settings.ai_system_prompt;
  const systemPrompt = (customPrompt && customPrompt.trim().length > 50) ? customPrompt : getBuiltInPrompt();

  // === STAGE 1: Strict parser ===
  console.log(`[${VERSION}] Stage 1: Strict parser for task ${taskId}`);
  const parserContent = await callStrictParser(apiKey, systemPrompt, summary, description);
  const parserResult = parseAIContent(parserContent);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "ai_parse", step: "stage1_parser",
    request_data: { summary, description },
    response_data: { raw: parserContent, parsed: parserResult }, success: true,
  });

  // If no actions found, skip stages 2-3
  if (!parserResult.actions || parserResult.actions.length === 0) {
    console.log(`[${VERSION}] Stage 1: No actions found, skipping verification`);
    return parserResult;
  }

  // === STAGE 2: Independent reviewer ===
  console.log(`[${VERSION}] Stage 2: Independent reviewer for task ${taskId}`);
  const reviewerAnalysis = await callIndependentReviewer(apiKey, summary, description);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "ai_parse", step: "stage2_reviewer",
    request_data: { summary, description },
    response_data: { analysis: reviewerAnalysis }, success: true,
  });

  // === STAGE 3: Comparator ===
  console.log(`[${VERSION}] Stage 3: Comparator for task ${taskId}`);
  const comparatorResult = await callComparator(apiKey, parserContent, reviewerAnalysis, summary, description);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "ai_parse", step: "stage3_comparator",
    request_data: { parser_result: parserContent, reviewer_analysis: reviewerAnalysis },
    response_data: comparatorResult, success: true,
  });

  let finalResult: any;

  if (comparatorResult.approved) {
    console.log(`[${VERSION}] Stage 3: APPROVED — ${comparatorResult.reason}`);
    finalResult = parserResult;
  } else if (comparatorResult.corrected_actions) {
    console.log(`[${VERSION}] Stage 3: CORRECTED — ${comparatorResult.reason}`);
    finalResult = { actions: comparatorResult.corrected_actions };
    // Normalize corrected actions (comparator often uses wrong field names)
    normalizeActions(finalResult);
  } else {
    console.log(`[${VERSION}] Stage 3: REJECTED — ${comparatorResult.reason}`);
    finalResult = { actions: [], rejected: true, reject_reason: comparatorResult.reason };
  }

  // Phone validation on final result
  validatePhones(finalResult, summary, description);

  // Strip "Казахстан" from city fields — it's a country, not a city
  if (finalResult.actions) {
    for (const action of finalResult.actions) {
      if (action.address?.city && action.address.city.toLowerCase().replace(/\s/g, "") === "казахстан") {
        console.log(`[${VERSION}] Post-process: stripped "Казахстан" from address.city`);
        action.address.city = null;
      }
      if (action.city && action.city.toLowerCase().replace(/\s/g, "") === "казахстан") {
        console.log(`[${VERSION}] Post-process: stripped "Казахстан" from action.city`);
        action.city = null;
      }
      // Also strip from full_address prefix
      if (action.address?.full_address) {
        action.address.full_address = action.address.full_address.replace(/^Казахстан,?\s*/i, "");
      }
    }
  }

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "ai_parse", step: "final_result",
    request_data: { summary, description },
    response_data: finalResult, success: true,
  });

  return finalResult;
}

// ---- Built-in prompt (extracted for reuse) ----
function getBuiltInPrompt(): string {
  return `Ты — строгий парсер заявок из Jira Service Desk. 

ТВОЯ ЗАДАЧА — определить ВСЕ действия, которые клиент просит выполнить в одной заявке. Заявка может содержать НЕСКОЛЬКО действий одновременно.

Поддерживаемые действия:
1. ОТМЕНА ЗАКАЗА (action: "cancel") — клиент просит ОТМЕНИТЬ заказ/накладную. Если в заявке ЧЕТКО написано "отмена заказа", "отменить заказ", "отмена заявки", "аннулировать", "удалить заявку", "удалить заказ", "удалить накладную", "просим отменить", "нужно отменить", "прошу отменить" — ВСЕГДА ставь action: "cancel". НЕ ИГНОРИРУЙ такие заявки ни при каких условиях! Даже если в заявке есть другие слова/просьбы — отмена имеет ВЫСШИЙ ПРИОРИТЕТ.
2. СМЕНА АДРЕСА ДОСТАВКИ (action: "update_receiver") — клиент просит изменить адрес доставки (только ПОЛУЧАТЕЛЯ!)
3. СМЕНА ДАННЫХ ПОЛУЧАТЕЛЯ (action: "update_receiver") — клиент просит изменить ФИО и/или телефон ПОЛУЧАТЕЛЯ, а также ДОБАВИТЬ ДОП.НОМЕР
4. СМЕНА ОПЛАТЫ (action: "update_payment") — клиент просит изменить способ или тип оплаты, ВНЕСТИ СУММУ, ВЫСТАВИТЬ СЧЁТ НА ОПЛАТУ, или убрать/добавить НАЛОЖНЫЙ ПЛАТЕЖ (НП/наложку). "Выставить счёт на оплату" = "внести сумму" = update_payment с cash_sum!
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

КРИТИЧЕСКИ ВАЖНО — ГОРОД В АДРЕСЕ:
- Если клиент указывает ТОЛЬКО улицу/дом/квартиру БЕЗ города — city ДОЛЖЕН быть null! НЕ придумывай город!
- "Казахстан" — это СТРАНА, НЕ город! Никогда не ставь "Казахстан" как city!
- city указывай ТОЛЬКО если клиент ЯВНО написал название города (Алматы, Астана, Павлодар и т.д.)

Пример СМЕНА ТОЛЬКО АДРЕСА (без города):
Текст: "KXT110146825 адрес Макатаев 7/3 кв 7"
{
  "actions": [
    {
      "action": "update_receiver",
      "invoices": ["KXT110146825"],
      "address": {"city": null, "street": "Макатаев", "house": "7/3", "apartment": "7", "full_address": "ул. Макатаев, 7/3, кв. 7"},
      "receiver": null
    }
  ]
}

Пример УКАЗАНИЕ/ПОДТВЕРЖДЕНИЕ АДРЕСА ДОСТАВКИ:
Текст: "прошу указать адрес доставки. Адрес доставки: г. Павлодар, пл. Победы, 17 — корректный"
Это СМЕНА АДРЕСА! Клиент указывает новый адрес доставки.
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
Текст: "Оплата отправителем 100 тнг"
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

Пример ВЫСТАВИТЬ СЧЁТ НА ОПЛАТУ (= внести сумму):
Текст: "SP00509038 прошу выставить счет на оплату 3642.4 тг"
{
  "actions": [
    {"action": "update_payment", "invoices": ["SP00509038"], "payment": {"payment_type": null, "payment_method": null, "cash_sum": 3642.4}}
  ]
}

Пример ВНЕСТИ СУММУ НА КАСПИЙ (одна накладная):
Текст: "SP00508472 - Стоимость итого: 42025 тг" (тема: "внести сумму на каспи")
{
  "actions": [
    {"action": "update_payment", "invoices": ["SP00508472"], "payment": {"payment_type": 2, "payment_method": 2, "cash_sum": 42025}}
  ]
}

Пример УБРАТЬ НАЛОЖНЫЙ ПЛАТЕЖ (НП):
Текст: "KXT110098207 убрать НП"
{
  "actions": [
    {"action": "update_payment", "invoices": ["KXT110098207"], "payment": {"cod_payment": 0, "payment_type": null, "payment_method": null, "cash_sum": null}}
  ]
}

Пример ДОБАВИТЬ НАЛОЖНЫЙ ПЛАТЕЖ:
Текст: "KXT110098207 наложка 15000"
{
  "actions": [
    {"action": "update_payment", "invoices": ["KXT110098207"], "payment": {"cod_payment": 15000, "payment_type": null, "payment_method": null, "cash_sum": null}}
  ]
}


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

Пример СМЕНА ТИПА ПЕРЕВОЗКИ:
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
- Слова "стандарт", "авто" → shipment_type: 1
- Слова "экспресс", "авиа" → shipment_type: 2
- ВАЖНО: Если в тексте упоминается только "авиа" или "авто" без другого контекста — это ВСЕГДА смена типа перевозки

Пример СМЕНА АДРЕСА ОТПРАВИТЕЛЯ:
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

Пример СМЕНА НАПРАВЛЕНИЯ ОТПРАВИТЕЛЯ С АДРЕСОМ И ДАННЫМИ:
{
  "actions": [
    {
      "action": "change_sender_direction",
      "invoices": ["SP00494613"],
      "city": "Алмата",
      "address": {"city": "Алмата", "street": "Толе би", "house": "101", "full_address": "г. Алмата, ул. Толе би, 101"},
      "sender": {"full_name": "Мейржан", "phone": "+77763136078", "entity": "Мейржан"}
    }
  ]
}

Правила для update_sender:
- Аналогично update_receiver, но для ОТПРАВИТЕЛЯ

Правила для change_sender_direction:
- Аналогично change_direction, но для ОТПРАВИТЕЛЯ
- ВАЖНО: Если помимо города указан адрес, телефон или ФИО — включи их в "address" и "sender" в том же действии. НЕ создавай отдельный update_sender!

Пример СМЕНА НОМЕРА АВР:
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
- ftl_order_ids: массив ID ФТЛ заказов. КАЖДЫЙ ID должен быть СТРОГО 4 цифры.
- У этого действия НЕТ поля "invoices" — используются ftl_order_ids

Пример ВОССТАНОВЛЕНИЕ ЗАКАЗА:
{
  "actions": [
    {
      "action": "restore_order",
      "invoices": ["KXT110098207"]
    }
  ]
}

Правила для payment:
- payment_type: 1 = оплата отправителем, 2 = оплата получателем. Если не указано — НЕ УКАЗЫВАЙ (null).
- payment_method: 4 = наличка/наличные, 2 = каспий/kaspi/безнал/платежи. Если не указано — НЕ УКАЗЫВАЙ (null).
- cash_sum: ТОЛЬКО если сумма ЯВНО указана. Иначе null.
- Если у каждой накладной СВОЯ сумма — создай ОТДЕЛЬНЫЙ update_payment для каждой!

КРИТИЧЕСКИ ВАЖНО — "ВНЕСТИ СУММУ" / "ВЫСТАВИТЬ СЧЁТ" / "НАЛИЧКА" / "КАСПИ" (БЕЗ упоминания НП):
Когда пишут "внести сумму", "внести сумму наличку", "внести сумму на каспи", "выставить счёт на оплату", "сумма за перевозку", "стоимость итого" и НЕТ слов "НП"/"наложка"/"наложный платеж" — это ОПЛАТА ЗА ПЕРЕВОЗКУ!
- "внести сумму на каспи 18932" → payment: {"cash_sum": 18932, "payment_method": 2, "payment_type": null, "cod_payment": null}
- "внести сумму наличку 5000" → payment: {"cash_sum": 5000, "payment_method": 4, "payment_type": null, "cod_payment": null}
- "внести сумму 10000" (без уточнения метода) → payment: {"cash_sum": 10000, "payment_method": null, "payment_type": null, "cod_payment": null}
- "выставить счёт на оплату 3642 тг" → payment: {"cash_sum": 3642, "payment_method": null, "payment_type": null, "cod_payment": null}
- "Стоимость итого: 42025 тг" + тема "внести сумму на каспи" → payment: {"cash_sum": 42025, "payment_method": 2, "payment_type": null, "cod_payment": null}
НЕ ОТКЛОНЯЙ такие заявки! Это стандартная операция update_payment!

⚠️ САМАЯ ЧАСТАЯ ОШИБКА: НЕ ЗАБЫВАЙ ИЗВЛЕЧЬ НОМЕР НАКЛАДНОЙ И СУММУ! 
Каждое действие ОБЯЗАТЕЛЬНО должно содержать поле "invoices" с массивом номеров накладных!
Если пишут "SP00508472 - Стоимость итого: 42025 тг" → invoices: ["SP00508472"], payment.cash_sum: 42025.
НИКОГДА не возвращай action без invoices (кроме change_act_number)!

КРИТИЧЕСКИ ВАЖНО — НАЛОЖНЫЙ ПЛАТЕЖ (НП / наложка / cod_payment):
НП (наложный платёж) — это ОТДЕЛЬНОЕ поле cod_payment! Это НЕ payment_type, НЕ payment_method, НЕ cash_sum!
- "Убрать НП", "снять наложку", "убрать наложный платеж" → payment: {"cod_payment": 0, "payment_type": null, "payment_method": null, "cash_sum": null}
- "Добавить НП 5000", "наложка 5000" → payment: {"cod_payment": 5000, "payment_type": null, "payment_method": null, "cash_sum": null}
- Когда в заявке речь ТОЛЬКО про НП/наложку — НЕ ТРОГАЙ payment_type, payment_method и cash_sum! Ставь их в null!

ПРАВИЛА ДЛЯ ФТЛ ЗАКАЗОВ (4-значные номера):
- Если номер состоит РОВНО из 4 цифр — это ФТЛ заказ.
- ФТЛ заказы поддерживают действия: change_act_number и cancel.
- Для остальных действий (update_receiver, update_payment, change_direction и т.д.) ФТЛ заказы НЕ поддерживаются.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА ПАРСИНГА:
1. "СМЕНА ДАННЫХ" в теме — это НЕ действие! Определяй действие ТОЛЬКО из описания.
2. ВСЕ НАКЛАДНЫЕ ИЗ ЗАЯВКИ = ОДНО ДЕЙСТВИЕ если указано одно действие.
3. НОМЕР НАКЛАДНОЙ может быть в теме или описании. Форматы: буквы + цифры (KXT..., SP..., SLQ..., AR...) ИЛИ чисто цифровой номер из 12-15 цифр (например 950964874695000). Пример AR-накладных: AR99986902, AR99986888.
4. Если НЕТ номера накладной НО есть действие — верни {"actions": [], "needs_invoice": true, "detected_action": "<название>"}.
5. Если НЕТ номера и нет действия — верни {"actions": []}.
6. Телефон: замени первую 8 на +7 (87773954884 → +77773954884).
7. ДОП.НОМЕР: Если 2 номера — первый в "phone", второй в "additional_phone".
8. ГОРОД: Если не указан явно — city: null.
9. full_address: без города → "ул. {улица}, {дом}". С городом → "г. {город}, ул. {улица}, {дом}". НЕ ДОБАВЛЯЙ "Казахстан" в full_address!

ВЕРНИ ТОЛЬКО JSON, без текста вокруг.`;
}
