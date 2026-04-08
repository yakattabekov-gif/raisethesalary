import { VERSION, parseStatusHistory, searchInvoice, getLogisticsInfo, resolveShipmentType } from "./helpers.ts";

export async function executeChangeShipmentType(
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
      // Check status — only allow if "Груз в пути" (206) is in state "waiting"
      const statusResp = await fetch(
        `https://gateway.spark.kz/cabinet/api/invoice-status/${encodeURIComponent(invoice)}`
      );
      if (!statusResp.ok) throw new Error(`Status check failed: ${statusResp.status}`);

      const statusData = await statusResp.json();
      console.log(`[${VERSION}] Invoice ${invoice} status for shipment_type change:`, JSON.stringify(statusData).substring(0, 500));

      const statuses = parseStatusHistory(statusData);
      const inTransit = statuses.find((s: any) => s.status_code === 206 || s.status_name === "Груз в пути");
      if (!inTransit || inTransit.state !== "waiting") {
        const currentState = inTransit ? inTransit.state : "not found";
        const errorMsg = inTransit
          ? `Статус "Груз в пути" не в состоянии waiting (текущее: ${currentState}) — смена типа перевозки невозможна`
          : `Статус "Груз в пути" (206) не найден — смена типа перевозки невозможна`;
        console.log(`[${VERSION}] Invoice ${invoice}: ${errorMsg}`);
        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "change_shipment_type", step: "status_check",
          request_data: { invoice }, response_data: { status: inTransit || "not_found" },
          success: false, error_message: errorMsg,
        });
        results.push({ invoice, success: false, error: errorMsg });
        continue;
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_shipment_type", step: "status_check",
        request_data: { invoice }, response_data: { status: inTransit, passed: true }, success: true,
      });

      const item = await searchInvoice(sparkUrl, sparkToken, invoice);
      const logisticsInfo = await getLogisticsInfo(sparkUrl, sparkToken, item.id);

      const currentShipmentType = resolveShipmentType(logisticsInfo.shipment_type);
      console.log(`[${VERSION}] Current shipment_type for ${invoice}: ${currentShipmentType}, requested: ${newShipmentType}`);

      const beforeState = { shipment_type: currentShipmentType };
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

      // Build full PUT payload preserving all fields
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

      const typeLabel = newShipmentType === 2 ? "Авиа" : "Авто";
      console.log(`[${VERSION}] PUT /logistics-info/${item.id} shipment_type change: ${logisticsInfo.shipment_type} → ${newShipmentType} (${typeLabel})`);
      const updateResp = await fetch(`${sparkUrl}/logistics-info/${item.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        throw new Error(`Update shipment_type failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_shipment_type", step: "update_shipment_type_api",
        request_data: { endpoint: `PUT ${sparkUrl}/logistics-info/${item.id}`, body: updatePayload },
        response_data: { status: updateResp.status, changes: afterState }, success: true,
      });

      results.push({ invoice, success: true, before: beforeState, after: afterState });
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
