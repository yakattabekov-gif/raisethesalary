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

      const { data: existing } = await supabase
        .from("processed_tasks")
        .select("id, status, retry_count")
        .eq("jira_issue_key", issueKey)
        .single();

      if (existing && (existing.status === "completed" || existing.retry_count >= 2)) {
        continue;
      }

      const summary = issue.fields?.summary || "";
      const description = issue.fields?.description?.content
        ?.map((block: any) => block.content?.map((c: any) => c.text).join(""))
        .join("\n") || (typeof issue.fields?.description === "string" ? issue.fields.description : "");

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
        let aiResult: any = { action: null };

        if (aiEnabled) {
          aiResult = await parseWithAI(settings, summary, description, supabase, taskId);
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
          await addJiraComment(settings, jiraAuth, issueKey, "⚠️ AI не смог определить действие из заявки.");
          processedCount++;
          continue;
        }

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
          if (!dryRun) await transitionJiraIssue(settings, jiraAuth, issueKey);

        } else if (aiResult.action === "update_receiver") {
          const results = await executeUpdateReceiver(supabase, settings, aiResult, taskId, dryRun);
          await supabase
            .from("processed_tasks")
            .update({ status: "completed", execution_result: results })
            .eq("id", taskId);

          const commentLines = results.map((r: any) =>
            r.success ? `✅ ${r.invoice}: данные получателя обновлены` : `❌ ${r.invoice}: ${r.error}`
          );
          await addJiraComment(settings, jiraAuth, issueKey,
            `${dryRun ? "🔸 DRY-RUN\n" : ""}Результат обновления:\n${commentLines.join("\n")}`
          );
          if (!dryRun) await transitionJiraIssue(settings, jiraAuth, issueKey);
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
        error_message: error.message,
      })
      .eq("id", cronRun?.id);

    return new Response(JSON.stringify({ error: error.message }), {
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

  const systemPrompt = `Ты — парсер заявок из Jira Service Desk. Твоя задача — извлечь данные из текста заявки.

СТРОГО верни JSON без комментариев:

Если это отмена заказа:
{
  "action": "cancel",
  "invoices": ["SP00493507"]
}

Если это смена адреса и/или ФИО/телефона получателя:
{
  "action": "update_receiver",
  "invoices": ["SP00493507"],
  "address": {
    "city": "Алматы",
    "street": "Алтын Алма",
    "house": "151",
    "full_address": "Казахстан, г. Алматы, ул. Алтын Алма, 151"
  },
  "receiver": {
    "full_name": "ИВАНОВ ИВАН",
    "phone": "+77001234567"
  }
}

Важные правила:
- Если просят сменить ТОЛЬКО ФИО и/или телефон — НЕ включай поле "address", включи только "receiver".
- Если просят сменить ТОЛЬКО адрес — НЕ включай поле "receiver", включи только "address".
- Если просят сменить и адрес, и ФИО/телефон — включи оба поля.
- Номера накладных в формате SP00000000. Их может быть несколько.
- Телефон должен быть в формате +7XXXXXXXXXX.

Если данные не распознаны:
{
  "action": null
}

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
  let aiResult = { action: null };
  if (jsonMatch) {
    aiResult = JSON.parse(jsonMatch[0]);
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
    await fetch(`${settings.jira_base_url}/rest/api/3/issue/${issueKey}/comment`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        body: {
          type: "doc", version: 1,
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
    const transResp = await fetch(
      `${settings.jira_base_url}/rest/api/3/issue/${issueKey}/transitions`,
      { headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" } }
    );
    const transData = await transResp.json();
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
        `${sparkUrl.replace('/cabinet/api/v2', '')}/admin/logistics-info?search=${encodeURIComponent(invoice)}`,
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
        `${sparkUrl.replace('/cabinet/api/v2', '')}/logistics-info/${item.id}/cancel`,
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
      // 1. Get logistics info
      const infoResp = await fetch(`${sparkUrl}/logistics-info/${invoice}`, {
        headers: { Authorization: `Bearer ${sparkToken}` },
      });
      if (!infoResp.ok) throw new Error(`Get logistics-info failed: ${infoResp.status}`);
      const infoData = await infoResp.json();
      const receiver = infoData.receiver || infoData.data?.receiver;
      if (!receiver?.id) throw new Error("Receiver not found in logistics-info");

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_receiver", step: "get_logistics_info",
        request_data: { invoice },
        response_data: { receiver_id: receiver.id, city: receiver.city, full_name: receiver.full_name, phone: receiver.phone },
        success: true,
      });

      // Build update payload starting from current receiver data
      const updatePayload = { ...receiver };
      const beforeState: any = {};
      const afterState: any = {};

      // 2. Handle address change if requested
      if (newAddress) {
        // City validation: if address city doesn't match receiver city → skip
        if (newAddress.city && receiver.city &&
          newAddress.city.toLowerCase() !== receiver.city.toLowerCase()) {
          const error = `Город не совпадает: запрос="${newAddress.city}" vs заказ="${receiver.city}". Обновление отклонено.`;
          await supabase.from("execution_logs").insert({
            task_id: taskId, action: "update_receiver", step: "city_check",
            success: false, error_message: error,
          });
          results.push({ invoice, success: false, error });
          continue;
        }

        // Geocoding via Yandex
        const yandexApiKey = settings.yandex_geocoder_api_key;
        if (!yandexApiKey) throw new Error("Yandex Geocoder API key not configured");

        const geoQuery = `${newAddress.city}, ${newAddress.street} ${newAddress.house}`;
        const sparkToken = settings.spark_bearer_token;
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
        const pos = geoMember?.Point?.pos; // "longitude latitude"
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
        beforeState.latitude = receiver.latitude;
        beforeState.longitude = receiver.longitude;

        updatePayload.street = newAddress.street;
        updatePayload.house = newAddress.house;
        updatePayload.full_address = newAddress.full_address;
        updatePayload.latitude = latitude;
        updatePayload.longitude = longitude;

        afterState.street = newAddress.street;
        afterState.house = newAddress.house;
        afterState.full_address = newAddress.full_address;
        afterState.latitude = latitude;
        afterState.longitude = longitude;
      }

      // 3. Handle name/phone change if requested
      if (newReceiver) {
        if (newReceiver.full_name) {
          beforeState.full_name = receiver.full_name;
          updatePayload.full_name = newReceiver.full_name;
          afterState.full_name = newReceiver.full_name;
        }
        if (newReceiver.phone) {
          beforeState.phone = receiver.phone;
          updatePayload.phone = newReceiver.phone;
          afterState.phone = newReceiver.phone;
        }
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_receiver", step: "before_after",
        request_data: { before: beforeState },
        response_data: { after: afterState }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, before: beforeState, after: afterState });
        continue;
      }

      // 4. Single PUT request with all changes
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
