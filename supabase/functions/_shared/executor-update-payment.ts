import { VERSION, searchInvoice, getLogisticsInfo } from "./helpers.ts";

export async function executeUpdatePayment(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  const paymentData = aiResult.payment || {};

  for (const invoice of invoices) {
    try {
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);
      const logisticsInfo = await getLogisticsInfo(sparkUrl, sparkToken, item.id);

      console.log(`[${VERSION}] update_payment ${invoice}: shipment_type raw="${logisticsInfo.shipment_type}" (type=${typeof logisticsInfo.shipment_type}), payment_type=${logisticsInfo.payment_type}`);

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_payment", step: "get_logistics_info",
        request_data: { invoice, logistics_info_id: item.id },
        response_data: {
          current_payment_type: logisticsInfo.payment_type,
          current_payment_method: logisticsInfo.payment_method,
          current_cash_sum: logisticsInfo.cash_sum,
          current_shipment_type: logisticsInfo.shipment_type,
        },
        success: true,
      });

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
        shipment_type: (logisticsInfo.shipment_type != null && Number(logisticsInfo.shipment_type) > 0) ? Number(logisticsInfo.shipment_type) : 1,
        payment_type: Number(paymentData.payment_type ?? logisticsInfo.payment_type ?? 2),
        payment_method: Number(paymentData.payment_method ?? logisticsInfo.payment_method ?? 4),
        verify: logisticsInfo.verify || null,
        is_dangerous: Number(logisticsInfo.is_dangerous) || 0,
        temperature_regime_type_id: logisticsInfo.temperature_regime_type_id || null,
        invoice_files: logisticsInfo.invoice_files || [],
        certificate_of_safety_files: logisticsInfo.certificate_of_safety_files || [],
        temperature_regime_safety_files: logisticsInfo.temperature_regime_safety_files || [],
      };

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

      console.log(`[${VERSION}] PUT /logistics-info/${item.id} payment update:`, JSON.stringify(afterState));
      const updateResp = await fetch(`${sparkUrl}/logistics-info/${item.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
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

      results.push({ invoice, success: true, before: beforeState, after: afterState });
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
