import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Create cron run record
  const { data: cronRun } = await supabase
    .from("cron_runs")
    .insert({ status: "running" })
    .select()
    .single();

  try {
    // Load settings
    const { data: settingsData } = await supabase.from("settings").select("*");
    const settings: Record<string, string> = {};
    settingsData?.forEach((s: any) => (settings[s.key] = s.value));

    const dryRun = settings.dry_run === "true";
    const aiEnabled = settings.ai_enabled === "true";

    // Validate required settings
    if (!settings.jira_base_url || !settings.jira_email || !settings.jira_api_token) {
      throw new Error("Jira settings not configured");
    }

    // 1. Fetch tasks from Jira
    const jql = settings.jira_queue_jql || "project = SH AND status = Open";
    const jiraAuth = btoa(`${settings.jira_email}:${settings.jira_api_token}`);
    
    const jiraResponse = await fetch(
      `${settings.jira_base_url}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=20`,
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
    const issues = jiraData.issues || [];

    await supabase
      .from("cron_runs")
      .update({ tasks_found: issues.length })
      .eq("id", cronRun?.id);

    let processedCount = 0;

    for (const issue of issues) {
      const issueKey = issue.key;

      // Idempotency check
      const { data: existing } = await supabase
        .from("processed_tasks")
        .select("id, status, retry_count")
        .eq("jira_issue_key", issueKey)
        .single();

      if (existing && (existing.status === "completed" || existing.retry_count >= 2)) {
        continue; // Skip already completed or max retried
      }

      const summary = issue.fields?.summary || "";
      const description = issue.fields?.description?.content
        ?.map((block: any) => block.content?.map((c: any) => c.text).join(""))
        .join("\n") || (typeof issue.fields?.description === "string" ? issue.fields.description : "");

      // Create or update task record
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
        // 2. AI Parsing
        let aiResult: any = { action: null };
        
        if (aiEnabled) {
          const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
          if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

          const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                {
                  role: "system",
                  content: `Ты — парсер заявок из Jira Service Desk. Твоя задача — извлечь данные из текста заявки.

СТРОГО верни JSON без комментариев:

Если это отмена заказа:
{
  "action": "cancel",
  "invoices": ["SP00493507"]
}

Если это смена адреса:
{
  "action": "update_address",
  "invoices": ["SP00493507"],
  "address": {
    "city": "Алматы",
    "street": "Алтын Алма",
    "house": "151",
    "full_address": "Казахстан, г. Алматы, ул. Алтын Алма, 151"
  }
}

Если данные не распознаны:
{
  "action": null
}

Номера накладных могут быть в формате SP00000000. Их может быть несколько.
ВЕРНИ ТОЛЬКО JSON, без текста вокруг.`,
                },
                {
                  role: "user",
                  content: `Тема: ${summary}\n\nОписание: ${description}`,
                },
              ],
            }),
          });

          if (!aiResponse.ok) {
            const errText = await aiResponse.text();
            throw new Error(`AI gateway error ${aiResponse.status}: ${errText}`);
          }

          const aiData = await aiResponse.json();
          const aiContent = aiData.choices?.[0]?.message?.content || "";
          
          // Parse JSON from AI response
          const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            aiResult = JSON.parse(jsonMatch[0]);
          }

          await supabase.from("execution_logs").insert({
            task_id: taskId,
            action: "ai_parse",
            step: "parse_ticket",
            request_data: { summary, description },
            response_data: aiResult,
            success: true,
          });
        }

        await supabase
          .from("processed_tasks")
          .update({ ai_response: aiResult, action: aiResult.action })
          .eq("id", taskId);

        if (!aiResult.action) {
          await supabase
            .from("processed_tasks")
            .update({ status: "completed", execution_result: { message: "No action detected by AI" } })
            .eq("id", taskId);
          
          // Comment in Jira
          await addJiraComment(settings, jiraAuth, issueKey, "⚠️ AI не смог определить действие из заявки.");
          processedCount++;
          continue;
        }

        // 3. Execute action
        if (aiResult.action === "cancel") {
          const results = await executeCancelOrders(supabase, settings, aiResult.invoices || [], taskId, dryRun);
          
          await supabase
            .from("processed_tasks")
            .update({ status: "completed", execution_result: results })
            .eq("id", taskId);

          const commentLines = results.map((r: any) => 
            r.success ? `✅ ${r.invoice}: отменена` : `❌ ${r.invoice}: ${r.error}`
          );
          await addJiraComment(settings, jiraAuth, issueKey, 
            `${dryRun ? "🔸 DRY-RUN\n" : ""}Результат отмены:\n${commentLines.join("\n")}`
          );

          if (!dryRun) {
            await transitionJiraIssue(settings, jiraAuth, issueKey);
          }
        } else if (aiResult.action === "update_address") {
          const results = await executeUpdateAddress(supabase, settings, aiResult, taskId, dryRun);
          
          await supabase
            .from("processed_tasks")
            .update({ status: "completed", execution_result: results })
            .eq("id", taskId);

          const commentLines = results.map((r: any) => 
            r.success ? `✅ ${r.invoice}: адрес обновлён` : `❌ ${r.invoice}: ${r.error}`
          );
          await addJiraComment(settings, jiraAuth, issueKey,
            `${dryRun ? "🔸 DRY-RUN\n" : ""}Результат смены адреса:\n${commentLines.join("\n")}`
          );

          if (!dryRun) {
            await transitionJiraIssue(settings, jiraAuth, issueKey);
          }
        }

        processedCount++;
      } catch (taskError: any) {
        console.error(`Error processing ${issueKey}:`, taskError);
        await supabase
          .from("processed_tasks")
          .update({ status: "error", execution_result: { error: taskError.message } })
          .eq("id", taskId);

        await supabase.from("execution_logs").insert({
          task_id: taskId,
          action: "process_error",
          step: "main_loop",
          success: false,
          error_message: taskError.message,
        });
      }
    }

    // Update cron run
    await supabase
      .from("cron_runs")
      .update({ 
        finished_at: new Date().toISOString(), 
        tasks_processed: processedCount, 
        status: "completed" 
      })
      .eq("id", cronRun?.id);

    return new Response(JSON.stringify({ success: true, processed: processedCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Cron error:", error);
    await supabase
      .from("cron_runs")
      .update({ 
        finished_at: new Date().toISOString(), 
        status: "error", 
        error_message: error.message 
      })
      .eq("id", cronRun?.id);

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ---- Helper functions ----

async function addJiraComment(settings: Record<string, string>, auth: string, issueKey: string, body: string) {
  try {
    await fetch(`${settings.jira_base_url}/rest/api/3/issue/${issueKey}/comment`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
        },
      }),
    });
  } catch (e) {
    console.error("Failed to add Jira comment:", e);
  }
}

async function transitionJiraIssue(settings: Record<string, string>, auth: string, issueKey: string) {
  try {
    // Get available transitions
    const transResp = await fetch(
      `${settings.jira_base_url}/rest/api/3/issue/${issueKey}/transitions`,
      { headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" } }
    );
    const transData = await transResp.json();
    // Find "Done" / "Готово" transition
    const doneTransition = transData.transitions?.find(
      (t: any) => t.name.toLowerCase().includes("done") || t.name.toLowerCase().includes("готово")
    );
    if (doneTransition) {
      await fetch(`${settings.jira_base_url}/rest/api/3/issue/${issueKey}/transitions`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ transition: { id: doneTransition.id } }),
      });
    }
  } catch (e) {
    console.error("Failed to transition Jira issue:", e);
  }
}

async function executeCancelOrders(
  supabase: any, settings: Record<string, string>, invoices: string[], taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;

  for (const invoice of invoices) {
    try {
      // Get logistics info
      const searchResp = await fetch(
        `${sparkUrl.replace('/cabinet/api/v2', '')}/admin/logistics-info?search=${encodeURIComponent(invoice)}`,
        { headers: { Authorization: `Bearer ${sparkToken}` } }
      );
      
      if (!searchResp.ok) throw new Error(`Search failed: ${searchResp.status}`);
      const searchData = await searchResp.json();
      const items = searchData.data || searchData.items || searchData || [];
      const item = Array.isArray(items) ? items[0] : items;
      
      if (!item?.id) throw new Error("Invoice not found");

      await supabase.from("execution_logs").insert({
        task_id: taskId,
        action: "cancel",
        step: "search_invoice",
        request_data: { invoice },
        response_data: { id: item.id, status: item.status },
        success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, spark_id: item.id });
        continue;
      }

      // Cancel
      const cancelResp = await fetch(
        `${sparkUrl.replace('/cabinet/api/v2', '')}/logistics-info/${item.id}/cancel`,
        { method: "POST", headers: { Authorization: `Bearer ${sparkToken}` } }
      );

      if (!cancelResp.ok) throw new Error(`Cancel failed: ${cancelResp.status}`);
      
      await supabase.from("execution_logs").insert({
        task_id: taskId,
        action: "cancel",
        step: "cancel_invoice",
        request_data: { id: item.id },
        response_data: { status: cancelResp.status },
        success: true,
      });

      results.push({ invoice, success: true, spark_id: item.id });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId,
        action: "cancel",
        step: "error",
        success: false,
        error_message: e.message,
        request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}

async function executeUpdateAddress(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  const newAddress = aiResult.address;

  for (const invoice of invoices) {
    try {
      // 1. Get logistics info
      const infoResp = await fetch(`${sparkUrl}/logistics-info/${invoice}`, {
        headers: { Authorization: `Bearer ${sparkToken}` },
      });
      if (!infoResp.ok) throw new Error(`Get logistics-info failed: ${infoResp.status}`);
      const infoData = await infoResp.json();
      const receiver = infoData.receiver || infoData.data?.receiver;
      if (!receiver?.id) throw new Error("Receiver not found in logistics-info");

      await supabase.from("execution_logs").insert({
        task_id: taskId,
        action: "update_address",
        step: "get_logistics_info",
        request_data: { invoice },
        response_data: { receiver_id: receiver.id, city: receiver.city },
        success: true,
      });

      // 2. City check
      if (newAddress?.city && receiver.city && 
          newAddress.city.toLowerCase() !== receiver.city.toLowerCase()) {
        const error = `City mismatch: Jira="${newAddress.city}" vs Spark="${receiver.city}"`;
        await supabase.from("execution_logs").insert({
          task_id: taskId,
          action: "update_address",
          step: "city_check",
          success: false,
          error_message: error,
        });
        results.push({ invoice, success: false, error });
        continue;
      }

      // 3. Geocoding via Nominatim
      const geoQuery = `${newAddress.city}, ${newAddress.street} ${newAddress.house}`;
      const geoResp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(geoQuery)}&format=json&limit=1&addressdetails=1`,
        { headers: { "User-Agent": "spark-bot/1.0 (support@company.kz)" } }
      );
      const geoData = await geoResp.json();
      const geo = geoData[0];

      await supabase.from("execution_logs").insert({
        task_id: taskId,
        action: "update_address",
        step: "geocoding",
        request_data: { query: geoQuery },
        response_data: geo || { error: "No results" },
        success: !!geo,
      });

      const latitude = geo ? parseFloat(geo.lat) : null;
      const longitude = geo ? parseFloat(geo.lon) : null;

      // 4. Build update payload (only change address fields)
      const updatePayload = {
        ...receiver,
        street: newAddress.street,
        house: newAddress.house,
        full_address: newAddress.full_address,
        latitude,
        longitude,
      };

      const beforeState = {
        street: receiver.street,
        house: receiver.house,
        full_address: receiver.full_address,
        latitude: receiver.latitude,
        longitude: receiver.longitude,
      };

      await supabase.from("execution_logs").insert({
        task_id: taskId,
        action: "update_address",
        step: "before_after",
        request_data: { before: beforeState },
        response_data: { after: { street: newAddress.street, house: newAddress.house, full_address: newAddress.full_address, latitude, longitude } },
        success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, before: beforeState });
        continue;
      }

      // 5. Update receiver
      const updateResp = await fetch(`${sparkUrl}/receivers/${receiver.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${sparkToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) throw new Error(`Update receiver failed: ${updateResp.status}`);

      await supabase.from("execution_logs").insert({
        task_id: taskId,
        action: "update_address",
        step: "update_receiver",
        request_data: { receiver_id: receiver.id },
        response_data: { status: updateResp.status },
        success: true,
      });

      results.push({ invoice, success: true });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId,
        action: "update_address",
        step: "error",
        success: false,
        error_message: e.message,
        request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}
