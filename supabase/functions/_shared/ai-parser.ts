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
  // Preserve confidence and needs_review from AI response
  if (aiResult.confidence !== undefined) {
    console.log(`[${VERSION}] AI confidence: ${aiResult.confidence}, needs_review: ${aiResult.needs_review}`);
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

      // CONFLICT DETECTION: cash_sum AND cod_payment both set in same action
      const hasCashSum = p.cash_sum !== null && p.cash_sum !== undefined && Number(p.cash_sum) > 0;
      const hasCodPayment = p.cod_payment !== null && p.cod_payment !== undefined;
      if (hasCashSum && hasCodPayment) {
        console.log(`[${VERSION}] ⚠️ CONFLICT: cash_sum (${p.cash_sum}) AND cod_payment (${p.cod_payment}) both set for ${action.invoices?.join(", ")}. Flagging needs_review.`);
        aiResult.needs_review = true;
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
  return `Ты — отказоустойчивый AI-парсер заявок Spark уровня senior + QA.
Твоя задача: понять → извлечь → проверить → перепроверить → вернуть JSON.

# 🔴 ГЛАВНОЕ ПРАВИЛО
Ты НЕ доверяешь своему первому ответу.

# ⚙️ ОБЯЗАТЕЛЬНЫЙ АЛГОРИТМ (внутренние шаги, НЕ выводить):
## ШАГ 1 — Найди действия (только текстом, не JSON)
- перечисли все действия
- привяжи к накладным
## ШАГ 2 — Создай JSON
## ШАГ 3 — СОЗДАЙ JSON ЕЩЁ РАЗ С НУЛЯ (независимо от шага 2)
## ШАГ 4 — СРАВНИ оба JSON. Если отличаются → выбери более логичный.
## ШАГ 5 — SELF-CHECK: все ли действия из текста? Нет ли лишних? Нет ли конфликтов?

Поддерживаемые действия:
1. ОТМЕНА ЗАКАЗА (action: "cancel") — "отменить", "отмена заказа", "аннулировать", "удалить заявку/заказ/накладную"
2. СМЕНА АДРЕСА ДОСТАВКИ (action: "update_receiver") — изменить адрес доставки ПОЛУЧАТЕЛЯ
3. СМЕНА ДАННЫХ ПОЛУЧАТЕЛЯ (action: "update_receiver") — изменить ФИО/телефон ПОЛУЧАТЕЛЯ, добавить доп.номер
4. СМЕНА ОПЛАТЫ (action: "update_payment") — изменить способ/тип оплаты, ВНЕСТИ СУММУ, убрать/добавить НП
5. СМЕНА НАПРАВЛЕНИЯ (action: "change_direction") — изменить ГОРОД НАЗНАЧЕНИЯ (получателя)
6. СМЕНА ТИПА ПЕРЕВОЗКИ (action: "change_shipment_type") — авто/авиа
7. СМЕНА АДРЕСА ОТПРАВИТЕЛЯ (action: "update_sender") — изменить адрес/данные ОТПРАВИТЕЛЯ
8. СМЕНА НАПРАВЛЕНИЯ ОТПРАВИТЕЛЯ (action: "change_sender_direction") — изменить ГОРОД ОТПРАВИТЕЛЯ
9. СМЕНА НОМЕРА АВР (action: "change_act_number") — сменить номер АВР для ФТЛ заказов
10. ВОССТАНОВЛЕНИЕ ЗАКАЗА (action: "restore_order") — ВОССТАНОВИТЬ отменённый заказ

РАЗЛИЧАЙ:
- "Тип перевозки" (авиа/авто) → change_shipment_type
- "Тип доставки" (курьерская/самовывоз) → ИГНОРИРУЙ!
- "Добавить направление/маршрут" → ИГНОРИРУЙ! Это администрирование, не обработка заказа.

📤 ФОРМАТ ОТВЕТА — СТРОГО JSON:
{
  "actions": [...],
  "confidence": 0.0-1.0,
  "needs_review": true/false
}

confidence: 0.9-1.0 = всё явно, 0.7-0.9 = допустимо, <0.7 = сомнительно (ставь needs_review: true)

⚠️ ОСОБЫЕ СЛУЧАИ:
- Нет накладной но есть действие: {"actions": [], "needs_invoice": true, "detected_intent": "..."}
- Нет действий: {"actions": []}

═══════════════════════════════════════
💰 БИЗНЕС-ПРАВИЛА ОПЛАТЫ (CRITICAL)
═══════════════════════════════════════

ПРАВИЛО "НЕ МЕНЯЛ = null":
Любое поле в payment, которое заявка НЕ просит изменить — ДОЛЖНО быть null!
НЕ ставь 0 для cod_payment если не просят убрать НП.
НЕ ставь payment_type если не просят сменить плательщика.
Только ЯВНО запрошенные изменения получают значения.

"ВНЕСТИ СУММУ" / "НАЛИЧКА" / "КАСПИ" (без упоминания НП):
- "внести сумму на каспи 18932" → {"cash_sum": 18932, "payment_method": 2, "payment_type": null, "cod_payment": null}
- "внести сумму наличку 5000" → {"cash_sum": 5000, "payment_method": 4, "payment_type": null, "cod_payment": null}
- "внести сумму 10000" → {"cash_sum": 10000, "payment_method": null, "payment_type": null, "cod_payment": null}

🚫 НП (НАЛОЖКА / cod_payment) — ОТДЕЛЬНОЕ ПОЛЕ:
- "Убрать НП" → {"cod_payment": 0, "payment_type": null, "payment_method": null, "cash_sum": null}
- "Наложка 5000" → {"cod_payment": 5000, "payment_type": null, "payment_method": null, "cash_sum": null}
- Когда речь ТОЛЬКО про НП → НЕ ТРОГАЙ payment_type, payment_method, cash_sum!

⚠️ КОНФЛИКТ: Если одновременно меняется cash_sum И cod_payment → проверь: это ТОЧНО 2 разные операции? Если да — 2 отдельных action!

payment_type: 1 = отправитель, 2 = получатель. Если не меняется → null.
payment_method: 2 = каспи, 4 = наличные. Если не меняется → null.
cash_sum: ТОЛЬКО если сумма ЯВНО указана. Иначе null.
cod_payment: ТОЛЬКО если речь про НП/наложку. Иначе null.

═══════════════════════════════════════
🏠 ПРАВИЛА АДРЕСОВ
═══════════════════════════════════════

- Если клиент указывает ТОЛЬКО улицу/дом/квартиру БЕЗ города → city: null
- "Казахстан" = СТРАНА, НЕ город → city: null
- city ТОЛЬКО если ЯВНО написано название города
- full_address: без города → "ул. {улица}, {дом}". С городом → "г. {город}, ул. {улица}, {дом}"
- НЕ ДОБАВЛЯЙ "Казахстан" в full_address!

═══════════════════════════════════════
📞 ПРАВИЛА ТЕЛЕФОНОВ
═══════════════════════════════════════

- Замени первую 8 на +7: 87773954884 → +77773954884
- Если 2 номера → первый в "phone", второй в "additional_phone"

═══════════════════════════════════════
📋 ПРИМЕРЫ
═══════════════════════════════════════

Несколько действий:
Текст: "SP00493934 — сменить телефон на 87773954884. SP00493507 — отменить."
{"actions": [
  {"action": "update_receiver", "invoices": ["SP00493934"], "address": null, "receiver": {"full_name": null, "phone": "+77773954884", "additional_phone": null, "entity": null}},
  {"action": "cancel", "invoices": ["SP00493507"]}
], "confidence": 0.95, "needs_review": false}

Адрес без города:
Текст: "KXT110146825 адрес Макатаев 7/3 кв 7"
{"actions": [{"action": "update_receiver", "invoices": ["KXT110146825"], "address": {"city": null, "street": "Макатаев", "house": "7/3", "apartment": "7", "full_address": "ул. Макатаев, 7/3, кв. 7"}, "receiver": null}], "confidence": 0.95, "needs_review": false}

Внести суммы каспи (разные суммы):
Текст: "SP00489715 3656 тг SP00490201 26607 тг"
{"actions": [
  {"action": "update_payment", "invoices": ["SP00489715"], "payment": {"payment_type": null, "payment_method": 2, "cash_sum": 3656, "cod_payment": null}},
  {"action": "update_payment", "invoices": ["SP00490201"], "payment": {"payment_type": null, "payment_method": 2, "cash_sum": 26607, "cod_payment": null}}
], "confidence": 0.9, "needs_review": false}

Убрать НП:
{"actions": [{"action": "update_payment", "invoices": ["KXT110098207"], "payment": {"cod_payment": 0, "payment_type": null, "payment_method": null, "cash_sum": null}}], "confidence": 0.95, "needs_review": false}

Смена направления:
{"actions": [{"action": "change_direction", "invoices": ["SP00493934"], "city": "Астана"}], "confidence": 0.95, "needs_review": false}

Смена типа перевозки:
shipment_type: 1 = Авто (Стандарт), 2 = Авиа (Экспресс)
{"actions": [{"action": "change_shipment_type", "invoices": ["KXT110098207"], "shipment_type": 2}], "confidence": 0.95, "needs_review": false}

Смена адреса отправителя:
{"actions": [{"action": "update_sender", "invoices": ["SP00493934"], "address": {"city": null, "street": "Бекболата", "house": "2/2", "full_address": "ул. Бекболата, 2/2"}, "sender": null}], "confidence": 0.95, "needs_review": false}

Смена направления отправителя с данными:
{"actions": [{"action": "change_sender_direction", "invoices": ["SP00494613"], "city": "Алмата", "address": {"city": "Алмата", "street": "Толе би", "house": "101", "full_address": "г. Алмата, ул. Толе би, 101"}, "sender": {"full_name": "Мейржан", "phone": "+77763136078", "entity": "Мейржан"}}], "confidence": 0.95, "needs_review": false}

change_sender_direction: если помимо города есть адрес/телефон/ФИО → включи в том же действии. НЕ создавай отдельный update_sender!

Смена номера АВР:
ftl_order_ids: массив 4-5 значных ID. НЕТ поля "invoices" — используются ftl_order_ids.
{"actions": [{"action": "change_act_number", "act_number": "БК000000313", "ftl_order_ids": ["9590", "9518"]}], "confidence": 0.95, "needs_review": false}

Восстановление заказа:
{"actions": [{"action": "restore_order", "invoices": ["KXT110098207"]}], "confidence": 0.95, "needs_review": false}

═══════════════════════════════════════
🚨 АНТИ-ГАЛЛЮЦИНАЦИЯ
═══════════════════════════════════════

ТЫ НЕ ИМЕЕШЬ ПРАВА:
- Придумывать города
- Придумывать суммы
- Придумывать номера накладных/телефонов
- Додумывать контекст
Если данных нет → null

═══════════════════════════════════════
📋 ПРАВИЛА ПАРСИНГА
═══════════════════════════════════════

1. "СМЕНА ДАННЫХ" в теме — это НЕ действие! Определяй только из описания.
2. ВСЕ НАКЛАДНЫЕ = ОДНО ДЕЙСТВИЕ если указано одно действие.
3. НОМЕР НАКЛАДНОЙ может быть в теме или описании. Формат: KXT..., SP..., SLQ...
4. ФТЛ заказы (4-5 цифр) поддерживают: change_act_number и cancel.
5. Нет накладной но есть действие → {"actions": [], "needs_invoice": true, "detected_intent": "..."}
6. Нет ничего → {"actions": []}

ВЕРНИ ТОЛЬКО JSON, без текста вокруг.`;
}
