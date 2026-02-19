import { VERSION, searchInvoice } from "./helpers.ts";

export async function executeRestoreOrder(
  supabase: any, settings: Record<string, string>, invoices: string[], taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;

  for (const invoice of invoices) {
    try {
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "restore_order", step: "search_invoice",
        request_data: { invoice },
        response_data: { id: item.id, status: item.status }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, spark_id: item.id });
        continue;
      }

      const restoreResp = await fetch(
        `${sparkUrl}/logistics-info/${item.id}/restore`,
        { method: "POST", headers: { Authorization: `Bearer ${sparkToken}` } }
      );
      const restoreBody = await restoreResp.text();
      if (!restoreResp.ok) {
        throw new Error(`Restore failed: ${restoreResp.status} - ${restoreBody}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "restore_order", step: "restore_invoice",
        request_data: { id: item.id },
        response_data: { status: restoreResp.status, body: restoreBody.substring(0, 500) }, success: true,
      });
      results.push({ invoice, success: true, spark_id: item.id });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "restore_order", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}
