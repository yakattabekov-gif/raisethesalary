import { VERSION, searchInvoice } from "./helpers.ts";

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

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, spark_id: item.id });
        continue;
      }

      const cancelResp = await fetch(
        `${sparkUrl}/logistics-info/${item.id}/cancel`,
        { method: "POST", headers: { Authorization: `Bearer ${sparkToken}` } }
      );
      if (!cancelResp.ok) throw new Error(`Cancel failed: ${cancelResp.status}`);

      const cancelEndpoint = `${sparkUrl}/logistics-info/${item.id}/cancel`;
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "cancel", step: "cancel_invoice",
        request_data: { endpoint: `POST ${cancelEndpoint}`, body: null },
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
