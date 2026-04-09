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
2. Какие номера накладных упоминаются? (формат KXT..., SP..., SLQ..., AR..., а также 15-значные цифровые баркоды)
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

ВАЖНО: Отмена заказа — это СТАНДАРТНАЯ операция если клиент ЯВНО просит отменить и указана накладная. ОДОБРЯЙ отмену если парсер и рецензент оба видят запрос на отмену.
НЕ ОТКЛОНЯЙ отмену "на всякий случай" или из-за "опасности" — клиент знает что просит.

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

    // 3. Validate invoices format (prefixed like KXT/SP/SLQ/AR + 12-15 digit barcodes)
    if (action.invoices) {
      const validInvoicePattern = /^(?:(?:KXT|SP|SLQ|AR)\d{6,12}|\d{12,15})$/i;
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
  const basePrompt = getBuiltInPrompt();
  const systemPrompt = (customPrompt && customPrompt.trim().length > 10)
    ? `${basePrompt}\n\n# 📌 ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:\n${customPrompt.trim()}`
    : basePrompt;

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

# 🚫 АНТИ-ГАЛЛЮЦИНАЦИЯ
ЗАПРЕЩЕНО:
- придумывать данные (города, суммы, номера, телефоны)
- додумывать контекст
- интерпретировать неоднозначно
Если не уверен → null

# 📋 ПРАВИЛО: НЕ МЕНЯЛ = null
Любое поле, которое заявка НЕ просит изменить — ДОЛЖНО быть null!

# 📊 CONFIDENCE (ФОРМУЛА)
Начни с 1.0:
-0.2 если нет накладной
-0.2 если неоднозначность
-0.2 если несколько действий
-0.3 если конфликт
Если confidence < 0.7 → needs_review: true

# 🚨 HARD REJECT
Если нет накладной или конфликт данных:
{"actions": [], "rejected": true, "detected_intent": "..."}

# 🔴 ОБЯЗАТЕЛЬНЫЕ ПОЛЯ В КАЖДОМ ACTION:
- Каждый action (кроме change_act_number) ОБЯЗАН содержать массив "invoices" с номерами накладных!
- Каждый update_receiver ОБЯЗАН содержать "address" и/или "receiver" с данными!
- Каждый update_payment ОБЯЗАН содержать "payment" с данными!
- НИКОГДА не возвращай action без данных — это бесполезно!
- Если не можешь извлечь данные → верни actions: []

═══════════════════════════════════════
Поддерживаемые действия:
═══════════════════════════════════════
1. ОТМЕНА ЗАКАЗА (action: "cancel") — "отменить", "отмена заказа", "аннулировать"
2. СМЕНА АДРЕСА ДОСТАВКИ (action: "update_receiver") — изменить адрес доставки ПОЛУЧАТЕЛЯ
3. СМЕНА ДАННЫХ ПОЛУЧАТЕЛЯ (action: "update_receiver") — изменить ФИО/телефон ПОЛУЧАТЕЛЯ, "добавить доп номер получателя", "изменить контактный номер"
4. СМЕНА ОПЛАТЫ (action: "update_payment") — изменить способ/тип оплаты, ВНЕСТИ СУММУ, убрать/добавить НП
5. СМЕНА НАПРАВЛЕНИЯ (action: "change_direction") — изменить ГОРОД НАЗНАЧЕНИЯ
6. СМЕНА ТИПА ПЕРЕВОЗКИ (action: "change_shipment_type") — авто/авиа
7. СМЕНА АДРЕСА ОТПРАВИТЕЛЯ (action: "update_sender") — изменить адрес/данные ОТПРАВИТЕЛЯ
8. СМЕНА НАПРАВЛЕНИЯ ОТПРАВИТЕЛЯ (action: "change_sender_direction") — изменить ГОРОД ОТПРАВИТЕЛЯ
9. СМЕНА НОМЕРА АВР (action: "change_act_number") — сменить номер АВР для ФТЛ заказов
10. ВОССТАНОВЛЕНИЕ ЗАКАЗА (action: "restore_order") — ВОССТАНОВИТЬ отменённый заказ
11. САМОПРИВОЗ (action: "self_delivery") — клиент сам привозит груз на склад ОТПРАВИТЕЛЯ. Ключевые фразы: "самопривоз", "забор со склада", "привезёт на склад", "самозавоз"
12. САМОВЫВОЗ (action: "self_pickup") — клиент сам забирает груз со склада ПОЛУЧАТЕЛЯ. Ключевые фразы: "самовывоз", "выдача на складе", "заберёт со склада", "получение на складе"

🚨 КРИТИЧНО — self_delivery и self_pickup:
- self_delivery УЖЕ ВКЛЮЧАЕТ смену склада и адреса ОТПРАВИТЕЛЯ. НЕ СОЗДАВАЙ отдельные update_sender или update_receiver!
- self_pickup УЖЕ ВКЛЮЧАЕТ смену склада и адреса ПОЛУЧАТЕЛЯ. НЕ СОЗДАВАЙ отдельные update_receiver или update_sender!
- Если клиент пишет "самопривоз и изменить адрес на склад X" — это ОДНО действие self_delivery, НЕ два!
- Если клиент пишет "самовывоз и адрес склада Y" — это ОДНО действие self_pickup, НЕ два!
- НИКОГДА не комбинируй self_delivery + update_receiver или self_pickup + update_sender для одной накладной!

РАЗЛИЧАЙ:
- "Тип перевозки" (авиа/авто) → change_shipment_type
- "Добавить направление/маршрут" / "Создать направление" → ИГНОРИРУЙ!
- "Закрыть ДК" / "Удалить ДК" / "Закрыть доставочный квиток" → ИГНОРИРУЙ!
- "Верификация" → ИГНОРИРУЙ!
- "Филиал доставки сделать {город}" = change_direction на этот город!
- "Самопривоз" / "привезёт сам" → self_delivery (склад ОТПРАВИТЕЛЯ) — БЕЗ отдельного update_receiver!
- "Самовывоз" / "заберёт сам" / "получение на складе" → self_pickup (склад ПОЛУЧАТЕЛЯ) — БЕЗ отдельного update_sender!

⚠️ ВАЖНО: Если заявка содержит СМЕШАННЫЕ запросы (поддерживаемое + неподдерживаемое действие):
→ ИЗВЛЕКИ только поддерживаемые действия!
→ НЕ игнорируй всю заявку из-за неподдерживаемой части!

═══════════════════════════════════════
💰 БИЗНЕС-ПРАВИЛА ОПЛАТЫ (CRITICAL)
═══════════════════════════════════════

## ОПЛАТА:
- "внести сумму на каспи 18932" → {"cash_sum": 18932, "payment_method": 2, "payment_type": null, "cod_payment": null}
- "внести сумму наличку 5000" → {"cash_sum": 5000, "payment_method": 4, "payment_type": null, "cod_payment": null}
- "внести сумму 10000" → {"cash_sum": 10000, "payment_method": null, "payment_type": null, "cod_payment": null}

## НП (наложка / cod_payment):
- "Убрать НП" → {"cod_payment": 0, "payment_type": null, "payment_method": null, "cash_sum": null}
- "Наложка 5000" → {"cod_payment": 5000, "payment_type": null, "payment_method": null, "cash_sum": null}
- Когда речь ТОЛЬКО про НП → НЕ ТРОГАЙ payment_type, payment_method, cash_sum!

## ⚠️ КОНФЛИКТ:
Если cash_sum И cod_payment одновременно — НЕ исправляй, пометь needs_review: true

payment_type: 1 = отправитель, 2 = получатель. Если не меняется → null.
payment_method: 2 = каспи, 4 = наличные. Если не меняется → null.

═══════════════════════════════════════
🏠 ПРАВИЛА АДРЕСОВ
═══════════════════════════════════════
- city ТОЛЬКО если ЯВНО написано название города
- "Казахстан" = СТРАНА, НЕ город → city: null
- НЕ ДОБАВЛЯЙ "Казахстан" в full_address!
- full_address: без города → "ул. {улица}, {дом}". С городом → "г. {город}, ул. {улица}, {дом}"

═══════════════════════════════════════
📞 ПРАВИЛА ТЕЛЕФОНОВ
═══════════════════════════════════════
- 8XXXXXXXXXX → +7XXXXXXXXXX
- Если 2 номера → первый в "phone", второй в "additional_phone"

═══════════════════════════════════════
📌 EDGE CASES
═══════════════════════════════════════
- разные суммы → разные actions
- одна сумма + несколько накладных → один action с массивом invoices
- дубликаты накладных → удалять
- "СМЕНА ДАННЫХ" в теме — НЕ действие! Определяй из описания.
- ФТЛ заказы (4-5 цифр): change_act_number и cancel.
- Накладные: KXT, SP, SLQ, AR (все валидные префиксы!)
- 12-15 значные ЦИФРОВЫЕ коды (баркоды/трекинг) — тоже ВАЛИДНЫЕ номера накладных! Пример: "301547806472000", "351033155160000"

═══════════════════════════════════════
📋 ПРИМЕРЫ
═══════════════════════════════════════

Смена направления с адресом (несколько накладных с РАЗНЫМИ адресами → РАЗНЫЕ actions!):
Текст: "SP00516123 на Алматы-Актау 27 мкр, зд 85/1. SP00516116 на Алматы-Актау мкр. 12, 80"
{"actions": [
  {"action": "change_direction", "invoices": ["SP00516123"], "city": "Актау"},
  {"action": "update_receiver", "invoices": ["SP00516123"], "address": {"city": "Актау", "street": "27 мкр", "house": "85/1", "full_address": "г. Актау, 27 мкр, зд 85/1"}, "receiver": null},
  {"action": "change_direction", "invoices": ["SP00516116"], "city": "Актау"},
  {"action": "update_receiver", "invoices": ["SP00516116"], "address": {"city": "Актау", "street": "мкр. 12", "house": "80", "full_address": "г. Актау, мкр. 12, 80"}, "receiver": null}
], "confidence": 0.8, "needs_review": false}

Смена направления на тот же город (Алматы→Алматы):
Текст: "SP00505527 прошу поменять направление на Алматы-Алматы"
{"actions": [{"action": "change_direction", "invoices": ["SP00505527"], "city": "Алматы", "from_city": "Алматы", "to_city": "Алматы"}], "confidence": 0.9, "needs_review": false}

AR-накладные (ВАЛИДНЫЙ формат!):
Текст: "AR99986307 и AR99986273 сменить направление на Алматы-Калбатау"
{"actions": [{"action": "change_direction", "invoices": ["AR99986307", "AR99986273"], "city": "Калбатау", "from_city": "Алматы", "to_city": "Калбатау"}], "confidence": 0.9, "needs_review": false}

Несколько действий:
Текст: "SP00493934 — сменить телефон на 87773954884. SP00493507 — отменить."
{"actions": [
  {"action": "update_receiver", "invoices": ["SP00493934"], "address": null, "receiver": {"full_name": null, "phone": "+77773954884", "additional_phone": null, "entity": null}},
  {"action": "cancel", "invoices": ["SP00493507"]}
], "confidence": 0.8, "needs_review": false}

Адрес без города:
{"actions": [{"action": "update_receiver", "invoices": ["KXT110146825"], "address": {"city": null, "street": "Макатаев", "house": "7/3", "apartment": "7", "full_address": "ул. Макатаев, 7/3, кв. 7"}, "receiver": null}], "confidence": 0.95, "needs_review": false}

Внести суммы каспи (разные суммы — РАЗНЫЕ actions):
{"actions": [
  {"action": "update_payment", "invoices": ["SP00489715"], "payment": {"payment_type": null, "payment_method": 2, "cash_sum": 3656, "cod_payment": null}},
  {"action": "update_payment", "invoices": ["SP00490201"], "payment": {"payment_type": null, "payment_method": 2, "cash_sum": 26607, "cod_payment": null}}
], "confidence": 0.8, "needs_review": false}

Убрать НП:
{"actions": [{"action": "update_payment", "invoices": ["KXT110098207"], "payment": {"cod_payment": 0, "payment_type": null, "payment_method": null, "cash_sum": null}}], "confidence": 0.95, "needs_review": false}

Смена направления:
{"actions": [{"action": "change_direction", "invoices": ["SP00493934"], "city": "Астана"}], "confidence": 0.95, "needs_review": false}

Смена типа перевозки (1=Авто, 2=Авиа):
{"actions": [{"action": "change_shipment_type", "invoices": ["KXT110098207"], "shipment_type": 2}], "confidence": 0.95, "needs_review": false}

Смена адреса отправителя:
{"actions": [{"action": "update_sender", "invoices": ["SP00493934"], "address": {"city": null, "street": "Бекболата", "house": "2/2", "full_address": "ул. Бекболата, 2/2"}, "sender": null}], "confidence": 0.95, "needs_review": false}

change_sender_direction с данными (НЕ создавай отдельный update_sender!):
{"actions": [{"action": "change_sender_direction", "invoices": ["SP00494613"], "city": "Алмата", "address": {"city": "Алмата", "street": "Толе би", "house": "101", "full_address": "г. Алмата, ул. Толе би, 101"}, "sender": {"full_name": "Мейржан", "phone": "+77763136078", "entity": "Мейржан"}}], "confidence": 0.95, "needs_review": false}

Смена номера АВР (ftl_order_ids, НЕ invoices):
{"actions": [{"action": "change_act_number", "act_number": "БК000000313", "ftl_order_ids": ["9590", "9518"]}], "confidence": 0.95, "needs_review": false}

Восстановление заказа:
{"actions": [{"action": "restore_order", "invoices": ["KXT110098207"]}], "confidence": 0.95, "needs_review": false}

Добавить доп номер получателя:
Текст: "SLQ0204260248 добавить доп номер получателя +7 777 001 0685"
{"actions": [{"action": "update_receiver", "invoices": ["SLQ0204260248"], "address": null, "receiver": {"full_name": null, "phone": null, "additional_phone": "+77770010685", "entity": null}}], "confidence": 0.95, "needs_review": false}

Смена направления с новым адресом (2 действия):
Текст: "SP00516751 поменять направление с Алматы на Павлодар, ул. Якова Геринга, дом 13, кв. 78"
{"actions": [
  {"action": "change_direction", "invoices": ["SP00516751"], "city": "Павлодар"},
  {"action": "update_receiver", "invoices": ["SP00516751"], "address": {"city": "Павлодар", "street": "Якова Геринга", "house": "13", "apartment": "78", "full_address": "г. Павлодар, ул. Якова Геринга, 13, кв. 78"}, "receiver": null}
], "confidence": 0.8, "needs_review": false}

Самопривоз (клиент привезёт груз на склад отправителя):
Текст: "SP00520001 самопривоз"
{"actions": [{"action": "self_delivery", "invoices": ["SP00520001"]}], "confidence": 0.95, "needs_review": false}

Самовывоз (клиент заберёт груз со склада получателя):
Текст: "KXT110150123 самовывоз"
{"actions": [{"action": "self_pickup", "invoices": ["KXT110150123"]}], "confidence": 0.95, "needs_review": false}

Самопривоз + самовывоз (оба вместе):
Текст: "SP00520002 самопривоз и самовывоз"
{"actions": [
  {"action": "self_delivery", "invoices": ["SP00520002"]},
  {"action": "self_pickup", "invoices": ["SP00520002"]}
], "confidence": 0.9, "needs_review": false}

═══════════════════════════════════════
📤 ФОРМАТ ОТВЕТА — СТРОГО JSON:
═══════════════════════════════════════
{
  "actions": [...],
  "confidence": 0.0-1.0,
  "needs_review": true/false
}

ВЕРНИ ТОЛЬКО JSON, без текста вокруг.`;
}
