import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const VERSION = "v2.2.0";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Normalize phone: 8XXXXXXXXXX → +7XXXXXXXXXX, also handle 7XXXXXXXXXX → +7XXXXXXXXXX
function normalizePhone(phone: string): string {
  if (!phone) return phone;
  const digits = phone.replace(/[^\d+]/g, "");
  // 87771234567 → +77771234567
  if (/^8\d{10}$/.test(digits)) return `+7${digits.slice(1)}`;
  // 77771234567 → +77771234567
  if (/^7\d{10}$/.test(digits)) return `+${digits}`;
  // already +7...
  if (/^\+7\d{10}$/.test(digits)) return digits;
  return phone;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  console.log(`[${VERSION}] Request received at ${new Date().toISOString()}`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: cronRun } = await supabase
    .from("cron_runs")
    .insert({ status: "running" })
    .select()
    .single();

  try {
    const { data: settingsData } = await supabase.from("settings").select("*");
    const settings: Record<string, string> = {};
    settingsData?.forEach((s: any) => (settings[s.key] = s.value));

    const dryRun = settings.dry_run === "true";
    const aiEnabled = settings.ai_enabled === "true";

    if (!settings.jira_base_url || !settings.jira_email || !settings.jira_api_token) {
      throw new Error("Jira settings not configured");
    }

    const jql = settings.jira_queue_jql || "project = SH AND status = Open";
    const jiraAuth = btoa(`${settings.jira_email}:${settings.jira_api_token}`);

    const jiraResponse = await fetch(
      `${settings.jira_base_url}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=20&fields=summary,description,status`,
      {
        headers: {
          Authorization: `Basic ${jiraAuth}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!jiraResponse.ok) {
      const errText = await jiraResponse.text();
      throw new Error(`Jira API error ${jiraResponse.status}: ${errText}`);
    }

    const jiraData = await jiraResponse.json();
    console.log(`[${VERSION}] Jira response keys: ${Object.keys(jiraData).join(', ')}`);
    const issues = jiraData.issues || [];
    console.log(`[${VERSION}] Found ${issues.length} issues`);

    await supabase
      .from("cron_runs")
      .update({ tasks_found: issues.length })
      .eq("id", cronRun?.id);

    let processedCount = 0;

    for (const issue of issues) {
      const issueKey = issue.key;

      const { data: existing } = await supabase
        .from("processed_tasks")
        .select("id, status, retry_count")
        .eq("jira_issue_key", issueKey)
        .single();

      if (existing && (existing.status === "completed" || existing.status === "ignored" || existing.status === "processing" || existing.retry_count >= 2)) {
        console.log(`[${VERSION}] Skipping ${issueKey}: status=${existing.status}, retry_count=${existing.retry_count}`);
        continue;
      }

      const summary = issue.fields?.summary || "";
      // Parse ADF (Atlassian Document Format) recursively
      const extractTextFromADF = (node: any): string => {
        if (!node) return "";
        if (typeof node === "string") return node;
        if (node.type === "text") return node.text || "";
        if (node.content && Array.isArray(node.content)) {
          return node.content.map(extractTextFromADF).join("");
        }
        return "";
      };
      const descriptionField = issue.fields?.description;
      const description = typeof descriptionField === "string"
        ? descriptionField
        : descriptionField?.content
          ? descriptionField.content.map((block: any) => extractTextFromADF(block)).filter(Boolean).join("\n")
          : "";
      console.log(`[${VERSION}] Issue ${issueKey}: summary="${summary}", description="${description}", raw_desc_type=${typeof descriptionField}`);

      let taskId: string;
      if (existing) {
        taskId = existing.id;
        await supabase
          .from("processed_tasks")
          .update({
            status: "processing",
            retry_count: existing.retry_count + 1,
            jira_summary: summary,
            jira_description: description,
          })
          .eq("id", taskId);
      } else {
        const { data: newTask } = await supabase
          .from("processed_tasks")
          .insert({
            jira_issue_key: issueKey,
            jira_summary: summary,
            jira_description: description,
            status: "processing",
            dry_run: dryRun,
          })
          .select()
          .single();
        taskId = newTask!.id;
      }

      try {
        let aiResult: any = { actions: [] };

        if (aiEnabled) {
          aiResult = await parseWithAI(settings, summary, description, supabase, taskId);
        }

        // Store first action for backward compat in DB column
        const primaryAction = aiResult.actions?.[0]?.action || null;
        await supabase
          .from("processed_tasks")
          .update({ ai_response: aiResult, action: primaryAction })
          .eq("id", taskId);

        if (!aiResult.actions || aiResult.actions.length === 0) {
          await supabase
            .from("processed_tasks")
            .update({ status: "ignored", execution_result: { message: "Заявка не содержит поддерживаемых действий" } })
            .eq("id", taskId);
          processedCount++;
          continue;
        }

        // Execute all actions sequentially, collect all results and comment lines
        const allResults: any[] = [];
        const allCommentLines: string[] = [];
        let allSuccess = true;
        let anySuccess = false;

        for (const actionItem of aiResult.actions) {
          if (actionItem.action === "cancel") {
            const results = await executeCancelOrders(supabase, settings, actionItem.invoices || [], taskId, dryRun);
            allResults.push(...results);
            const ok = results.every((r: any) => r.success);
            if (!ok) allSuccess = false;
            if (results.some((r: any) => r.success)) anySuccess = true;
            results.forEach((r: any) => {
              allCommentLines.push(r.success ? `✅ ${r.invoice}: отменена` : `❌ ${r.invoice}: ${r.error}`);
            });

          } else if (actionItem.action === "update_receiver") {
            const results = await executeUpdateReceiver(supabase, settings, actionItem, taskId, dryRun);
            allResults.push(...results);
            const ok = results.every((r: any) => r.success);
            if (!ok) allSuccess = false;
            if (results.some((r: any) => r.success)) anySuccess = true;
            results.forEach((r: any) => {
              allCommentLines.push(r.success ? `✅ ${r.invoice}: данные получателя обновлены` : `❌ ${r.invoice}: ${r.error}`);
            });

          } else if (actionItem.action === "update_payment") {
            const results = await executeUpdatePayment(supabase, settings, actionItem, taskId, dryRun);
            allResults.push(...results);
            const ok = results.every((r: any) => r.success);
            if (!ok) allSuccess = false;
            if (results.some((r: any) => r.success)) anySuccess = true;
            results.forEach((r: any) => {
              allCommentLines.push(r.success ? `✅ ${r.invoice}: оплата обновлена` : `❌ ${r.invoice}: ${r.error}`);
            });
          }
        }

        const finalStatus = allSuccess ? "completed" : (anySuccess ? "completed" : "ignored");
        await supabase
          .from("processed_tasks")
          .update({ status: finalStatus, execution_result: allResults })
          .eq("id", taskId);

        // Post comment with all results
        if (anySuccess && allCommentLines.length > 0) {
          await addJiraComment(settings, jiraAuth, issueKey,
            `${dryRun ? "🔸 DRY-RUN\n" : ""}Результат обработки:\n${allCommentLines.join("\n")}`
          );
        }

        // Transition to Done (double-close)
        if (!dryRun && allSuccess) {
          await transitionJiraIssue(settings, jiraAuth, issueKey);
          await delay(3000);
          await transitionJiraIssue(settings, jiraAuth, issueKey);
        }

        processedCount++;
      } catch (taskError: any) {
        console.error(`Error processing ${issueKey}:`, taskError);
        await supabase
          .from("processed_tasks")
          .update({ status: "error", execution_result: { error: taskError.message } })
          .eq("id", taskId);
        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "process_error", step: "main_loop",
          success: false, error_message: taskError.message,
        });
      }
    }

    await supabase
      .from("cron_runs")
      .update({
        finished_at: new Date().toISOString(),
        tasks_processed: processedCount,
        status: "completed",
      })
      .eq("id", cronRun?.id);

    console.log(`[${VERSION}] Completed. Processed ${processedCount} tasks.`);
    return new Response(JSON.stringify({ success: true, processed: processedCount, _version: VERSION }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error(`[${VERSION}] Cron error:`, error);
    await supabase
      .from("cron_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error_message: error.message,
      })
      .eq("id", cronRun?.id);

    return new Response(JSON.stringify({ error: error.message, _version: VERSION }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ---- AI Parsing via OpenAI GPT-4o-mini ----

async function parseWithAI(
  settings: Record<string, string>, summary: string, description: string,
  supabase: any, taskId: string
) {
  const apiKey = settings.openai_api_key;
  if (!apiKey) throw new Error("OpenAI API Key not configured in settings");

  const systemPrompt = `Ты — строгий парсер заявок из Jira Service Desk. 

ТВОЯ ЗАДАЧА — определить ВСЕ действия, которые клиент просит выполнить в одной заявке. Заявка может содержать НЕСКОЛЬКО действий одновременно.

Поддерживаемые действия:
1. ОТМЕНА ЗАКАЗА (action: "cancel") — клиент ЯВНО просит ОТМЕНИТЬ заказ/накладную (слова: "отменить", "отмена заказа", "аннулировать")
2. СМЕНА АДРЕСА ДОСТАВКИ (action: "update_receiver") — клиент просит изменить адрес доставки (только ПОЛУЧАТЕЛЯ!)
3. СМЕНА ДАННЫХ ПОЛУЧАТЕЛЯ (action: "update_receiver") — клиент просит изменить ФИО и/или телефон ПОЛУЧАТЕЛЯ
4. СМЕНА ОПЛАТЫ (action: "update_payment") — клиент просит изменить тип оплаты

⚠️ КРИТИЧЕСКИ ВАЖНЫЕ ОГРАНИЧЕНИЯ ДЛЯ ОТМЕНЫ:
- "Убрать ДК" / "снять ДК" / "убрать доставку курьером" — это НЕ отмена заказа! Это запрос на изменение типа доставки. ИГНОРИРУЙ.
- "Убрать наложенный платеж" / "убрать НП" — это НЕ отмена. Это изменение оплаты.
- Отмена (action: "cancel") ТОЛЬКО если клиент ЯВНО пишет "отменить заказ", "отмена", "аннулировать накладную".
- Если есть ЛЮБОЕ сомнение — это НЕ отмена.

Заявки которые нужно ИГНОРИРОВАТЬ:
- "Убрать ДК", "снять ДК", "убрать доставку курьером" — НЕ отмена!
- Смена типа доставки (курьерская → самовывоз и т.д.)
- Смена адреса ЗАБОРА / данных ОТПРАВИТЕЛЯ
- Вопросы о статусе, жалобы, возвраты, запросы информации

ВАЖНО: Мы работаем ТОЛЬКО с получателем. Запросы про отправителя — ИГНОРИРУЙ.

ФОРМАТ ОТВЕТА — МАССИВ ДЕЙСТВИЙ:
Верни JSON с массивом "actions". Каждое действие — отдельный объект.
Если действий нет — верни {"actions": []}.

ПОРЯДОК ВЫПОЛНЕНИЯ ВАЖЕН: сначала обновления (update_receiver, update_payment), потом отмена (cancel).

Пример с НЕСКОЛЬКИМИ действиями (смена адреса + смена получателя + отмена):
{
  "actions": [
    {
      "action": "update_receiver",
      "invoices": ["SP00493934"],
      "address": {"city": null, "street": "Тайбурыл", "house": "23/1", "full_address": "ул. Тайбурыл, 23/1"},
      "receiver": {"full_name": "Мейржан", "phone": "+77777777777"}
    },
    {
      "action": "cancel",
      "invoices": ["SP00493934"]
    }
  ]
}

Пример с ОДНИМ действием (только отмена):
{
  "actions": [
    {
      "action": "cancel",
      "invoices": ["KXT110098207"]
    }
  ]
}

Пример СМЕНА АДРЕСА и/или ДАННЫХ ПОЛУЧАТЕЛЯ:
{
  "actions": [
    {
      "action": "update_receiver",
      "invoices": ["KXT110098207"],
      "address": {"city": "Алматы", "street": "Алтын Алма", "house": "151", "full_address": "Казахстан, г. Алматы, ул. Алтын Алма, 151"},
      "receiver": {"full_name": "ИВАНОВ ИВАН", "phone": "+77001234567"}
    }
  ]
}

Пример СМЕНА ОПЛАТЫ:
{
  "actions": [
    {
      "action": "update_payment",
      "invoices": ["KXT110098207"],
      "payment": {"payment_type": 2, "payment_method": 4, "cash_sum": null}
    }
  ]
}

Правила для payment:
- payment_type: 1 = оплата отправителем, 2 = оплата получателем. Если не указано — ставь 2.
- payment_method: 4 = наличка, 2 = платежи/безнал.
- cash_sum: ТОЛЬКО если сумма ЯВНО указана. Иначе null.

Важные правила:
- НОМЕР НАКЛАДНОЙ может быть в теме (summary) или в описании. ОБЯЗАТЕЛЬНО извлеки его. Формат: буквы + цифры (KXT110098207, SP00493507...).
- Если НЕТ номера накладной — верни {"actions": []}.
- Если просят сменить ТОЛЬКО ФИО/телефон — НЕ включай "address", только "receiver".
- Если просят сменить ТОЛЬКО адрес — НЕ включай "receiver", только "address".
- Если просят и адрес, и ФИО/телефон — включи оба в ОДНОМ update_receiver.
- Телефон КОПИРУЙ ТОЧНО. Только замени первую 8 на +7 (87773954884 → +77773954884).
- ГОРОД: Если не указан явно — city: null. НЕ УГАДЫВАЙ из названия улицы.
- full_address: без города → "ул. {улица}, {дом}". С городом → "Казахстан, г. {город}, ул. {улица}, {дом}".
- street и house — разделяй правильно. "С312 11" → street: "С312", house: "11".

ВЕРНИ ТОЛЬКО JSON, без текста вокруг.`;

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
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
  // Support both old format {"action": ...} and new format {"actions": [...]}
  let aiResult: any = { actions: [] };
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.actions && Array.isArray(parsed.actions)) {
      aiResult = parsed;
    } else if (parsed.action) {
      // Legacy single-action format → convert to multi-action
      aiResult = { actions: [parsed] };
    }
  }

  // Post-AI phone validation: extract phone from original text and compare
  if (aiResult.receiver?.phone) {
    const fullText = `${summary} ${description}`;
    // Find phone numbers in original text (8XXXXXXXXXX or +7XXXXXXXXXX or 7XXXXXXXXXX)
    const phoneMatches = fullText.match(/(?:\+?[78])\d{10}/g);
    if (phoneMatches && phoneMatches.length > 0) {
      const originalPhone = normalizePhone(phoneMatches[0]);
      const aiPhone = normalizePhone(aiResult.receiver.phone);
      if (aiPhone !== originalPhone) {
        console.log(`[${VERSION}] Phone mismatch! AI="${aiPhone}", original="${originalPhone}". Using original.`);
        aiResult.receiver.phone = originalPhone;
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

// ---- Jira Helpers ----

async function addJiraComment(settings: Record<string, string>, auth: string, issueKey: string, body: string) {
  try {
    const baseUrl = settings.jira_base_url.replace(/\/+$/, "");
    const resp = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        body: {
          type: "doc", version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
        },
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[${VERSION}] Failed to add Jira comment: ${resp.status} - ${errText}`);
    } else {
      console.log(`[${VERSION}] Comment added to ${issueKey}`);
    }
  } catch (e) {
    console.error(`[${VERSION}] Failed to add Jira comment:`, e);
  }
}

async function transitionJiraIssue(settings: Record<string, string>, auth: string, issueKey: string) {
  try {
    const baseUrl = settings.jira_base_url.replace(/\/+$/, "");
    const url = `${baseUrl}/rest/api/3/issue/${issueKey}/transitions`;
    console.log(`[${VERSION}] Getting transitions for ${issueKey}: ${url}`);
    
    const transResp = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    
    if (!transResp.ok) {
      const errText = await transResp.text();
      console.error(`[${VERSION}] Failed to get transitions: ${transResp.status} - ${errText}`);
      return;
    }
    
    const transData = await transResp.json();
    console.log(`[${VERSION}] Available transitions for ${issueKey}:`, JSON.stringify(transData.transitions?.map((t: any) => ({ id: t.id, name: t.name }))));
    
    const doneTransition = transData.transitions?.find(
      (t: any) => {
        const name = t.name.toLowerCase();
        return name.includes("done") || name.includes("готово") || name.includes("закрыт") || name.includes("выполнен") || name.includes("resolved");
      }
    );
    
    if (doneTransition) {
      console.log(`[${VERSION}] Transitioning ${issueKey} to "${doneTransition.name}" (id: ${doneTransition.id})`);
      const postResp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ transition: { id: doneTransition.id } }),
      });
      if (!postResp.ok) {
        const errText = await postResp.text();
        console.error(`[${VERSION}] Transition POST failed: ${postResp.status} - ${errText}`);
      } else {
        console.log(`[${VERSION}] Transition successful for ${issueKey}`);
      }
    } else {
      console.error(`[${VERSION}] No "done" transition found for ${issueKey}. Available: ${JSON.stringify(transData.transitions?.map((t: any) => t.name))}`);
    }
  } catch (e) {
    console.error(`[${VERSION}] Failed to transition Jira issue ${issueKey}:`, e);
  }
}

// ---- Cancel Orders ----

async function executeCancelOrders(
  supabase: any, settings: Record<string, string>, invoices: string[], taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;

  for (const invoice of invoices) {
    try {
      const searchResp = await fetch(
        `${sparkUrl}/admin/logistics-info?page=1&limit=50&search=${encodeURIComponent(invoice)}`,
        { headers: { Authorization: `Bearer ${sparkToken}` } }
      );
      if (!searchResp.ok) throw new Error(`Search failed: ${searchResp.status}`);
      const searchData = await searchResp.json();
      const items = searchData.data || searchData.items || searchData || [];
      const item = Array.isArray(items) ? items[0] : items;
      if (!item?.id) throw new Error("Invoice not found");

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "cancel", step: "search_invoice",
        request_data: { invoice },
        response_data: { id: item.id, status: item.status }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, spark_id: item.id });
        continue;
      }

      const cancelResp = await fetch(
        `${sparkUrl}/logistics-info/${item.id}/cancel`,
        { method: "POST", headers: { Authorization: `Bearer ${sparkToken}` } }
      );
      if (!cancelResp.ok) throw new Error(`Cancel failed: ${cancelResp.status}`);

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "cancel", step: "cancel_invoice",
        request_data: { id: item.id },
        response_data: { status: cancelResp.status }, success: true,
      });
      results.push({ invoice, success: true, spark_id: item.id });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "cancel", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}

// ---- Update Receiver (address + name + phone) ----

async function executeUpdateReceiver(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  const newAddress = aiResult.address; // may be undefined
  const newReceiver = aiResult.receiver; // may be undefined

  for (const invoice of invoices) {
    try {
      // 1. Search for invoice to get logistics-info ID
      const searchResp = await fetch(
        `${sparkUrl}/admin/logistics-info?page=1&limit=50&search=${encodeURIComponent(invoice)}`,
        { headers: { Authorization: `Bearer ${sparkToken}` } }
      );
      if (!searchResp.ok) throw new Error(`Search logistics-info failed: ${searchResp.status}`);
      const searchData = await searchResp.json();
      const items = searchData.data || searchData.items || searchData || [];
      const item = Array.isArray(items) ? items[0] : items;
      if (!item?.id) throw new Error("Invoice not found");

      // 2. GET full logistics-info by ID for complete receiver data
      const fullResp = await fetch(
        `${sparkUrl}/logistics-info/${item.id}`,
        {
          headers: {
            Authorization: `Bearer ${sparkToken}`,
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; spark-bot/1.0)",
          },
        }
      );
      if (!fullResp.ok) {
        const errBody = await fullResp.text().catch(() => "");
        throw new Error(`GET logistics-info/${item.id} failed: ${fullResp.status} - ${errBody}`);
      }
      const fullData = await fullResp.json();
      // The receiver data is nested in the response
      const logisticsInfo = fullData.data || fullData;
      const receiver = logisticsInfo.receiver || logisticsInfo;
      if (!receiver?.id) throw new Error("Receiver not found in full logistics-info");

      const receiverCity = receiver.city?.name || receiver.city || "";
      console.log(`[${VERSION}] Full receiver: id=${receiver.id}, city="${receiverCity}", title="${receiver.title}", phone="${receiver.phone}"`);

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_receiver", step: "get_full_logistics_info",
        request_data: { invoice, logistics_info_id: item.id },
        response_data: { receiver_id: receiver.id, city: receiverCity, title: receiver.title, full_name: receiver.full_name, phone: receiver.phone, city_id: receiver.city_id, latitude: receiver.latitude, longitude: receiver.longitude },
        success: true,
      });

      // 3. Build update payload — always include all required fields
      const updatePayload: any = {
        title: receiver.title,
        full_name: receiver.full_name,
        phone: receiver.phone,
        city_id: typeof receiver.city_id === 'number' ? receiver.city_id : Number(receiver.city_id),
        latitude: receiver.latitude ? Number(receiver.latitude) : receiver.latitude,
        longitude: receiver.longitude ? Number(receiver.longitude) : receiver.longitude,
        street: receiver.street,
        house: receiver.house,
        full_address: receiver.full_address,
      };

      const beforeState: any = {};
      const afterState: any = {};

      // 4. Handle address change if requested
      if (newAddress) {
        // If AI didn't determine city, use current receiver's city
        const requestedCity = newAddress.city || null;
        const effectiveCity = requestedCity || receiverCity;

        if (requestedCity && receiverCity &&
          requestedCity.toLowerCase() !== receiverCity.toLowerCase()) {
          const error = `Город не совпадает: запрос="${requestedCity}" vs заказ="${receiverCity}". Обновление отклонено.`;
          await supabase.from("execution_logs").insert({
            task_id: taskId, action: "update_receiver", step: "city_check",
            success: false, error_message: error,
          });
          results.push({ invoice, success: false, error });
          continue;
        }

        // Geocoding via Yandex — use effective city for geocoding
        const yandexApiKey = settings.yandex_geocoder_api_key;
        if (!yandexApiKey) throw new Error("Yandex Geocoder API key not configured");

        const geoQuery = `${effectiveCity}, ${newAddress.street} ${newAddress.house}`;
        const geoResp = await fetch(
          `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(geoQuery)}`,
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; spark-bot/1.0)",
              "Authorization": `Bearer ${sparkToken}`,
            },
          }
        );
        const geoData = await geoResp.json();
        const geoMember = geoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
        const pos = geoMember?.Point?.pos;
        let latitude: number | null = null;
        let longitude: number | null = null;
        if (pos) {
          const [lon, lat] = pos.split(" ").map(Number);
          latitude = lat;
          longitude = lon;
        }

        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "update_receiver", step: "geocoding_yandex",
          request_data: { query: geoQuery },
          response_data: geoMember ? { pos, formatted: geoMember.metaDataProperty?.GeocoderMetaData?.text } : { error: "No results" },
          success: !!geoMember,
        });

        beforeState.street = receiver.street;
        beforeState.house = receiver.house;
        beforeState.full_address = receiver.full_address;

        updatePayload.latitude = latitude !== null ? String(latitude) : updatePayload.latitude;
        updatePayload.longitude = longitude !== null ? String(longitude) : updatePayload.longitude;
        updatePayload.street = newAddress.street;
        updatePayload.house = newAddress.house;
        updatePayload.full_address = newAddress.full_address;
        updatePayload.street = newAddress.street;
        updatePayload.house = newAddress.house;
        updatePayload.full_address = newAddress.full_address;

        afterState.street = newAddress.street;
        afterState.house = newAddress.house;
        afterState.full_address = newAddress.full_address;
      }

      // 5. Handle name/phone change if requested
      if (newReceiver) {
        if (newReceiver.full_name) {
          beforeState.full_name = receiver.full_name;
          updatePayload.full_name = newReceiver.full_name;
          // Also update title to match full_name (required field)
          updatePayload.title = newReceiver.full_name;
          afterState.full_name = newReceiver.full_name;
        }
        if (newReceiver.phone) {
          beforeState.phone = receiver.phone;
          const normalizedPhone = normalizePhone(newReceiver.phone);
          updatePayload.phone = normalizedPhone;
          afterState.phone = normalizedPhone;
          console.log(`[${VERSION}] Phone normalized: "${newReceiver.phone}" → "${normalizedPhone}"`);
        }
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_receiver", step: "before_after",
        request_data: { before: beforeState },
        response_data: { after: afterState, payload_keys: Object.keys(updatePayload) }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, before: beforeState, after: afterState });
        continue;
      }

      // 6. Single PUT request with full receiver data + changes
      console.log(`[${VERSION}] PUT /receivers/${receiver.id} payload:`, JSON.stringify(updatePayload));
      const updateResp = await fetch(`${sparkUrl}/receivers/${receiver.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${sparkToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        console.error(`[${VERSION}] Update receiver failed: ${updateResp.status}, body: ${errBody}`);
        throw new Error(`Update receiver failed: ${updateResp.status} - ${errBody}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_receiver", step: "update_receiver_api",
        request_data: { receiver_id: receiver.id, payload_keys: Object.keys(afterState) },
        response_data: { status: updateResp.status }, success: true,
      });

      results.push({ invoice, success: true, changes: afterState });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_receiver", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}

// ---- Update Payment (payment_type, payment_method, cash_sum) ----

async function executeUpdatePayment(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  const paymentData = aiResult.payment || {};

  for (const invoice of invoices) {
    try {
      // 1. Search for invoice
      const searchResp = await fetch(
        `${sparkUrl}/admin/logistics-info?page=1&limit=50&search=${encodeURIComponent(invoice)}`,
        { headers: { Authorization: `Bearer ${sparkToken}` } }
      );
      if (!searchResp.ok) throw new Error(`Search failed: ${searchResp.status}`);
      const searchData = await searchResp.json();
      const items = searchData.data || searchData.items || searchData || [];
      const item = Array.isArray(items) ? items[0] : items;
      if (!item?.id) throw new Error("Invoice not found");

      // 2. GET full logistics-info to get current data
      const fullResp = await fetch(
        `${sparkUrl}/logistics-info/${item.id}`,
        {
          headers: {
            Authorization: `Bearer ${sparkToken}`,
            "Accept": "application/json",
          },
        }
      );
      if (!fullResp.ok) throw new Error(`GET logistics-info/${item.id} failed: ${fullResp.status}`);
      const fullData = await fullResp.json();
      const logisticsInfo = fullData.data || fullData;

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_payment", step: "get_logistics_info",
        request_data: { invoice, logistics_info_id: item.id },
        response_data: {
          current_payment_type: logisticsInfo.payment_type,
          current_payment_method: logisticsInfo.payment_method,
          current_cash_sum: logisticsInfo.cash_sum,
        },
        success: true,
      });

      // 3. Build PUT payload from existing data, override only payment fields
      const updatePayload: any = {
        additional_service: logisticsInfo.additional_service || { hasCar: false, hasSoftPackage: false, hasRisingToTheFloor: false, hasManipulator: false, hasCrane: false, hasHydraulicTrolley: false, hasGrid: false, hasLoader: false, hasPallet: false },
        product_name: logisticsInfo.product_name || "-",
        dop_invoice_number: logisticsInfo.dop_invoice_number || null,
        annotation: logisticsInfo.annotation || null,
        cod_payment: Number(logisticsInfo.cod_payment) || 0,
        declared_price: Number(logisticsInfo.declared_price) || 0,
        take_date: logisticsInfo.take_date || new Date().toISOString().split("T")[0],
        period_id: Number(logisticsInfo.period_id) || 3,
        places: Number(logisticsInfo.places) || 1,
        weight: Number(logisticsInfo.weight) || 0,
        width: Number(logisticsInfo.width) || 0,
        height: Number(logisticsInfo.height) || 0,
        depth: Number(logisticsInfo.depth) || 0,
        volume: Number(logisticsInfo.volume) || 0,
        cargo_name: logisticsInfo.cargo_name || null,
        should_return_document: Number(logisticsInfo.should_return_document) || 0,
        shipment_type: Number(logisticsInfo.shipment_type) || 1,
        payment_type: Number(paymentData.payment_type ?? logisticsInfo.payment_type ?? 2),
        payment_method: Number(paymentData.payment_method ?? logisticsInfo.payment_method ?? 4),
        verify: logisticsInfo.verify || null,
        is_dangerous: Number(logisticsInfo.is_dangerous) || 0,
        temperature_regime_type_id: logisticsInfo.temperature_regime_type_id || null,
        invoice_files: logisticsInfo.invoice_files || [],
        certificate_of_safety_files: logisticsInfo.certificate_of_safety_files || [],
        temperature_regime_safety_files: logisticsInfo.temperature_regime_safety_files || [],
      };

      // Only add cash_sum if explicitly set
      if (paymentData.cash_sum !== null && paymentData.cash_sum !== undefined) {
        updatePayload.cash_sum = paymentData.cash_sum;
      } else {
        updatePayload.cash_sum = logisticsInfo.cash_sum || 0;
      }

      const beforeState = {
        payment_type: logisticsInfo.payment_type,
        payment_method: logisticsInfo.payment_method,
        cash_sum: logisticsInfo.cash_sum,
      };
      const afterState = {
        payment_type: updatePayload.payment_type,
        payment_method: updatePayload.payment_method,
        cash_sum: updatePayload.cash_sum,
      };

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_payment", step: "before_after",
        request_data: { before: beforeState },
        response_data: { after: afterState }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, before: beforeState, after: afterState });
        continue;
      }

      // 4. PUT to logistics-info/{id}
      console.log(`[${VERSION}] PUT /logistics-info/${item.id} payment update:`, JSON.stringify(afterState));
      const updateResp = await fetch(`${sparkUrl}/logistics-info/${item.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${sparkToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        throw new Error(`Update payment failed: ${updateResp.status} - ${errBody}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_payment", step: "update_payment_api",
        request_data: { logistics_info_id: item.id },
        response_data: { status: updateResp.status, changes: afterState }, success: true,
      });

      results.push({ invoice, success: true, changes: afterState });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_payment", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}
