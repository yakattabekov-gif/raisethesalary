import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

import { VERSION, corsHeaders, delay, extractTextFromADF } from "../_shared/helpers.ts";
import { sendTelegramNotification } from "../_shared/telegram.ts";
import { fetchJiraComments, addJiraComment, transitionJiraIssue } from "../_shared/jira.ts";
import { parseWithAI } from "../_shared/ai-parser.ts";
import { executeCancelOrders } from "../_shared/executor-cancel.ts";
import { executeRestoreOrder } from "../_shared/executor-restore.ts";
import { executeUpdateReceiver } from "../_shared/executor-update-receiver.ts";
import { executeUpdatePayment } from "../_shared/executor-update-payment.ts";
import { executeChangeDirection } from "../_shared/executor-change-direction.ts";
import { executeChangeShipmentType } from "../_shared/executor-change-shipment-type.ts";
import { executeUpdateSender } from "../_shared/executor-update-sender.ts";
import { executeChangeSenderDirection } from "../_shared/executor-change-sender-direction.ts";
import { executeChangeActNumber } from "../_shared/executor-change-act-number.ts";

// ---- Action Dispatcher ----

async function dispatchAction(
  actionItem: any, supabase: any, settings: Record<string, string>,
  taskId: string, dryRun: boolean, cancelledInvoices: Set<string>
): Promise<{ results: any[]; commentLines: string[] }> {
  const results: any[] = [];
  const commentLines: string[] = [];

  const filterInvoices = (invoices: string[]) =>
    invoices.filter((inv: string) => !cancelledInvoices.has(inv));

  if (actionItem.action === "cancel") {
    const r = await executeCancelOrders(supabase, settings, actionItem.invoices || [], taskId, dryRun);
    results.push(...r);
    r.forEach((r: any) => commentLines.push(r.success ? `✅ ${r.invoice}: отменена` : `❌ ${r.invoice}: ${r.error}`));

  } else if (actionItem.action === "restore_order") {
    const r = await executeRestoreOrder(supabase, settings, actionItem.invoices || [], taskId, dryRun);
    results.push(...r);
    r.forEach((r: any) => commentLines.push(r.success ? `✅ ${r.invoice}: заказ восстановлен` : `❌ ${r.invoice}: ${r.error}`));

  } else if (actionItem.action === "update_receiver") {
    const filtered = filterInvoices(actionItem.invoices || []);
    if (filtered.length === 0) { commentLines.push(`ℹ️ Обновление получателя пропущено — заказ будет отменён`); return { results, commentLines }; }
    const r = await executeUpdateReceiver(supabase, settings, { ...actionItem, invoices: filtered }, taskId, dryRun);
    results.push(...r);
    r.forEach((r: any) => commentLines.push(r.success ? `✅ ${r.invoice}: данные получателя обновлены` : `❌ ${r.invoice}: ${r.error}`));

  } else if (actionItem.action === "update_payment") {
    const filtered = filterInvoices(actionItem.invoices || []);
    if (filtered.length === 0) { commentLines.push(`ℹ️ Смена оплаты пропущена — заказ будет отменён`); return { results, commentLines }; }
    const r = await executeUpdatePayment(supabase, settings, { ...actionItem, invoices: filtered }, taskId, dryRun);
    results.push(...r);
    r.forEach((r: any) => commentLines.push(r.success ? `✅ ${r.invoice}: оплата обновлена` : `❌ ${r.invoice}: ${r.error}`));

  } else if (actionItem.action === "change_direction") {
    const filtered = filterInvoices(actionItem.invoices || []);
    if (filtered.length === 0) { commentLines.push(`ℹ️ Смена направления пропущена — заказ будет отменён`); return { results, commentLines }; }
    const r = await executeChangeDirection(supabase, settings, { ...actionItem, invoices: filtered }, taskId, dryRun);
    results.push(...r);
    r.forEach((r: any) => commentLines.push(r.success ? `✅ ${r.invoice}: направление изменено${r.changed ? ` (${r.changed})` : ` на ${r.city || actionItem.city}`}` : `❌ ${r.invoice}: ${r.error}`));

  } else if (actionItem.action === "change_shipment_type") {
    const filtered = filterInvoices(actionItem.invoices || []);
    if (filtered.length === 0) { commentLines.push(`ℹ️ Смена типа перевозки пропущена — заказ будет отменён`); return { results, commentLines }; }
    const r = await executeChangeShipmentType(supabase, settings, { ...actionItem, invoices: filtered }, taskId, dryRun);
    results.push(...r);
    const typeLabel = actionItem.shipment_type === 2 ? "Авиа (Экспресс)" : "Авто (Стандарт)";
    r.forEach((r: any) => commentLines.push(r.success ? `✅ ${r.invoice}: тип перевозки изменён на ${typeLabel}` : `❌ ${r.invoice}: ${r.error}`));

  } else if (actionItem.action === "update_sender") {
    const filtered = filterInvoices(actionItem.invoices || []);
    if (filtered.length === 0) { commentLines.push(`ℹ️ Обновление отправителя пропущено — заказ будет отменён`); return { results, commentLines }; }
    const r = await executeUpdateSender(supabase, settings, { ...actionItem, invoices: filtered }, taskId, dryRun);
    results.push(...r);
    r.forEach((r: any) => commentLines.push(r.success ? `✅ ${r.invoice}: данные отправителя обновлены` : `❌ ${r.invoice}: ${r.error}`));

  } else if (actionItem.action === "change_sender_direction") {
    const filtered = filterInvoices(actionItem.invoices || []);
    if (filtered.length === 0) { commentLines.push(`ℹ️ Смена направления отправителя пропущена — заказ будет отменён`); return { results, commentLines }; }
    const r = await executeChangeSenderDirection(supabase, settings, { ...actionItem, invoices: filtered }, taskId, dryRun);
    results.push(...r);
    r.forEach((r: any) => commentLines.push(r.success ? `✅ ${r.invoice}: направление отправителя изменено на ${r.city || actionItem.city}` : `❌ ${r.invoice}: ${r.error}`));

  } else if (actionItem.action === "change_act_number") {
    const r = await executeChangeActNumber(supabase, settings, actionItem, taskId, dryRun);
    results.push(...r);
    r.forEach((r: any) => commentLines.push(r.success ? `✅ Номер АВР изменён на ${actionItem.act_number} для ФТЛ заказов: ${(actionItem.ftl_order_ids || []).join(", ")}` : `❌ Смена АВР: ${r.error}`));

  } else if (actionItem.action === "create_invoice") {
    // Map create_invoice → update_payment (AI sometimes misclassifies "внести сумму на каспи")
    console.log(`[${VERSION}] Remapping create_invoice → update_payment`);
    const remapped = { ...actionItem, action: "update_payment" };
    if (!remapped.payment) {
      remapped.payment = {
        payment_type: null,
        payment_method: actionItem.payment_method || null,
        cash_sum: actionItem.cash_sum || null,
        cod_payment: null,
      };
    }
    const filtered = filterInvoices(remapped.invoices || []);
    if (filtered.length === 0) { commentLines.push(`ℹ️ Смена оплаты пропущена — заказ будет отменён`); return { results, commentLines }; }
    const r = await executeUpdatePayment(supabase, settings, { ...remapped, invoices: filtered }, taskId, dryRun);
    results.push(...r);
    r.forEach((r: any) => commentLines.push(r.success ? `✅ ${r.invoice}: оплата обновлена` : `❌ ${r.invoice}: ${r.error}`));
  }

  return { results, commentLines };
}

// ---- Execute all actions for a task ----

async function executeAllActions(
  aiResult: any, supabase: any, settings: Record<string, string>,
  taskId: string, dryRun: boolean
): Promise<{ allResults: any[]; allCommentLines: string[]; allSuccess: boolean; anySuccess: boolean }> {
  const cancelledInvoices = new Set<string>();
  for (const actionItem of aiResult.actions) {
    if (actionItem.action === "cancel") {
      (actionItem.invoices || []).forEach((inv: string) => cancelledInvoices.add(inv));
    }
  }

  const allResults: any[] = [];
  const allCommentLines: string[] = [];
  let allSuccess = true;
  let anySuccess = false;

  for (const actionItem of aiResult.actions) {
    const { results, commentLines } = await dispatchAction(actionItem, supabase, settings, taskId, dryRun, cancelledInvoices);
    allResults.push(...results);
    allCommentLines.push(...commentLines);
    if (!results.every((r: any) => r.success)) allSuccess = false;
    if (results.some((r: any) => r.success)) anySuccess = true;
  }

  return { allResults, allCommentLines, allSuccess, anySuccess };
}

// ---- Main Handler ----

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // --- Auth: allow service-role (cron) or admin user ---
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const isServiceRole = token === supabaseKey;

  if (!isServiceRole) {
    // Verify it's a real admin user
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles } = await supabase
      .from("user_roles").select("role")
      .eq("user_id", claimsData.user.id).eq("role", "admin");
    if (!roles?.length) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  console.log(`[${VERSION}] Request received at ${new Date().toISOString()}`);

  const { data: cronRun } = await supabase
    .from("cron_runs").insert({ status: "running" }).select().single();

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
      { headers: { Authorization: `Basic ${jiraAuth}`, "Content-Type": "application/json" } }
    );

    if (!jiraResponse.ok) {
      const errText = await jiraResponse.text();
      throw new Error(`Jira API error ${jiraResponse.status}: ${errText}`);
    }

    const jiraData = await jiraResponse.json();
    const issues = jiraData.issues || [];
    console.log(`[${VERSION}] Found ${issues.length} issues`);

    await supabase.from("cron_runs").update({ tasks_found: issues.length }).eq("id", cronRun?.id);

    let processedCount = 0;

    for (const issue of issues) {
      const issueKey = issue.key;

      const { data: existing } = await supabase
        .from("processed_tasks").select("id, status, retry_count")
        .eq("jira_issue_key", issueKey).single();

      if (existing && (existing.status === "completed" || existing.status === "ignored" || existing.status === "processing" || (existing.status !== "waiting_for_info" && existing.retry_count >= 2))) {
        console.log(`[${VERSION}] Skipping ${issueKey}: status=${existing.status}, retry_count=${existing.retry_count}`);
        continue;
      }

      const summary = issue.fields?.summary || "";
      const descriptionField = issue.fields?.description;
      const description = typeof descriptionField === "string"
        ? descriptionField
        : descriptionField?.content
          ? descriptionField.content.map((block: any) => extractTextFromADF(block)).filter(Boolean).join("\n")
          : "";
      console.log(`[${VERSION}] Issue ${issueKey}: summary="${summary}", description="${description}"`);

      let taskId: string;
      if (existing) {
        taskId = existing.id;
        await supabase.from("processed_tasks")
          .update({ status: "processing", retry_count: existing.retry_count + 1, jira_summary: summary, jira_description: description })
          .eq("id", taskId);
      } else {
        const { data: newTask } = await supabase.from("processed_tasks")
          .insert({ jira_issue_key: issueKey, jira_summary: summary, jira_description: description, status: "processing", dry_run: dryRun })
          .select().single();
        taskId = newTask!.id;
      }

      try {
        let aiResult: any = { actions: [] };
        let combinedDescription = description;

        // If waiting_for_info, check Jira comments
        if (existing?.status === "waiting_for_info") {
          console.log(`[${VERSION}] Task ${issueKey} is waiting_for_info — checking comments`);
          const commentsText = await fetchJiraComments(settings, jiraAuth, issueKey);
          const invoicePattern = /(?:(?:KXT|SP|SLQ|AR|kxt|sp|slq|ar)\d{6,12}|\b\d{12,15}\b)/gi;
          const commentInvoices = commentsText.match(invoicePattern);
          if (commentInvoices && commentInvoices.length > 0) {
            combinedDescription = `${description}\n\nИз комментариев: номера накладных: ${commentInvoices.join(", ")}`;
          } else {
            await supabase.from("processed_tasks")
              .update({ status: "waiting_for_info", retry_count: (existing.retry_count || 0) + 1 })
              .eq("id", taskId);
            processedCount++;
            continue;
          }
        }

        if (aiEnabled) {
          aiResult = await parseWithAI(settings, summary, combinedDescription, supabase, taskId);
        }

        const primaryAction = aiResult.actions?.[0]?.action || null;
        await supabase.from("processed_tasks").update({ ai_response: aiResult, action: primaryAction }).eq("id", taskId);

        if (!aiResult.actions || aiResult.actions.length === 0) {
          if (aiResult.needs_invoice) {
            await addJiraComment(settings, jiraAuth, issueKey,
              `⚠️ Номер накладной не найден в текстовом формате. Пожалуйста, укажите номер накладной текстом в комментарии.`);
            await supabase.from("processed_tasks")
              .update({ status: "waiting_for_info", execution_result: { message: "Ожидание номера накладной" } })
              .eq("id", taskId);
          } else {
            await supabase.from("processed_tasks")
              .update({ status: "ignored", execution_result: { message: "Заявка не содержит поддерживаемых действий" } })
              .eq("id", taskId);
          }
          processedCount++;
          continue;
        }

        const { allResults, allCommentLines, allSuccess, anySuccess } = await executeAllActions(aiResult, supabase, settings, taskId, dryRun);

        const hasErrors = allResults.some((r: any) => !r.success);
        const finalStatus = allSuccess ? "completed" : (anySuccess ? "completed" : (hasErrors ? "error" : "ignored"));
        await supabase.from("processed_tasks").update({ status: finalStatus, execution_result: allResults }).eq("id", taskId);

        if (anySuccess && allCommentLines.length > 0) {
          await addJiraComment(settings, jiraAuth, issueKey,
            `${dryRun ? "🔸 DRY-RUN\n" : ""}Результат обработки:\n${allCommentLines.join("\n")}`);
        }

        if (!dryRun && anySuccess) {
          await sendTelegramNotification(issueKey, settings.jira_base_url || "", allResults, allCommentLines, summary, description);
        }

        if (!dryRun && allSuccess) {
          await transitionJiraIssue(settings, jiraAuth, issueKey);
          await delay(3000);
          await transitionJiraIssue(settings, jiraAuth, issueKey);
        }

        processedCount++;
      } catch (taskError: any) {
        console.error(`Error processing ${issueKey}:`, taskError);
        await supabase.from("processed_tasks").update({ status: "error", execution_result: { error: taskError.message } }).eq("id", taskId);
        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "process_error", step: "main_loop",
          success: false, error_message: taskError.message,
        });
      }
    }

    // === Retry pending tasks from DB ===
    const { data: pendingRetries } = await supabase
      .from("processed_tasks").select("*")
      .eq("status", "pending").not("ai_response", "is", null).limit(10);

    if (pendingRetries && pendingRetries.length > 0) {
      console.log(`[${VERSION}] Found ${pendingRetries.length} pending retry tasks`);
      for (const task of pendingRetries) {
        const taskId = task.id;
        const issueKey = task.jira_issue_key;
        try {
          await supabase.from("processed_tasks")
            .update({ status: "processing", retry_count: task.retry_count + 1 })
            .eq("id", taskId);

          const aiResult = task.ai_response as any;
          if (!aiResult?.actions || aiResult.actions.length === 0) {
            await supabase.from("processed_tasks")
              .update({ status: "ignored", execution_result: { message: "Нет действий для повтора" } })
              .eq("id", taskId);
            processedCount++;
            continue;
          }

          const { allResults, allCommentLines, allSuccess, anySuccess } = await executeAllActions(aiResult, supabase, settings, taskId, dryRun);

          const finalStatus = allSuccess ? "completed" : (anySuccess ? "completed" : "ignored");
          await supabase.from("processed_tasks").update({ status: finalStatus, execution_result: allResults }).eq("id", taskId);

          if (!dryRun && allCommentLines.length > 0) {
            try {
              await addJiraComment(settings, jiraAuth, issueKey, `🔄 Повторная обработка:\n${allCommentLines.join("\n")}`);
            } catch (e) {
              console.error(`[${VERSION}] Failed to add retry comment to ${issueKey}:`, e);
            }
          }

          if (anySuccess) {
            await sendTelegramNotification(issueKey, settings.jira_base_url || "", allResults, allCommentLines, task.jira_summary || "", task.jira_description || "");
          }

          processedCount++;
          console.log(`[${VERSION}] Retry task ${issueKey}: ${finalStatus}`);
        } catch (taskError: any) {
          console.error(`[${VERSION}] Retry task ${issueKey} error:`, taskError);
          await supabase.from("processed_tasks")
            .update({ status: "error", execution_result: { error: taskError.message } })
            .eq("id", taskId);
        }
      }
    }

    await supabase.from("cron_runs").update({
      finished_at: new Date().toISOString(), tasks_processed: processedCount, status: "completed",
    }).eq("id", cronRun?.id);

    console.log(`[${VERSION}] Completed. Processed ${processedCount} tasks.`);
    return new Response(JSON.stringify({ success: true, processed: processedCount, _version: VERSION }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error(`[${VERSION}] Cron error:`, error);
    await supabase.from("cron_runs").update({
      finished_at: new Date().toISOString(), status: "error", error_message: error.message,
    }).eq("id", cronRun?.id);
    return new Response(JSON.stringify({ error: "Task processing failed", _version: VERSION }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
