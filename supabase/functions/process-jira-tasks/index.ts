import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const VERSION = "v2.8.0";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Normalize phone: 8XXXXXXXXXX → +7XXXXXXXXXX, also handle 7XXXXXXXXXX → +7XXXXXXXXXX
// Also fix AI hallucination: +777... (12 digits after +) → +7... (drop extra 7)
function normalizePhone(phone: string): string {
  if (!phone) return phone;
  let digits = phone.replace(/[^\d]/g, "");
  // Fix AI hallucination: 777028522828 (12 digits starting with 77) → 77028522828 (11 digits)
  if (digits.length === 12 && digits.startsWith("77")) {
    console.log(`[normalizePhone] Fixing AI hallucination: ${digits} → ${digits.slice(1)}`);
    digits = digits.slice(1);
  }
  // 87771234567 → +77771234567
  if (/^8\d{10}$/.test(digits)) return `+7${digits.slice(1)}`;
  // 77771234567 → +77771234567
  if (/^7\d{10}$/.test(digits)) return `+${digits}`;
  return `+${digits}`;
}

// Check if order was restored after cancellation by looking at order-statuses history
// Returns true if there's a status with code 233 ("Накладная восстановлена") AFTER the last cancellation
async function checkOrderRestored(invoiceNumber: string, sparkToken: string): Promise<boolean> {
  try {
    const historyResp = await fetch(
      `https://gateway.spark.kz/cabinet/api/order-statuses/${encodeURIComponent(invoiceNumber)}/history`,
      {
        headers: {
          Authorization: `Bearer ${sparkToken}`,
          "Accept": "application/json",
        },
      }
    );
    if (!historyResp.ok) {
      console.log(`[${VERSION}] order-statuses history failed for ${invoiceNumber}: ${historyResp.status}`);
      return false;
    }
    const historyData = await historyResp.json();
    console.log(`[${VERSION}] Order ${invoiceNumber} raw history sample:`, JSON.stringify(historyData).substring(0, 1500));
    const statuses = Array.isArray(historyData) ? historyData : (historyData.data || historyData.statuses || historyData.result || []);
    
    // Look for restoration status code 233
    const statusCodes = statuses.map((s: any) => ({ code: s.status?.code || s.status_code || s.code, name: s.status?.name || s.status_name || s.name }));
    console.log(`[${VERSION}] Order ${invoiceNumber} history codes:`, JSON.stringify(statusCodes).substring(0, 1000));
    const hasRestoration = statuses.some((s: any) => (s.status?.code === 233) || (s.status_code === 233) || (s.code === 233));
    console.log(`[${VERSION}] Order ${invoiceNumber} history: ${statuses.length} statuses, restored=${hasRestoration}`);
    return hasRestoration;
  } catch (e: any) {
    console.warn(`[${VERSION}] Failed to check order restoration for ${invoiceNumber}: ${e.message}`);
    return false;
  }
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

      // Allow "waiting_for_info" tasks to be reprocessed (check comments for invoice number)
      if (existing && (existing.status === "completed" || existing.status === "ignored" || existing.status === "processing" || (existing.status !== "waiting_for_info" && existing.retry_count >= 2))) {
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
        let combinedDescription = description;

        // If task is waiting_for_info, check Jira comments for invoice numbers
        if (existing?.status === "waiting_for_info") {
          console.log(`[${VERSION}] Task ${issueKey} is waiting_for_info — checking Jira comments for invoice number`);
          const commentsText = await fetchJiraComments(settings, jiraAuth, issueKey);
          // Look for invoice numbers in comments (exclude our own bot comments)
          const invoicePattern = /(?:KXT|SP|kxt|sp)\d{6,12}/gi;
          const commentInvoices = commentsText.match(invoicePattern);
          if (commentInvoices && commentInvoices.length > 0) {
            console.log(`[${VERSION}] Found invoice(s) in comments: ${commentInvoices.join(", ")}`);
            combinedDescription = `${description}\n\nИз комментариев: номера накладных: ${commentInvoices.join(", ")}`;
          } else {
            console.log(`[${VERSION}] No invoice numbers found in comments for ${issueKey} — still waiting`);
            await supabase
              .from("processed_tasks")
              .update({ status: "waiting_for_info", retry_count: (existing.retry_count || 0) + 1 })
              .eq("id", taskId);
            processedCount++;
            continue;
          }
        }

        if (aiEnabled) {
          aiResult = await parseWithAI(settings, summary, combinedDescription, supabase, taskId);
        }

        // Store first action for backward compat in DB column
        const primaryAction = aiResult.actions?.[0]?.action || null;
        await supabase
          .from("processed_tasks")
          .update({ ai_response: aiResult, action: primaryAction })
          .eq("id", taskId);

        if (!aiResult.actions || aiResult.actions.length === 0) {
          // Check if AI detected an action but no invoice (needs_invoice flag)
          if (aiResult.needs_invoice) {
            console.log(`[${VERSION}] Task ${issueKey}: action detected but no invoice — asking in Jira`);
            await addJiraComment(settings, jiraAuth, issueKey,
              `⚠️ Номер накладной не найден в текстовом формате. Пожалуйста, укажите номер накладной текстом в комментарии (например: SP00493934 или KXT110098207).`
            );
            await supabase
              .from("processed_tasks")
              .update({ status: "waiting_for_info", execution_result: { message: "Ожидание номера накладной — запрошено в комментарии" } })
              .eq("id", taskId);
            processedCount++;
            continue;
          }

          await supabase
            .from("processed_tasks")
            .update({ status: "ignored", execution_result: { message: "Заявка не содержит поддерживаемых действий" } })
            .eq("id", taskId);
          processedCount++;
          continue;
        }

        // Collect invoices that will be cancelled — skip updates for them
        const cancelledInvoices = new Set<string>();
        for (const actionItem of aiResult.actions) {
          if (actionItem.action === "cancel") {
            (actionItem.invoices || []).forEach((inv: string) => cancelledInvoices.add(inv));
          }
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
            // Skip update for invoices that will be cancelled in the same ticket
            const filteredInvoices = (actionItem.invoices || []).filter((inv: string) => !cancelledInvoices.has(inv));
            if (filteredInvoices.length === 0) {
              console.log(`[${VERSION}] Skipping update_receiver — all invoices will be cancelled`);
              allCommentLines.push(`ℹ️ Обновление получателя пропущено — заказ будет отменён`);
              anySuccess = true;
              continue;
            }
            const modifiedAction = { ...actionItem, invoices: filteredInvoices };
            const results = await executeUpdateReceiver(supabase, settings, modifiedAction, taskId, dryRun);
            allResults.push(...results);
            const ok = results.every((r: any) => r.success);
            if (!ok) allSuccess = false;
            if (results.some((r: any) => r.success)) anySuccess = true;
            results.forEach((r: any) => {
              allCommentLines.push(r.success ? `✅ ${r.invoice}: данные получателя обновлены` : `❌ ${r.invoice}: ${r.error}`);
            });

          } else if (actionItem.action === "update_payment") {
            // Skip update for invoices that will be cancelled
            const filteredInvoices = (actionItem.invoices || []).filter((inv: string) => !cancelledInvoices.has(inv));
            if (filteredInvoices.length === 0) {
              console.log(`[${VERSION}] Skipping update_payment — all invoices will be cancelled`);
              allCommentLines.push(`ℹ️ Смена оплаты пропущена — заказ будет отменён`);
              anySuccess = true;
              continue;
            }
            const modifiedAction = { ...actionItem, invoices: filteredInvoices };
            const results = await executeUpdatePayment(supabase, settings, modifiedAction, taskId, dryRun);
            allResults.push(...results);
            const ok = results.every((r: any) => r.success);
            if (!ok) allSuccess = false;
            if (results.some((r: any) => r.success)) anySuccess = true;
            results.forEach((r: any) => {
              allCommentLines.push(r.success ? `✅ ${r.invoice}: оплата обновлена` : `❌ ${r.invoice}: ${r.error}`);
            });
          } else if (actionItem.action === "change_direction") {
            const filteredInvoices = (actionItem.invoices || []).filter((inv: string) => !cancelledInvoices.has(inv));
            if (filteredInvoices.length === 0) {
              console.log(`[${VERSION}] Skipping change_direction — all invoices will be cancelled`);
              allCommentLines.push(`ℹ️ Смена направления пропущена — заказ будет отменён`);
              anySuccess = true;
              continue;
            }
            const modifiedAction = { ...actionItem, invoices: filteredInvoices };
            const results = await executeChangeDirection(supabase, settings, modifiedAction, taskId, dryRun);
            allResults.push(...results);
            const ok = results.every((r: any) => r.success);
            if (!ok) allSuccess = false;
            if (results.some((r: any) => r.success)) anySuccess = true;
            results.forEach((r: any) => {
              allCommentLines.push(r.success ? `✅ ${r.invoice}: направление изменено на ${r.city || actionItem.city}` : `❌ ${r.invoice}: ${r.error}`);
            });
          } else if (actionItem.action === "change_shipment_type") {
            const filteredInvoices = (actionItem.invoices || []).filter((inv: string) => !cancelledInvoices.has(inv));
            if (filteredInvoices.length === 0) {
              console.log(`[${VERSION}] Skipping change_shipment_type — all invoices will be cancelled`);
              allCommentLines.push(`ℹ️ Смена типа перевозки пропущена — заказ будет отменён`);
              anySuccess = true;
              continue;
            }
            const modifiedAction = { ...actionItem, invoices: filteredInvoices };
            const results = await executeChangeShipmentType(supabase, settings, modifiedAction, taskId, dryRun);
            allResults.push(...results);
            const ok = results.every((r: any) => r.success);
            if (!ok) allSuccess = false;
            if (results.some((r: any) => r.success)) anySuccess = true;
            const typeLabel = actionItem.shipment_type === 2 ? "Авиа (Экспресс)" : "Авто (Стандарт)";
            results.forEach((r: any) => {
              allCommentLines.push(r.success ? `✅ ${r.invoice}: тип перевозки изменён на ${typeLabel}` : `❌ ${r.invoice}: ${r.error}`);
            });
          } else if (actionItem.action === "update_sender") {
            const filteredInvoices = (actionItem.invoices || []).filter((inv: string) => !cancelledInvoices.has(inv));
            if (filteredInvoices.length === 0) {
              console.log(`[${VERSION}] Skipping update_sender — all invoices will be cancelled`);
              allCommentLines.push(`ℹ️ Обновление отправителя пропущено — заказ будет отменён`);
              anySuccess = true;
              continue;
            }
            const modifiedAction = { ...actionItem, invoices: filteredInvoices };
            const results = await executeUpdateSender(supabase, settings, modifiedAction, taskId, dryRun);
            allResults.push(...results);
            const ok = results.every((r: any) => r.success);
            if (!ok) allSuccess = false;
            if (results.some((r: any) => r.success)) anySuccess = true;
            results.forEach((r: any) => {
              allCommentLines.push(r.success ? `✅ ${r.invoice}: данные отправителя обновлены` : `❌ ${r.invoice}: ${r.error}`);
            });
          } else if (actionItem.action === "change_sender_direction") {
            const filteredInvoices = (actionItem.invoices || []).filter((inv: string) => !cancelledInvoices.has(inv));
            if (filteredInvoices.length === 0) {
              console.log(`[${VERSION}] Skipping change_sender_direction — all invoices will be cancelled`);
              allCommentLines.push(`ℹ️ Смена направления отправителя пропущена — заказ будет отменён`);
              anySuccess = true;
              continue;
            }
            const modifiedAction = { ...actionItem, invoices: filteredInvoices };
            const results = await executeChangeSenderDirection(supabase, settings, modifiedAction, taskId, dryRun);
            allResults.push(...results);
            const ok = results.every((r: any) => r.success);
            if (!ok) allSuccess = false;
            if (results.some((r: any) => r.success)) anySuccess = true;
            results.forEach((r: any) => {
              allCommentLines.push(r.success ? `✅ ${r.invoice}: направление отправителя изменено на ${r.city || actionItem.city}` : `❌ ${r.invoice}: ${r.error}`);
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
5. СМЕНА НАПРАВЛЕНИЯ (action: "change_direction") — клиент просит сменить город доставки / направление (слова: "сменить направление", "изменить город доставки", "перенаправить в город ...")
6. СМЕНА ТИПА ПЕРЕВОЗКИ (action: "change_shipment_type") — клиент просит сменить тип перевозки: "стандарт" / "авто" → shipment_type: 1, "экспресс" / "авиа" → shipment_type: 2
7. СМЕНА АДРЕСА/ДАННЫХ ОТПРАВИТЕЛЯ (action: "update_sender") — клиент просит изменить адрес, ФИО или телефон ОТПРАВИТЕЛЯ (слова: "изменить адрес отправителя", "сменить адрес забора", "изменить данные отправителя")
8. СМЕНА НАПРАВЛЕНИЯ ОТПРАВИТЕЛЯ (action: "change_sender_direction") — клиент просит сменить город ОТПРАВИТЕЛЯ / город забора (слова: "сменить город отправителя", "сменить город забора")

⚠️ КРИТИЧЕСКИ ВАЖНЫЕ ОГРАНИЧЕНИЯ ДЛЯ ОТМЕНЫ:
- "Убрать ДК" / "снять ДК" / "убрать доставку курьером" — это НЕ отмена заказа! Это запрос на изменение типа доставки. ИГНОРИРУЙ.
- "Убрать наложенный платеж" / "убрать НП" — это НЕ отмена. Это изменение оплаты.
- Отмена (action: "cancel") ТОЛЬКО если клиент ЯВНО пишет "отменить заказ", "отмена", "аннулировать накладную".
- Если есть ЛЮБОЕ сомнение — это НЕ отмена.

Заявки которые нужно ИГНОРИРОВАТЬ:
- "Убрать ДК", "снять ДК", "убрать доставку курьером" — НЕ отмена!
- Смена типа доставки (курьерская → самовывоз и т.д.)
- Вопросы о статусе, жалобы, возвраты, запросы информации

ВАЖНО: Мы работаем с получателем И отправителем. Различай запросы про отправителя (update_sender, change_sender_direction) и получателя (update_receiver, change_direction).

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
      "receiver": {"full_name": "Мейржан", "phone": "+77777777777", "entity": "Мейржан"}
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
      "receiver": {"full_name": "ИВАНОВ ИВАН", "phone": "+77001234567", "entity": "ИВАНОВ ИВАН"}
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

Пример СМЕНА НАПРАВЛЕНИЯ ОТПРАВИТЕЛЯ:
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

Правила для update_sender:
- Аналогично update_receiver, но для ОТПРАВИТЕЛЯ
- Слова "отправитель", "забор", "адрес забора", "данные отправителя" → update_sender
- Формат address и sender такой же как у update_receiver

Правила для change_sender_direction:
- Аналогично change_direction, но для ОТПРАВИТЕЛЯ
- Слова "город отправителя", "город забора", "сменить город отправки" → change_sender_direction

Правила для payment:
- payment_type: 1 = оплата отправителем, 2 = оплата получателем. Если не указано — ставь 2.
- payment_method: 4 = наличка, 2 = платежи/безнал.
- cash_sum: ТОЛЬКО если сумма ЯВНО указана. Иначе null.

Важные правила:
- НОМЕР НАКЛАДНОЙ может быть в теме (summary) или в описании. ОБЯЗАТЕЛЬНО извлеки его. Формат: буквы + цифры (KXT110098207, SP00493507...).
- Если НЕТ номера накладной НО есть действие (клиент описывает что хочет сделать) — верни {"actions": [], "needs_invoice": true, "detected_action": "<название_действия>"}.
- Если НЕТ номера накладной И нет действия — верни {"actions": []}.
- Если просят сменить ТОЛЬКО ФИО/телефон — НЕ включай "address", только "receiver".
- Если просят сменить ТОЛЬКО адрес — НЕ включай "receiver", только "address".
- Если просят и адрес, и ФИО/телефон — включи оба в ОДНОМ update_receiver.
- Поле "entity" — это название организации/компании (например "ТОО Клиника Хадиша", "ИП Рахмет"). Если в тексте упоминается название организации — ОБЯЗАТЕЛЬНО включи его в receiver/sender как "entity".
- При изменении данных получателя/отправителя — ВСЕГДА копируй entity из текста заявки. Если entity указан — ставь его И в full_name, И в entity.
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

async function fetchJiraComments(settings: Record<string, string>, auth: string, issueKey: string): Promise<string> {
  try {
    const baseUrl = settings.jira_base_url.replace(/\/+$/, "");
    const resp = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) {
      console.error(`[${VERSION}] Failed to fetch comments for ${issueKey}: ${resp.status}`);
      return "";
    }
    const data = await resp.json();
    const comments = data.comments || [];
    // Extract text from ADF comments, skip bot comments (containing ✅ or ❌ or ⚠️)
    const extractTextFromADF = (node: any): string => {
      if (!node) return "";
      if (typeof node === "string") return node;
      if (node.type === "text") return node.text || "";
      if (node.content && Array.isArray(node.content)) {
        return node.content.map(extractTextFromADF).join("");
      }
      return "";
    };
    const commentTexts: string[] = [];
    for (const comment of comments) {
      const body = comment.body;
      const text = typeof body === "string" ? body : (body?.content ? body.content.map(extractTextFromADF).join("\n") : "");
      // Skip our own bot comments
      if (text.includes("✅") || text.includes("❌") || text.includes("⚠️") || text.includes("Результат обработки")) continue;
      commentTexts.push(text);
    }
    const result = commentTexts.join("\n");
    console.log(`[${VERSION}] Fetched ${comments.length} comments for ${issueKey}, extracted ${commentTexts.length} non-bot texts (${result.length} chars)`);
    return result;
  } catch (e: any) {
    console.error(`[${VERSION}] Failed to fetch Jira comments:`, e);
    return "";
  }
}

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

      // Check if order is already cancelled (by status name only, not by status.id which is just a sequential ID)
      const orderStatus = item.status?.name || item.status || "";
      const orderStatusCode = item.status?.code || null;
      const isCancelledStatus = orderStatus.toLowerCase().includes("отмен") || orderStatus.toLowerCase().includes("cancel") || orderStatusCode === 503;
      
      if (isCancelledStatus) {
        // Check order-statuses history for restoration (code 233)
        const isRestored = await checkOrderRestored(invoice, sparkToken);
        if (!isRestored) {
          console.log(`[${VERSION}] Skipping update for ${invoice}: order already cancelled (status: ${orderStatus})`);
          results.push({ invoice, success: false, error: `Заказ уже отменён (статус: ${orderStatus})` });
          continue;
        }
        console.log(`[${VERSION}] Order ${invoice} was cancelled but RESTORED (code 233) — proceeding with update`);
      }

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
      const logisticsInfo = fullData.data || fullData;

      // Also check status from full logistics-info
      const fullStatus = logisticsInfo.status?.name || logisticsInfo.status || "";
      const isFullCancelled = fullStatus.toLowerCase().includes("отмен") || fullStatus.toLowerCase().includes("cancel");
      if (isFullCancelled && !isCancelledStatus) {
        // Only re-check if we didn't already check above
        const isRestored = await checkOrderRestored(invoice, sparkToken);
        if (!isRestored) {
          console.log(`[${VERSION}] Skipping update for ${invoice}: order cancelled (status: ${fullStatus})`);
          results.push({ invoice, success: false, error: `Заказ уже отменён (статус: ${fullStatus})` });
          continue;
        }
        console.log(`[${VERSION}] Order ${invoice} was cancelled but RESTORED (code 233) — proceeding`);
      }

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

      // 3. Build update payload — spread ALL existing receiver fields, then override
      const updatePayload: any = {
        title: receiver.title,
        entity: receiver.entity || receiver.title,
        full_name: receiver.full_name,
        phone: receiver.phone,
        additional_phone: receiver.additional_phone || null,
        city_id: typeof receiver.city_id === 'number' ? receiver.city_id : Number(receiver.city_id),
        latitude: receiver.latitude != null ? Number(receiver.latitude) : null,
        longitude: receiver.longitude != null ? Number(receiver.longitude) : null,
        street: receiver.street || "",
        house: receiver.house || "",
        full_address: receiver.full_address || "",
        flat: receiver.flat || "",
        comment: receiver.comment || null,
        office: receiver.office || null,
        company_id: receiver.company_id || null,
        id: receiver.id,
        sender_id: receiver.sender_id || null,
        warehouse_id: receiver.warehouse_id || null,
      };
      // Only include index if it has a real value; truncate to 10 chars (API limit)
      if (receiver.index) {
        updatePayload.index = String(receiver.index).substring(0, 10);
      }

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

        if (latitude !== null) updatePayload.latitude = latitude;
        if (longitude !== null) updatePayload.longitude = longitude;
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
          beforeState.entity = receiver.entity;
          updatePayload.full_name = newReceiver.full_name;
          updatePayload.title = newReceiver.full_name;
          updatePayload.entity = newReceiver.entity || newReceiver.full_name;
          afterState.full_name = newReceiver.full_name;
          afterState.entity = updatePayload.entity;
        }
        if (newReceiver.entity && !newReceiver.full_name) {
          beforeState.entity = receiver.entity;
          updatePayload.entity = newReceiver.entity;
          updatePayload.title = newReceiver.entity;
          updatePayload.full_name = newReceiver.entity;
          afterState.entity = newReceiver.entity;
          afterState.full_name = newReceiver.entity;
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
        console.error(`[${VERSION}] Update receiver failed: ${updateResp.status}, payload: ${JSON.stringify(updatePayload)}, body: ${errBody.substring(0, 500)}`);
        throw new Error(`Update receiver failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
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

// ---- Change Direction (city_id update on receiver) ----

async function executeChangeDirection(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  let targetCity = aiResult.city;

  if (!targetCity) {
    return [{ invoice: "N/A", success: false, error: "Город назначения не указан" }];
  }

  // If city contains " - " or " – ", take the LAST part (destination city)
  const separators = [" - ", " – ", " — ", "-"];
  for (const sep of separators) {
    if (targetCity.includes(sep)) {
      const parts = targetCity.split(sep).map((p: string) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        console.log(`[${VERSION}] City pair detected: "${targetCity}" → taking destination: "${parts[parts.length - 1]}"`);
        targetCity = parts[parts.length - 1];
      }
      break;
    }
  }

  // Fuzzy city lookup
  const { data: allCities } = await supabase
    .from("spark_cities")
    .select("id, name");

  if (!allCities || allCities.length === 0) {
    return invoices.map((inv: string) => ({ invoice: inv, success: false, error: "Справочник городов пуст" }));
  }

  const normalize = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[\s-]+/g, " ").trim();
  const normalizedTarget = normalize(targetCity);

  // Levenshtein distance
  function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    return dp[m][n];
  }

  // Find best match
  let bestMatch: any = null;
  let bestScore = Infinity;
  for (const city of allCities) {
    const normalizedName = normalize(city.name);
    // Exact match
    if (normalizedName === normalizedTarget) {
      bestMatch = city;
      bestScore = 0;
      break;
    }
    const dist = levenshtein(normalizedTarget, normalizedName);
    // Normalize score by max length
    const maxLen = Math.max(normalizedTarget.length, normalizedName.length);
    const similarity = 1 - dist / maxLen;
    if (similarity > 0.6 && dist < bestScore) {
      bestScore = dist;
      bestMatch = city;
    }
  }

  if (!bestMatch) {
    await supabase.from("execution_logs").insert({
      task_id: taskId, action: "change_direction", step: "city_lookup",
      success: false, error_message: `Город "${targetCity}" не найден в справочнике (fuzzy)`,
    });
    return invoices.map((inv: string) => ({ invoice: inv, success: false, error: `Город "${targetCity}" не найден` }));
  }

  var cityId = bestMatch.id;
  var cityName = bestMatch.name;
  console.log(`[${VERSION}] City fuzzy match: "${targetCity}" → id=${cityId}, name="${cityName}" (distance=${bestScore})`);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "change_direction", step: "city_lookup",
    request_data: { requested_city: targetCity },
    response_data: { city_id: cityId, city_name: cityName }, success: true,
  });

  for (const invoice of invoices) {
    try {
      // 1. Check invoice status via public endpoint (no auth needed)
      const statusResp = await fetch(
        `https://gateway.spark.kz/cabinet/api/invoice-status/${encodeURIComponent(invoice)}`
      );
      if (statusResp.ok) {
        const statusData = await statusResp.json();
        console.log(`[${VERSION}] Invoice ${invoice} status response:`, JSON.stringify(statusData).substring(0, 500));
        let statuses: any[] = [];
        if (Array.isArray(statusData)) {
          statuses = statusData;
        } else if (statusData && typeof statusData === "object") {
          if (Array.isArray(statusData.data?.status_history)) statuses = statusData.data.status_history;
          else if (Array.isArray(statusData.data)) statuses = statusData.data;
          else if (Array.isArray(statusData.statuses)) statuses = statusData.statuses;
          else if (Array.isArray(statusData.status_history)) statuses = statusData.status_history;
          else if (Array.isArray(statusData.result)) statuses = statusData.result;
          else {
            // Single status object — wrap it
            statuses = [statusData];
          }
        }
        // Check if "Груз в пути" (status_code 206) has state "completed"
        const inTransit = statuses.find((s: any) => s.status_code === 206 || s.status_name === "Груз в пути");
        if (inTransit && inTransit.state === "completed") {
          console.log(`[${VERSION}] Invoice ${invoice}: "Груз в пути" already completed — skipping direction change`);
          await supabase.from("execution_logs").insert({
            task_id: taskId, action: "change_direction", step: "status_check",
            request_data: { invoice },
            response_data: { status: inTransit }, success: false,
            error_message: "Груз уже в пути — смена направления невозможна",
          });
          results.push({ invoice, success: false, error: "Груз уже в пути — смена направления невозможна" });
          continue;
        }
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_direction", step: "status_check",
        request_data: { invoice }, response_data: { passed: true }, success: true,
      });

      // 2. Search for invoice to get logistics-info
      const searchResp = await fetch(
        `${sparkUrl}/admin/logistics-info?page=1&limit=50&search=${encodeURIComponent(invoice)}`,
        { headers: { Authorization: `Bearer ${sparkToken}` } }
      );
      if (!searchResp.ok) throw new Error(`Search failed: ${searchResp.status}`);
      const searchData = await searchResp.json();
      const items = searchData.data || searchData.items || searchData || [];
      const item = Array.isArray(items) ? items[0] : items;
      if (!item?.id) throw new Error("Invoice not found");

      // 3. GET full logistics-info for receiver data
      const fullResp = await fetch(
        `${sparkUrl}/logistics-info/${item.id}`,
        { headers: { Authorization: `Bearer ${sparkToken}`, "Accept": "application/json" } }
      );
      if (!fullResp.ok) throw new Error(`GET logistics-info/${item.id} failed: ${fullResp.status}`);
      const fullData = await fullResp.json();
      const logisticsInfo = fullData.data || fullData;
      const receiver = logisticsInfo.receiver || logisticsInfo;
      if (!receiver?.id) throw new Error("Receiver not found");

      // 4. Geocode current address in the NEW city
      // Strip city name from address fields (e.g. "Астана, ул. Тайбурыл, 23/1" → "ул. Тайбурыл, 23/1")
      const stripCityFromAddress = (addr: string): string => {
        if (!addr) return addr;
        // Remove city prefix patterns like "г. Астана, " or "Астана, " or "г.Астана,"
        const cityPattern = /^(?:г\.?\s*)?[А-Яа-яЁёA-Za-z\-]+\s*,\s*/;
        const match = addr.match(cityPattern);
        if (match) {
          // Verify the extracted part looks like a city name (not a street)
          const extracted = match[0].replace(/^г\.?\s*/, "").replace(/\s*,\s*$/, "").trim();
          const normalizedExtracted = extracted.toLowerCase().replace(/ё/g, "е");
          // Check against known cities in allCities or common city patterns
          const isCity = allCities?.some((c: any) => {
            const norm = c.name.toLowerCase().replace(/ё/g, "е");
            return norm === normalizedExtracted || 
                   normalizedExtracted.includes(norm) || 
                   norm.includes(normalizedExtracted);
          });
          if (isCity) {
            console.log(`[${VERSION}] Stripped city "${extracted}" from address: "${addr}"`);
            return addr.slice(match[0].length).trim();
          }
        }
        return addr;
      };

      let currentStreet = stripCityFromAddress(receiver.street || "");
      const currentHouse = receiver.house || "";
      let cleanFullAddress = stripCityFromAddress(receiver.full_address || "");
      let newLatitude = receiver.latitude != null ? Number(receiver.latitude) : null;
      let newLongitude = receiver.longitude != null ? Number(receiver.longitude) : null;
      let newFullAddress = cleanFullAddress;

      if (currentStreet) {
        const yandexApiKey = settings.yandex_geocoder_api_key;
        if (yandexApiKey) {
          const geoQuery = `${cityName}, ${currentStreet} ${currentHouse}`.trim();
          console.log(`[${VERSION}] Geocoding address in new city: "${geoQuery}"`);
          try {
            const geoResp = await fetch(
              `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(geoQuery)}`
            );
            const geoData = await geoResp.json();
            const geoMember = geoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
            const pos = geoMember?.Point?.pos;
            if (pos) {
              const [lon, lat] = pos.split(" ").map(Number);
              newLatitude = lat;
              newLongitude = lon;
              const formattedAddr = geoMember?.metaDataProperty?.GeocoderMetaData?.text || "";
              if (formattedAddr) newFullAddress = formattedAddr;
              console.log(`[${VERSION}] Geocoded in ${cityName}: lat=${lat}, lon=${lon}, addr="${formattedAddr}"`);
            }
            await supabase.from("execution_logs").insert({
              task_id: taskId, action: "change_direction", step: "geocoding_new_city",
              request_data: { query: geoQuery },
              response_data: geoMember ? { pos, formatted: geoMember?.metaDataProperty?.GeocoderMetaData?.text } : { error: "No results" },
              success: !!geoMember,
            });
          } catch (geoErr: any) {
            console.warn(`[${VERSION}] Geocoding failed for direction change: ${geoErr.message}`);
            await supabase.from("execution_logs").insert({
              task_id: taskId, action: "change_direction", step: "geocoding_new_city",
              request_data: { query: `${cityName}, ${currentStreet} ${currentHouse}` },
              success: false, error_message: geoErr.message,
            });
          }
        } else {
          console.warn(`[${VERSION}] Yandex Geocoder API key not configured — skipping address geocoding for direction change`);
        }
      }

      // 5. Build PUT payload with new city_id and geocoded coordinates
      const updatePayload: any = {
        title: receiver.title,
        entity: receiver.entity || receiver.title,
        full_name: receiver.full_name,
        phone: receiver.phone,
        additional_phone: receiver.additional_phone || null,
        city_id: Number(cityId),
        latitude: newLatitude,
        longitude: newLongitude,
        street: currentStreet,
        house: currentHouse,
        full_address: newFullAddress,
        flat: receiver.flat || "",
        comment: receiver.comment || null,
        office: receiver.office || null,
        index: receiver.index || null,
        company_id: receiver.company_id || null,
        id: receiver.id,
        sender_id: receiver.sender_id || null,
        warehouse_id: receiver.warehouse_id || null,
      };

      const beforeCity = receiver.city?.name || receiver.city_id;

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_direction", step: "before_after",
        request_data: { before_city: beforeCity, before_city_id: receiver.city_id, before_address: receiver.full_address },
        response_data: { after_city: cityName, after_city_id: cityId, after_address: newFullAddress, lat: newLatitude, lon: newLongitude }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, city: cityName, before_city: beforeCity, new_address: newFullAddress });
        continue;
      }

      // 6. PUT to receivers/{id}
      console.log(`[${VERSION}] PUT /receivers/${receiver.id} direction change: city_id=${cityId} (${cityName}), address="${newFullAddress}"`);
      const updateResp = await fetch(`${sparkUrl}/receivers/${receiver.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        throw new Error(`Update receiver direction failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_direction", step: "update_direction_api",
        request_data: { receiver_id: receiver.id, new_city_id: cityId },
        response_data: { status: updateResp.status }, success: true,
      });

      results.push({ invoice, success: true, city: cityName });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_direction", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}

// ---- Change Shipment Type (Авто=1 / Авиа=2) ----

async function executeChangeShipmentType(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  const newShipmentType = Number(aiResult.shipment_type);

  if (![1, 2].includes(newShipmentType)) {
    return [{ invoice: "N/A", success: false, error: `Неверный shipment_type: ${aiResult.shipment_type}. Допустимые: 1 (Авто), 2 (Авиа)` }];
  }

  for (const invoice of invoices) {
    try {
      // 1. Check status via public endpoint — only allow if "Груз в пути" (206) is in state "waiting"
      const statusResp = await fetch(
        `https://gateway.spark.kz/cabinet/api/invoice-status/${encodeURIComponent(invoice)}`
      );
      if (!statusResp.ok) {
        throw new Error(`Status check failed: ${statusResp.status}`);
      }
      const statusData = await statusResp.json();
      console.log(`[${VERSION}] Invoice ${invoice} status for shipment_type change:`, JSON.stringify(statusData).substring(0, 500));

      let statuses: any[] = [];
      if (Array.isArray(statusData)) {
        statuses = statusData;
      } else if (statusData && typeof statusData === "object") {
        if (Array.isArray(statusData.data?.status_history)) statuses = statusData.data.status_history;
        else if (Array.isArray(statusData.data)) statuses = statusData.data;
        else if (Array.isArray(statusData.statuses)) statuses = statusData.statuses;
        else if (Array.isArray(statusData.status_history)) statuses = statusData.status_history;
        else if (Array.isArray(statusData.result)) statuses = statusData.result;
        else statuses = [statusData];
      }

      const inTransit = statuses.find((s: any) => s.status_code === 206 || s.status_name === "Груз в пути");
      if (!inTransit || inTransit.state !== "waiting") {
        const currentState = inTransit ? inTransit.state : "not found";
        const errorMsg = inTransit
          ? `Статус "Груз в пути" не в состоянии waiting (текущее: ${currentState}) — смена типа перевозки невозможна`
          : `Статус "Груз в пути" (206) не найден — смена типа перевозки невозможна`;
        console.log(`[${VERSION}] Invoice ${invoice}: ${errorMsg}`);
        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "change_shipment_type", step: "status_check",
          request_data: { invoice },
          response_data: { statuses: statuses.map((s: any) => ({ status_code: s.status_code, status_name: s.status_name, state: s.state })) },
          success: false, error_message: errorMsg,
        });
        results.push({ invoice, success: false, error: errorMsg });
        continue;
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_shipment_type", step: "status_check",
        request_data: { invoice },
        response_data: { status: inTransit, passed: true }, success: true,
      });

      // 2. Search for invoice to get logistics-info ID
      const searchResp = await fetch(
        `${sparkUrl}/admin/logistics-info?page=1&limit=50&search=${encodeURIComponent(invoice)}`,
        { headers: { Authorization: `Bearer ${sparkToken}` } }
      );
      if (!searchResp.ok) throw new Error(`Search failed: ${searchResp.status}`);
      const searchData = await searchResp.json();
      const items = searchData.data || searchData.items || searchData || [];
      const item = Array.isArray(items) ? items[0] : items;
      if (!item?.id) throw new Error("Invoice not found");

      // 3. GET full logistics-info to build PUT payload
      const fullResp = await fetch(
        `${sparkUrl}/logistics-info/${item.id}`,
        { headers: { Authorization: `Bearer ${sparkToken}`, "Accept": "application/json" } }
      );
      if (!fullResp.ok) throw new Error(`GET logistics-info/${item.id} failed: ${fullResp.status}`);
      const fullData = await fullResp.json();
      const logisticsInfo = fullData.data || fullData;

      const beforeState = { shipment_type: logisticsInfo.shipment_type };
      const afterState = { shipment_type: newShipmentType };

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_shipment_type", step: "before_after",
        request_data: { before: beforeState },
        response_data: { after: afterState }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, before: beforeState, after: afterState });
        continue;
}

// ---- Helper: Parse status history from invoice-status response ----

function parseStatusHistory(statusData: any): any[] {
  if (Array.isArray(statusData)) return statusData;
  if (statusData && typeof statusData === "object") {
    if (Array.isArray(statusData.data?.status_history)) return statusData.data.status_history;
    if (Array.isArray(statusData.data)) return statusData.data;
    if (Array.isArray(statusData.statuses)) return statusData.statuses;
    if (Array.isArray(statusData.status_history)) return statusData.status_history;
    if (Array.isArray(statusData.result)) return statusData.result;
    return [statusData];
  }
  return [];
}

// ---- Helper: Check sender status (225 "Обработка груза на складе" must be "waiting") ----

async function checkSenderStatusAllowed(invoice: string, sparkToken: string, supabase: any, taskId: string, actionName: string): Promise<{ allowed: boolean; error?: string }> {
  const statusResp = await fetch(
    `https://gateway.spark.kz/cabinet/api/invoice-status/${encodeURIComponent(invoice)}`
  );
  if (!statusResp.ok) {
    return { allowed: false, error: `Status check failed: ${statusResp.status}` };
  }
  const statusData = await statusResp.json();
  console.log(`[${VERSION}] Invoice ${invoice} status for ${actionName}:`, JSON.stringify(statusData).substring(0, 500));

  const statuses = parseStatusHistory(statusData);

  const processingStatus = statuses.find((s: any) => s.status_code === 225 || s.status_name === "Обработка груза на складе");
  
  if (processingStatus && processingStatus.state === "completed") {
    const errorMsg = `Статус "Обработка груза на складе" (225) уже завершён — изменение отправителя невозможно`;
    console.log(`[${VERSION}] Invoice ${invoice}: ${errorMsg}`);
    await supabase.from("execution_logs").insert({
      task_id: taskId, action: actionName, step: "status_check",
      request_data: { invoice },
      response_data: { status: processingStatus },
      success: false, error_message: errorMsg,
    });
    return { allowed: false, error: errorMsg };
  }

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: actionName, step: "status_check",
    request_data: { invoice },
    response_data: { processing_status: processingStatus || "not_found", passed: true }, success: true,
  });
  return { allowed: true };
}

// ---- Update Sender (address + name + phone) ----

async function executeUpdateSender(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  const newAddress = aiResult.address;
  const newSender = aiResult.sender;

  for (const invoice of invoices) {
    try {
      // 1. Status check
      const statusCheck = await checkSenderStatusAllowed(invoice, sparkToken, supabase, taskId, "update_sender");
      if (!statusCheck.allowed) {
        results.push({ invoice, success: false, error: statusCheck.error });
        continue;
      }

      // 2. Search for invoice to get logistics-info
      const searchResp = await fetch(
        `${sparkUrl}/admin/logistics-info?page=1&limit=50&search=${encodeURIComponent(invoice)}`,
        { headers: { Authorization: `Bearer ${sparkToken}` } }
      );
      if (!searchResp.ok) throw new Error(`Search failed: ${searchResp.status}`);
      const searchData = await searchResp.json();
      const items = searchData.data || searchData.items || searchData || [];
      const item = Array.isArray(items) ? items[0] : items;
      if (!item?.id) throw new Error("Invoice not found");

      // Use order_id for sender endpoint (not id which is for накладная)
      const orderId = item.order_id;
      if (!orderId) throw new Error("order_id not found in logistics-info search result");

      // 3. GET full logistics-info for sender data
      const fullResp = await fetch(
        `${sparkUrl}/logistics-info/${item.id}`,
        { headers: { Authorization: `Bearer ${sparkToken}`, "Accept": "application/json" } }
      );
      if (!fullResp.ok) throw new Error(`GET logistics-info/${item.id} failed: ${fullResp.status}`);
      const fullData = await fullResp.json();
      const logisticsInfo = fullData.data || fullData;
      const sender = logisticsInfo.sender || {};
      if (!sender?.id) throw new Error("Sender not found in logistics-info");

      const senderCity = sender.city?.name || sender.city || "";
      console.log(`[${VERSION}] Sender: id=${sender.id}, order_id=${orderId}, city="${senderCity}", title="${sender.title}", phone="${sender.phone}"`);

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_sender", step: "get_sender_info",
        request_data: { invoice, logistics_info_id: item.id, order_id: orderId },
        response_data: { sender_id: sender.id, city: senderCity, title: sender.title, full_name: sender.full_name, phone: sender.phone },
        success: true,
      });

      // 4. Build update payload — preserve all existing sender fields
      const updatePayload: any = {
        title: sender.title,
        entity: sender.entity || sender.title,
        full_name: sender.full_name,
        phone: sender.phone,
        additional_phone: sender.additional_phone || null,
        city_id: typeof sender.city_id === 'number' ? sender.city_id : Number(sender.city_id),
        latitude: sender.latitude != null ? Number(sender.latitude) : null,
        longitude: sender.longitude != null ? Number(sender.longitude) : null,
        street: sender.street || "",
        house: sender.house || "",
        full_address: sender.full_address || "",
        comment: sender.comment || null,
        office: sender.office || null,
        company_id: sender.company_id || null,
        id: sender.id,
        warehouse_id: null, // ALWAYS null per requirement
      };
      if (sender.index) {
        updatePayload.index = String(sender.index).substring(0, 10);
      } else {
        updatePayload.index = null;
      }

      const beforeState: any = {};
      const afterState: any = {};

      // 5. Handle address change
      if (newAddress) {
        const requestedCity = newAddress.city || null;
        const effectiveCity = requestedCity || senderCity;

        if (requestedCity && senderCity && requestedCity.toLowerCase() !== senderCity.toLowerCase()) {
          const error = `Город не совпадает: запрос="${requestedCity}" vs отправитель="${senderCity}". Обновление отклонено.`;
          await supabase.from("execution_logs").insert({
            task_id: taskId, action: "update_sender", step: "city_check",
            success: false, error_message: error,
          });
          results.push({ invoice, success: false, error });
          continue;
        }

        const yandexApiKey = settings.yandex_geocoder_api_key;
        if (!yandexApiKey) throw new Error("Yandex Geocoder API key not configured");

        const geoQuery = `${effectiveCity}, ${newAddress.street} ${newAddress.house}`;
        const geoResp = await fetch(
          `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(geoQuery)}`
        );
        const geoData = await geoResp.json();
        const geoMember = geoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
        const pos = geoMember?.Point?.pos;
        if (pos) {
          const [lon, lat] = pos.split(" ").map(Number);
          updatePayload.latitude = lat;
          updatePayload.longitude = lon;
        }

        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "update_sender", step: "geocoding_yandex",
          request_data: { query: geoQuery },
          response_data: geoMember ? { pos, formatted: geoMember?.metaDataProperty?.GeocoderMetaData?.text } : { error: "No results" },
          success: !!geoMember,
        });

        beforeState.street = sender.street;
        beforeState.house = sender.house;
        beforeState.full_address = sender.full_address;
        updatePayload.street = newAddress.street;
        updatePayload.house = newAddress.house;
        updatePayload.full_address = newAddress.full_address;
        afterState.street = newAddress.street;
        afterState.house = newAddress.house;
        afterState.full_address = newAddress.full_address;
      }

      // 6. Handle name/phone change
      if (newSender) {
        if (newSender.full_name) {
          beforeState.full_name = sender.full_name;
          beforeState.entity = sender.entity;
          updatePayload.full_name = newSender.full_name;
          updatePayload.title = newSender.full_name;
          updatePayload.entity = newSender.entity || newSender.full_name;
          afterState.full_name = newSender.full_name;
          afterState.entity = updatePayload.entity;
        }
        if (newSender.entity && !newSender.full_name) {
          beforeState.entity = sender.entity;
          updatePayload.entity = newSender.entity;
          updatePayload.title = newSender.entity;
          updatePayload.full_name = newSender.entity;
          afterState.entity = newSender.entity;
          afterState.full_name = newSender.entity;
        }
        if (newSender.phone) {
          beforeState.phone = sender.phone;
          const normalizedPhone = normalizePhone(newSender.phone);
          updatePayload.phone = normalizedPhone;
          afterState.phone = normalizedPhone;
        }
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_sender", step: "before_after",
        request_data: { before: beforeState },
        response_data: { after: afterState }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, before: beforeState, after: afterState });
        continue;
      }

      // 7. PUT to /senders/{order_id}
      console.log(`[${VERSION}] PUT /senders/${orderId} payload:`, JSON.stringify(updatePayload));
      const updateResp = await fetch(`${sparkUrl}/senders/${orderId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        throw new Error(`Update sender failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_sender", step: "update_sender_api",
        request_data: { order_id: orderId },
        response_data: { status: updateResp.status }, success: true,
      });

      results.push({ invoice, success: true, changes: afterState });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_sender", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}

// ---- Change Sender Direction (city_id update on sender) ----

async function executeChangeSenderDirection(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  let targetCity = aiResult.city;

  if (!targetCity) {
    return [{ invoice: "N/A", success: false, error: "Город отправителя не указан" }];
  }

  // Parse city pairs
  const separators = [" - ", " – ", " — ", "-"];
  for (const sep of separators) {
    if (targetCity.includes(sep)) {
      const parts = targetCity.split(sep).map((p: string) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        console.log(`[${VERSION}] Sender city pair: "${targetCity}" → taking: "${parts[parts.length - 1]}"`);
        targetCity = parts[parts.length - 1];
      }
      break;
    }
  }

  // Fuzzy city lookup
  const { data: allCities } = await supabase.from("spark_cities").select("id, name");
  if (!allCities || allCities.length === 0) {
    return invoices.map((inv: string) => ({ invoice: inv, success: false, error: "Справочник городов пуст" }));
  }

  const normalize = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[\s-]+/g, " ").trim();
  const normalizedTarget = normalize(targetCity);

  function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    return dp[m][n];
  }

  let bestMatch: any = null;
  let bestScore = Infinity;
  for (const city of allCities) {
    const normalizedName = normalize(city.name);
    if (normalizedName === normalizedTarget) { bestMatch = city; bestScore = 0; break; }
    const dist = levenshtein(normalizedTarget, normalizedName);
    const maxLen = Math.max(normalizedTarget.length, normalizedName.length);
    const similarity = 1 - dist / maxLen;
    if (similarity > 0.6 && dist < bestScore) { bestScore = dist; bestMatch = city; }
  }

  if (!bestMatch) {
    await supabase.from("execution_logs").insert({
      task_id: taskId, action: "change_sender_direction", step: "city_lookup",
      success: false, error_message: `Город "${targetCity}" не найден в справочнике`,
    });
    return invoices.map((inv: string) => ({ invoice: inv, success: false, error: `Город "${targetCity}" не найден` }));
  }

  const cityId = bestMatch.id;
  const cityName = bestMatch.name;
  console.log(`[${VERSION}] Sender city match: "${targetCity}" → id=${cityId}, name="${cityName}"`);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "change_sender_direction", step: "city_lookup",
    request_data: { requested_city: targetCity },
    response_data: { city_id: cityId, city_name: cityName }, success: true,
  });

  for (const invoice of invoices) {
    try {
      // 1. Status check (225 must be "waiting")
      const statusCheck = await checkSenderStatusAllowed(invoice, sparkToken, supabase, taskId, "change_sender_direction");
      if (!statusCheck.allowed) {
        results.push({ invoice, success: false, error: statusCheck.error });
        continue;
      }

      // 2. Search for invoice
      const searchResp = await fetch(
        `${sparkUrl}/admin/logistics-info?page=1&limit=50&search=${encodeURIComponent(invoice)}`,
        { headers: { Authorization: `Bearer ${sparkToken}` } }
      );
      if (!searchResp.ok) throw new Error(`Search failed: ${searchResp.status}`);
      const searchData = await searchResp.json();
      const items = searchData.data || searchData.items || searchData || [];
      const item = Array.isArray(items) ? items[0] : items;
      if (!item?.id) throw new Error("Invoice not found");

      const orderId = item.order_id;
      if (!orderId) throw new Error("order_id not found in logistics-info");

      // 3. GET full logistics-info for sender data
      const fullResp = await fetch(
        `${sparkUrl}/logistics-info/${item.id}`,
        { headers: { Authorization: `Bearer ${sparkToken}`, "Accept": "application/json" } }
      );
      if (!fullResp.ok) throw new Error(`GET logistics-info/${item.id} failed: ${fullResp.status}`);
      const fullData = await fullResp.json();
      const logisticsInfo = fullData.data || fullData;
      const sender = logisticsInfo.sender || {};
      if (!sender?.id) throw new Error("Sender not found in logistics-info");

      // 4. Geocode sender address in new city
      const stripCityFromAddress = (addr: string): string => {
        if (!addr) return addr;
        const cityPattern = /^(?:г\.?\s*)?[А-Яа-яЁёA-Za-z\-]+\s*,\s*/;
        const match = addr.match(cityPattern);
        if (match) {
          const extracted = match[0].replace(/^г\.?\s*/, "").replace(/\s*,\s*$/, "").trim();
          const normalizedExtracted = extracted.toLowerCase().replace(/ё/g, "е");
          const isCity = allCities?.some((c: any) => {
            const norm = c.name.toLowerCase().replace(/ё/g, "е");
            return norm === normalizedExtracted || normalizedExtracted.includes(norm) || norm.includes(normalizedExtracted);
          });
          if (isCity) return addr.slice(match[0].length).trim();
        }
        return addr;
      };

      let currentStreet = stripCityFromAddress(sender.street || "");
      const currentHouse = sender.house || "";
      let newFullAddress = stripCityFromAddress(sender.full_address || "");
      let newLatitude = sender.latitude != null ? Number(sender.latitude) : null;
      let newLongitude = sender.longitude != null ? Number(sender.longitude) : null;

      if (currentStreet) {
        const yandexApiKey = settings.yandex_geocoder_api_key;
        if (yandexApiKey) {
          const geoQuery = `${cityName}, ${currentStreet} ${currentHouse}`.trim();
          console.log(`[${VERSION}] Geocoding sender in new city: "${geoQuery}"`);
          try {
            const geoResp = await fetch(
              `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(geoQuery)}`
            );
            const geoData = await geoResp.json();
            const geoMember = geoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
            const pos = geoMember?.Point?.pos;
            if (pos) {
              const [lon, lat] = pos.split(" ").map(Number);
              newLatitude = lat;
              newLongitude = lon;
              const formattedAddr = geoMember?.metaDataProperty?.GeocoderMetaData?.text || "";
              if (formattedAddr) newFullAddress = formattedAddr;
            }
            await supabase.from("execution_logs").insert({
              task_id: taskId, action: "change_sender_direction", step: "geocoding_new_city",
              request_data: { query: geoQuery },
              response_data: geoMember ? { pos, formatted: geoMember?.metaDataProperty?.GeocoderMetaData?.text } : { error: "No results" },
              success: !!geoMember,
            });
          } catch (geoErr: any) {
            console.warn(`[${VERSION}] Sender geocoding failed: ${geoErr.message}`);
          }
        }
      }

      // 5. Build PUT payload
      const updatePayload: any = {
        title: sender.title,
        entity: sender.entity || sender.title,
        full_name: sender.full_name,
        phone: sender.phone,
        additional_phone: sender.additional_phone || null,
        city_id: Number(cityId),
        latitude: newLatitude,
        longitude: newLongitude,
        street: currentStreet,
        house: currentHouse,
        full_address: newFullAddress,
        comment: sender.comment || null,
        office: sender.office || null,
        index: sender.index || null,
        company_id: sender.company_id || null,
        id: sender.id,
        warehouse_id: null, // ALWAYS null
      };

      const beforeCity = sender.city?.name || sender.city_id;

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_sender_direction", step: "before_after",
        request_data: { before_city: beforeCity, before_city_id: sender.city_id },
        response_data: { after_city: cityName, after_city_id: cityId, after_address: newFullAddress }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, city: cityName, before_city: beforeCity });
        continue;
      }

      // 6. PUT to /senders/{order_id}
      console.log(`[${VERSION}] PUT /senders/${orderId} sender direction: city_id=${cityId} (${cityName})`);
      const updateResp = await fetch(`${sparkUrl}/senders/${orderId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        throw new Error(`Update sender direction failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_sender_direction", step: "update_sender_direction_api",
        request_data: { order_id: orderId, new_city_id: cityId },
        response_data: { status: updateResp.status }, success: true,
      });

      results.push({ invoice, success: true, city: cityName });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_sender_direction", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}

      // 4. Build full PUT payload — preserve ALL existing values, only change shipment_type
      const updatePayload: any = {
        additional_service: logisticsInfo.additional_service,
        product_name: logisticsInfo.product_name || "-",
        dop_invoice_number: logisticsInfo.dop_invoice_number,
        annotation: logisticsInfo.annotation,
        cod_payment: logisticsInfo.cod_payment,
        declared_price: logisticsInfo.declared_price,
        take_date: logisticsInfo.take_date,
        period_id: logisticsInfo.period_id,
        places: logisticsInfo.places,
        weight: logisticsInfo.weight,
        width: logisticsInfo.width,
        height: logisticsInfo.height,
        depth: logisticsInfo.depth,
        volume: logisticsInfo.volume,
        cargo_name: logisticsInfo.cargo_name,
        should_return_document: logisticsInfo.should_return_document,
        shipment_type: newShipmentType,
        payment_type: logisticsInfo.payment_type,
        payment_method: logisticsInfo.payment_method,
        cash_sum: logisticsInfo.cash_sum,
        verify: logisticsInfo.verify,
        is_dangerous: logisticsInfo.is_dangerous,
        temperature_regime_type_id: logisticsInfo.temperature_regime_type_id,
        invoice_files: logisticsInfo.invoice_files,
        certificate_of_safety_files: logisticsInfo.certificate_of_safety_files,
        temperature_regime_safety_files: logisticsInfo.temperature_regime_safety_files,
      };

      // 5. PUT to logistics-info/{id}
      const typeLabel = newShipmentType === 2 ? "Авиа" : "Авто";
      console.log(`[${VERSION}] PUT /logistics-info/${item.id} shipment_type change: ${logisticsInfo.shipment_type} → ${newShipmentType} (${typeLabel})`);
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
        throw new Error(`Update shipment_type failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_shipment_type", step: "update_shipment_type_api",
        request_data: { logistics_info_id: item.id },
        response_data: { status: updateResp.status, changes: afterState }, success: true,
      });

      results.push({ invoice, success: true, changes: afterState });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_shipment_type", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}
