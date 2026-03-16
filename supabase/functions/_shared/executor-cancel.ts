import { VERSION, searchInvoice, getLogisticsInfo, delay } from "./helpers.ts";

export async function executeCancelOrders(
  supabase: any, settings: Record<string, string>, invoices: string[], taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;

  for (const invoice of invoices) {
    try {
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "cancel", step: "search_invoice",
        request_data: { invoice },
        response_data: { id: item.id, status: item.status }, success: true,
      });

      // Check if already cancelled
      const currentStatus = item.status?.code || item.status_code || item.status;
      if (currentStatus === 210 || currentStatus === "210" || 
          item.status?.name?.toLowerCase()?.includes("отмен")) {
        console.log(`[${VERSION}] Invoice ${invoice} already cancelled (status=${currentStatus})`);
        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "cancel", step: "already_cancelled",
          request_data: { invoice }, response_data: { status: currentStatus }, success: true,
        });
        results.push({ invoice, success: true, spark_id: item.id, already_cancelled: true });
        continue;
      }

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, spark_id: item.id });
        continue;
      }

      // Try cancel with retries
      const cancelEndpoint = `${sparkUrl}/logistics-info/${item.id}/cancel`;
      let lastError = "";
      let cancelled = false;

      for (let attempt = 1; attempt <= 3; attempt++) {
        const cancelResp = await fetch(cancelEndpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${sparkToken}` },
        });

        if (cancelResp.ok) {
          cancelled = true;
          await supabase.from("execution_logs").insert({
            task_id: taskId, action: "cancel", step: "cancel_invoice",
            request_data: { endpoint: `POST ${cancelEndpoint}`, attempt },
            response_data: { status: cancelResp.status }, success: true,
          });
          break;
        }

        // Read error body for details
        const errBody = await cancelResp.text().catch(() => "");
        lastError = `Cancel failed (attempt ${attempt}): ${cancelResp.status} - ${errBody}`;
        console.log(`[${VERSION}] ${lastError}`);

        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "cancel", step: `cancel_attempt_${attempt}`,
          request_data: { endpoint: `POST ${cancelEndpoint}`, attempt },
          response_data: { status: cancelResp.status, body: errBody.substring(0, 500) },
          success: false, error_message: lastError,
        });

        // If 400, check if it means already cancelled
        if (cancelResp.status === 400) {
          const lowerBody = errBody.toLowerCase();
          if (lowerBody.includes("отмен") || lowerBody.includes("cancel") || lowerBody.includes("already")) {
            console.log(`[${VERSION}] Invoice ${invoice} appears already cancelled based on error response`);
            cancelled = true;
            break;
          }
        }

        // Don't retry on 4xx (except 400 which we handled), only on 5xx or network issues
        if (cancelResp.status >= 400 && cancelResp.status < 500 && cancelResp.status !== 400) {
          break;
        }

        if (attempt < 3) await delay(2000 * attempt);
      }

      if (cancelled) {
        results.push({ invoice, success: true, spark_id: item.id });
      } else {
        results.push({ invoice, success: false, error: lastError });
      }
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
