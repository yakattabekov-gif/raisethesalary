import { VERSION, normalizePhone } from "./helpers.ts";

// ---- Multi-provider AI call ----
async function callAI(
  provider: string, apiKey: string, systemPrompt: string, userContent: string, temperature: number = 0
): Promise<string> {
  let url: string;
  let headers: Record<string, string>;
  let body: any;

  if (provider === "claude") {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
      temperature,
    };
  } else if (provider === "lovable") {
    url = "https://ai.gateway.lovable.dev/v1/chat/completions";
    headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    body = {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature,
    };
  } else {
    // openai (default)
    url = "https://api.openai.com/v1/chat/completions";
    headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    body = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature,
    };
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`${provider} API error ${resp.status}: ${t}`);
  }

  const data = await resp.json();

  if (provider === "claude") {
    // Anthropic response format
    return data.content?.[0]?.text || "";
  } else {
    // OpenAI-compatible format (openai + lovable)
    return data.choices?.[0]?.message?.content || "";
  }
}

// Resolve provider and API key from settings
function resolveProvider(settings: Record<string, string>): { provider: string; apiKey: string } {
  const provider = (settings.ai_provider || "openai").toLowerCase();
  
  if (provider === "claude") {
    const key = settings.claude_api_key;
    if (!key) throw new Error("Claude API Key not configured in settings");
    return { provider: "claude", apiKey: key };
  } else if (provider === "lovable") {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) throw new Error("LOVABLE_API_KEY not available");
    return { provider: "lovable", apiKey: key };
  } else {
    const key = settings.openai_api_key;
    if (!key) throw new Error("OpenAI API Key not configured in settings");
    return { provider: "openai", apiKey: key };
  }
}

// ---- Stage 1: Strict structured parser ----
async function callStrictParser(
  provider: string, apiKey: string, systemPrompt: string, summary: string, description: string
): Promise<any> {
  return callAI(provider, apiKey, systemPrompt, `Тема: ${summary}\n\nОписание: ${description}`, 0);
}

// ---- Stage 2: Independent reviewer (no strict schema, just analyse) ----
async function callIndependentReviewer(
  provider: string, apiKey: string, summary: string, description: string
): Promise<string> {
  const reviewPrompt = `Ты — независимый аналитик заявок логистической компании Spark. Прочитай заявку из Jira и определи:
1. Что КОНКРЕТНО просит клиент? Перечисли все действия своими словами.
2. Какие номера накладных упоминаются? (формат KXT..., SP..., SLQ...)
3. Какие данные клиент предоставил (телефоны, адреса, суммы, города)?
4. Есть ли что-то неоднозначное или подозрительное в заявке?

ВАЖНЫЙ КОНТЕКСТ:
- "Внести сумму на каспи" = установить сумму оплаты за перевозку способом Kaspi. Это СТАНДАРТНАЯ операция, НЕ требует никаких дополнительных деталей (номер счёта и т.п.).
- "Внести сумму наличку" = установить сумму оплаты за перевозку наличными. Тоже СТАНДАРТНАЯ операция.
- Каспи (Kaspi) — это способ оплаты (payment_method), а НЕ банковский счёт. Не нужны детали "на какой счёт".
- Не путай "внести сумму" (cash_sum — оплата за перевозку) с "НП/наложка" (cod_payment — наложенный платёж).
- "Убрать НП" = обнулить cod_payment. НЕ МЕНЯТЬ payment_type, payment_method, cash_sum!
- Если заявка содержит НЕСКОЛЬКО накладных с РАЗНЫМИ суммами — каждая должна быть отдельным действием.

Отвечай кратко, по пунктам. НЕ форматируй как JSON. Просто анализ.`;

  return callAI(provider, apiKey, reviewPrompt, `Тема: ${summary}\n\nОписание: ${description}`, 0.2);
}

// ---- Stage 3: Comparator — decides if actions are correct ----
async function callComparator(
  provider: string, apiKey: string, parserResult: string, reviewerAnalysis: string, summary: string, description: string
): Promise<{ approved: boolean; corrected_actions?: any; reason: string }> {
  const comparatorPrompt = `Ты — финальный арбитр. Твоя задача — сравнить результат парсера (JSON) с независимым анализом заявки и решить, правильно ли парсер определил действия.

ПРАВИЛА:
1. Сравни действия парсера с анализом рецензента.
2. Проверь: совпадают ли действия? Правильные ли накладные? Верны ли данные (телефоны, адреса, суммы)?
3. Если всё совпадает и ты УВЕРЕН — верни approved: true.
4. Если есть расхождения или ошибки — верни approved: false и объясни причину.
5. Если можешь исправить — верни corrected_actions с правильным JSON.

ВАЖНО: Будь консервативен при ОПАСНЫХ действиях (отмена заказа). Но для СТАНДАРТНЫХ операций (внести сумму, сменить адрес, сменить оплату) — если парсер правильно определил действие, накладную и данные — ОДОБРЯЙ.

НЕ ОТКЛОНЯЙ заявки по следующим причинам:
- "не указан счёт Каспи" — Каспи это просто способ оплаты (payment_method=2), счёт не нужен
- "не указаны детали оплаты" — если есть накладная + сумма + способ, этого ДОСТАТОЧНО
- "неоднозначность" без реальной проблемы — если рецензент сам распознал то же действие

КРИТИЧЕСКИ ВАЖНО ДЛЯ НП (наложный платёж / наложка):
- Если заявка про "убрать НП" / "снять наложку" / "добавить НП" — парсер ПРАВИЛЬНО ставит cod_payment и null в остальных полях payment.
- НЕ ИЗМЕНЯЙ payment_type, payment_method, cash_sum в corrected_actions если речь только про НП!
- НЕ ВЫДУМЫВАЙ значения типа "remove_cod" — используй ТОЛЬКО числа (1,2,3,4) или null!
- Если парсер вернул cod_payment=0 и остальное null — это ПРАВИЛЬНО для "убрать НП". ОДОБРЯЙ!

КРИТИЧЕСКИ ВАЖНО — ПРОВЕРКА СУММ:
- Если НП (cod_payment) уже есть у заказа и заявка НЕ просит его менять — НЕ обнуляй cod_payment!
- Если заявка просит только "внести сумму" — это cash_sum, НЕ трогай cod_payment!

Формат ответа — СТРОГО JSON:
{
  "approved": true/false,
  "reason": "краткое объяснение решения",
  "corrected_actions": null или исправленный массив actions (только если approved=false и ты можешь исправить)
}

ВЕРНИ ТОЛЬКО JSON.`;

  const content = await callAI(
    provider, apiKey, comparatorPrompt,
    `ОРИГИНАЛЬНАЯ ЗАЯВКА:\nТема: ${summary}\nОписание: ${description}\n\nРЕЗУЛЬТАТ ПАРСЕРА (JSON):\n${parserResult}\n\nНЕЗАВИСИМЫЙ АНАЛИЗ:\n${reviewerAnalysis}`,
    0
  );

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
  return aiResult;
}

// ---- Phone validation ----
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

// ---- Post-processing: validate and clean AI output ----
function postProcessActions(aiResult: any) {
  if (!aiResult.actions) return;

  for (const action of aiResult.actions) {
    // 1. Strip "Казахстан" from city fields — it's a country, not a city
    if (action.address?.city && action.address.city.toLowerCase().replace(/\s/g, "") === "казахстан") {
      console.log(`[${VERSION}] Post-process: stripped "Казахстан" from address.city`);
      action.address.city = null;
    }
    if (action.city && action.city.toLowerCase().replace(/\s/g, "") === "казахстан") {
      console.log(`[${VERSION}] Post-process: stripped "Казахстан" from action.city`);
      action.city = null;
    }
    // Strip from full_address prefix
    if (action.address?.full_address) {
      action.address.full_address = action.address.full_address.replace(/^Казахстан,?\s*/i, "");
    }

    // 2. Validate payment data consistency
    if (action.action === "update_payment" && action.payment) {
      const p = action.payment;
      
      // If cod_payment is explicitly set and other fields are null — this is a cod-only change, leave as is
      const isCodOnly = (p.cod_payment !== null && p.cod_payment !== undefined) &&
        p.payment_type === null && p.payment_method === null && p.cash_sum === null;
      
      if (isCodOnly) {
        console.log(`[${VERSION}] Post-process: COD-only payment change detected for ${action.invoices?.join(", ")}`);
      }

      // Validate payment_type values (only 1, 2 or null allowed)
      if (p.payment_type !== null && p.payment_type !== undefined && ![1, 2].includes(Number(p.payment_type))) {
        console.log(`[${VERSION}] Post-process: invalid payment_type "${p.payment_type}" → null`);
        p.payment_type = null;
      }

      // Validate payment_method values (only 1, 2, 3, 4 or null allowed)
      if (p.payment_method !== null && p.payment_method !== undefined && ![1, 2, 3, 4].includes(Number(p.payment_method))) {
        console.log(`[${VERSION}] Post-process: invalid payment_method "${p.payment_method}" → null`);
        p.payment_method = null;
      }

      // Validate cod_payment is numeric
      if (p.cod_payment !== null && p.cod_payment !== undefined && isNaN(Number(p.cod_payment))) {
        console.log(`[${VERSION}] Post-process: invalid cod_payment "${p.cod_payment}" → null`);
        p.cod_payment = null;
      }
    }

    // 3. Validate invoices format
    if (action.invoices) {
      const validInvoicePattern = /^(?:KXT|SP|SLQ)\d{6,12}$/i;
      const valid = action.invoices.filter((inv: string) => validInvoicePattern.test(inv));
      const invalid = action.invoices.filter((inv: string) => !validInvoicePattern.test(inv));
      if (invalid.length > 0) {
        console.log(`[${VERSION}] Post-process: removed invalid invoices: ${invalid.join(", ")}`);
        action.invoices = valid;
      }
    }

    // 4. Validate FTL order IDs (4-5 digits)
    if (action.action === "change_act_number" && action.ftl_order_ids) {
      const valid = action.ftl_order_ids.filter((id: string) => /^\d{4,5}$/.test(String(id)));
      const invalid = action.ftl_order_ids.filter((id: string) => !/^\d{4,5}$/.test(String(id)));
      if (invalid.length > 0) {
        console.log(`[${VERSION}] Post-process: removed invalid FTL IDs: ${invalid.join(", ")}`);
        action.ftl_order_ids = valid;
      }
    }

    // 5. Normalize phone numbers in all nested objects
    if (action.receiver?.phone) {
      action.receiver.phone = normalizePhone(action.receiver.phone);
    }
    if (action.receiver?.additional_phone) {
      action.receiver.additional_phone = normalizePhone(action.receiver.additional_phone);
    }
    if (action.sender?.phone) {
      action.sender.phone = normalizePhone(action.sender.phone);
    }
  }

  // Remove actions with empty invoices (except change_act_number which uses ftl_order_ids)
  aiResult.actions = aiResult.actions.filter((a: any) => {
    if (a.action === "change_act_number") {
      return a.ftl_order_ids && a.ftl_order_ids.length > 0;
    }
    if (a.invoices && a.invoices.length === 0) {
      console.log(`[${VERSION}] Post-process: removed action "${a.action}" with no valid invoices`);
      return false;
    }
    return true;
  });
}

// ---- Main export: 3-stage AI pipeline ----
export async function parseWithAI(
  settings: Record<string, string>, summary: string, description: string,
  supabase: any, taskId: string
) {
  const { provider, apiKey } = resolveProvider(settings);
  console.log(`[${VERSION}] Using AI provider: ${provider}`);

  const customPrompt = settings.ai_system_prompt;
  const systemPrompt = (customPrompt && customPrompt.trim().length > 50) ? customPrompt : getBuiltInPrompt();

  // === STAGE 1: Strict parser ===
  console.log(`[${VERSION}] Stage 1: Strict parser for task ${taskId}`);
  const parserContent = await callStrictParser(provider, apiKey, systemPrompt, summary, description);
  const parserResult = parseAIContent(parserContent);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "ai_parse", step: "stage1_parser",
    request_data: { summary, description, provider },
    response_data: { raw: parserContent, parsed: parserResult }, success: true,
  });

  // If no actions found, skip stages 2-3
  if (!parserResult.actions || parserResult.actions.length === 0) {
    console.log(`[${VERSION}] Stage 1: No actions found, skipping verification`);
    return parserResult;
  }

  // === STAGE 2: Independent reviewer ===
  console.log(`[${VERSION}] Stage 2: Independent reviewer for task ${taskId}`);
  const reviewerAnalysis = await callIndependentReviewer(provider, apiKey, summary, description);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "ai_parse", step: "stage2_reviewer",
    request_data: { summary, description, provider },
    response_data: { analysis: reviewerAnalysis }, success: true,
  });

  // === STAGE 3: Comparator ===
  console.log(`[${VERSION}] Stage 3: Comparator for task ${taskId}`);
  const comparatorResult = await callComparator(provider, apiKey, parserContent, reviewerAnalysis, summary, description);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "ai_parse", step: "stage3_comparator",
    request_data: { parser_result: parserContent, reviewer_analysis: reviewerAnalysis, provider },
    response_data: comparatorResult, success: true,
  });

  let finalResult: any;

  if (comparatorResult.approved) {
    console.log(`[${VERSION}] Stage 3: APPROVED — ${comparatorResult.reason}`);
    finalResult = parserResult;
  } else if (comparatorResult.corrected_actions) {
    console.log(`[${VERSION}] Stage 3: CORRECTED — ${comparatorResult.reason}`);
    finalResult = { actions: comparatorResult.corrected_actions };
  } else {
    console.log(`[${VERSION}] Stage 3: REJECTED — ${comparatorResult.reason}`);
    finalResult = { actions: [], rejected: true, reject_reason: comparatorResult.reason };
  }

  // Phone validation on final result
  validatePhones(finalResult, summary, description);

  // Post-processing: validate all fields, strip invalid values
  postProcessActions(finalResult);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "ai_parse", step: "final_result",
    request_data: { summary, description, provider },
    response_data: finalResult, success: true,
  });

  return finalResult;
}

// ---- Built-in prompt (extracted for reuse) ----
function getBuiltInPrompt(): string {
  return `Ты — строгий парсер заявок из Jira Service Desk. 

ТВОЯ ЗАДАЧА — определить ВСЕ действия, которые клиент просит выполнить в одной заявке. Заявка может содержать НЕСКОЛЬКО действий одновременно.

Поддерживаемые действия:
1. ОТМЕНА ЗАКАЗА (action: "cancel") — клиент ЯВНО просит ОТМЕНИТЬ заказ/накладную (слова: "отменить", "отмена заказа", "аннулировать", "удалить заявку", "удалить заказ", "удалить накладную")
2. СМЕНА АДРЕСА ДОСТАВКИ (action: "update_receiver") — клиент просит изменить адрес доставки (только ПОЛУЧАТЕЛЯ!)
3. СМЕНА ДАННЫХ ПОЛУЧАТЕЛЯ (action: "update_receiver") — клиент просит изменить ФИО и/или телефон ПОЛУЧАТЕЛЯ, а также ДОБАВИТЬ ДОП.НОМЕР
4. СМЕНА ОПЛАТЫ (action: "update_payment") — клиент просит изменить способ или тип оплаты, ВНЕСТИ СУММУ, или убрать/добавить НАЛОЖНЫЙ ПЛАТЕЖ (НП/наложку)
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
      "payment": {"payment_type": 2, "payment_method": 4, "cash_sum": null, "cod_payment": null}
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
      "payment": {"payment_type": 1, "payment_method": 4, "cash_sum": 100, "cod_payment": null}
    }
  ]
}

Пример ВНЕСТИ СУММУ НА КАСПИЙ (несколько накладных с разными суммами):
Текст: "SP00489715 прошу внести сумму на каспий 3656 тг\\nSP00490201 26607 тг\\nSP00493407 29766 тг"
{
  "actions": [
    {"action": "update_payment", "invoices": ["SP00489715"], "payment": {"payment_type": null, "payment_method": 2, "cash_sum": 3656, "cod_payment": null}},
    {"action": "update_payment", "invoices": ["SP00490201"], "payment": {"payment_type": null, "payment_method": 2, "cash_sum": 26607, "cod_payment": null}},
    {"action": "update_payment", "invoices": ["SP00493407"], "payment": {"payment_type": null, "payment_method": 2, "cash_sum": 29766, "cod_payment": null}}
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
- ftl_order_ids: массив ID ФТЛ заказов. КАЖДЫЙ ID должен быть 4-5 цифр.
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
- payment_type: 1 = оплата отправителем, 2 = оплата получателем. Если не указано или не меняется — ставь null.
- payment_method: 4 = наличка/наличные, 2 = каспий/kaspi/безнал/платежи. Если не указано или не меняется — ставь null.
- cash_sum: ТОЛЬКО если сумма ЯВНО указана. Иначе null.
- cod_payment: ТОЛЬКО если речь про НП/наложку. Иначе null.
- Если у каждой накладной СВОЯ сумма — создай ОТДЕЛЬНЫЙ update_payment для каждой!

КРИТИЧЕСКИ ВАЖНО — ПРАВИЛО: НЕ МЕНЯЛ = null:
Любое поле в payment, которое заявка НЕ просит изменить — должно быть null!
Это значит: НЕ ставь 0 для cod_payment если не просят убрать НП, НЕ ставь payment_type если не просят сменить плательщика.
Только ЯВНО запрошенные изменения получают значения, все остальное — null.

КРИТИЧЕСКИ ВАЖНО — "ВНЕСТИ СУММУ" / "НАЛИЧКА" / "КАСПИ" (БЕЗ упоминания НП):
Когда пишут "внести сумму", "внести сумму наличку", "внести сумму на каспи", "сумма за перевозку" и НЕТ слов "НП"/"наложка"/"наложный платеж" — это ОПЛАТА ЗА ПЕРЕВОЗКУ!
- "внести сумму на каспи 18932" → payment: {"cash_sum": 18932, "payment_method": 2, "payment_type": null, "cod_payment": null}
- "внести сумму наличку 5000" → payment: {"cash_sum": 5000, "payment_method": 4, "payment_type": null, "cod_payment": null}
- "внести сумму 10000" (без уточнения метода) → payment: {"cash_sum": 10000, "payment_method": null, "payment_type": null, "cod_payment": null}
НЕ ОТКЛОНЯЙ такие заявки! Это стандартная операция update_payment!

КРИТИЧЕСКИ ВАЖНО — НАЛОЖНЫЙ ПЛАТЕЖ (НП / наложка / cod_payment):
НП (наложный платёж) — это ОТДЕЛЬНОЕ поле cod_payment! Это НЕ payment_type, НЕ payment_method, НЕ cash_sum!
- "Убрать НП", "снять наложку", "убрать наложный платеж" → payment: {"cod_payment": 0, "payment_type": null, "payment_method": null, "cash_sum": null}
- "Добавить НП 5000", "наложка 5000" → payment: {"cod_payment": 5000, "payment_type": null, "payment_method": null, "cash_sum": null}
- Когда в заявке речь ТОЛЬКО про НП/наложку — НЕ ТРОГАЙ payment_type, payment_method и cash_sum! Ставь их в null!

ПРАВИЛА ДЛЯ ФТЛ ЗАКАЗОВ (4-5 значные номера):
- Если номер состоит из 4-5 цифр — это ФТЛ заказ.
- ФТЛ заказы поддерживают действия: change_act_number и cancel.
- Для остальных действий (update_receiver, update_payment, change_direction и т.д.) ФТЛ заказы НЕ поддерживаются.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА ПАРСИНГА:
1. "СМЕНА ДАННЫХ" в теме — это НЕ действие! Определяй действие ТОЛЬКО из описания.
2. ВСЕ НАКЛАДНЫЕ ИЗ ЗАЯВКИ = ОДНО ДЕЙСТВИЕ если указано одно действие.
3. НОМЕР НАКЛАДНОЙ может быть в теме или описании. Формат: буквы + цифры (KXT..., SP..., SLQ...).
4. Если НЕТ номера накладной НО есть действие — верни {"actions": [], "needs_invoice": true, "detected_action": "<название>"}.
5. Если НЕТ номера и нет действия — верни {"actions": []}.
6. Телефон: замени первую 8 на +7 (87773954884 → +77773954884).
7. ДОП.НОМЕР: Если 2 номера — первый в "phone", второй в "additional_phone".
8. ГОРОД: Если не указан явно — city: null.
9. full_address: без города → "ул. {улица}, {дом}". С городом → "г. {город}, ул. {улица}, {дом}". НЕ ДОБАВЛЯЙ "Казахстан" в full_address!

ВЕРНИ ТОЛЬКО JSON, без текста вокруг.`;
}
