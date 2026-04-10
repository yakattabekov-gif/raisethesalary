import { VERSION, searchInvoice } from "./helpers.ts";

export async function executeSetDeclaredPrice(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  const declaredPrice = aiResult.declared_price ?? null;
  const cargoName = aiResult.cargo_name || "-";

  for (const invoice of invoices) {
    try {
      // Search to get the invoice numeric ID
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);

      // The admin endpoint uses the invoice ID (numeric), not logistics-info ID
      // Search result item.id is the logistics-info ID, we need invoice_id
      const invoiceId = item.invoice_id || item.id;

      console.log(`[${VERSION}] set_declared_price ${invoice}: invoiceId=${invoiceId}, declaredPrice=${declaredPrice}, cargoName="${cargoName}"`);

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "set_declared_price", step: "search_invoice",
        request_data: { invoice },
        response_data: { invoice_id: invoiceId, item_id: item.id },
        success: true,
      });

      if (declaredPrice === null || declaredPrice === undefined) {
        throw new Error("declaredPrice not provided");
      }

      const payload = {
        declaredPrice: String(declaredPrice),
        cargoName: cargoName,
      };

      const beforeState = { declaredPrice: null, cargoName: null };
      const afterState = { declaredPrice: payload.declaredPrice, cargoName: payload.cargoName };

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "set_declared_price", step: "before_after",
        request_data: { before: beforeState },
        response_data: { after: afterState },
        success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, after: afterState });
        continue;
      }

      // Use the admin endpoint: PUT /admin/invoices/{invoiceId}/set-declared-price
      const adminUrl = (settings.spark_base_url || "https://gateway.spark.kz/cabinet/api/v2").replace("/v2", "").replace("/api/v2", "/api");
      const endpoint = `${adminUrl}/admin/invoices/${invoiceId}/set-declared-price`;

      console.log(`[${VERSION}] PUT ${endpoint}`, JSON.stringify(payload));
      const updateResp = await fetch(endpoint, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${sparkToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        throw new Error(`Set declared price failed: ${updateResp.status} - ${errBody}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "set_declared_price", step: "set_declared_price_api",
        request_data: { endpoint, body: payload },
        response_data: { status: updateResp.status },
        success: true,
      });

      results.push({ invoice, success: true, after: afterState });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "set_declared_price", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}
