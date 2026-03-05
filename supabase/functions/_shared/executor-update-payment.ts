import { VERSION, searchInvoice, getLogisticsInfo, resolveShipmentType, getMutableFields, isFieldMutable } from "./helpers.ts";

export async function executeUpdatePayment(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  const paymentData = aiResult.payment || {};

  const mutable = await getMutableFields(supabase, "update_payment");
  console.log(`[${VERSION}] update_payment mutable fields: ${[...mutable].join(", ")}`);

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
          current_cod_payment: logisticsInfo.cod_payment,
          current_shipment_type: logisticsInfo.shipment_type,
        },
        success: true,
      });

      // Base payload — always preserve from GET
      const updatePayload: any = {
        additional_service: logisticsInfo.additional_service || { hasCar: false, hasSoftPackage: false, hasRisingToTheFloor: false, hasManipulator: false, hasCrane: false, hasHydraulicTrolley: false, hasGrid: false, hasLoader: false, hasPallet: false },
        product_name: isFieldMutable(mutable, "product_name") ? (logisticsInfo.product_name || "-") : (logisticsInfo.product_name || "-"),
        dop_invoice_number: logisticsInfo.dop_invoice_number || null,
        annotation: isFieldMutable(mutable, "annotation") ? (logisticsInfo.annotation || null) : (logisticsInfo.annotation || null),
        declared_price: isFieldMutable(mutable, "declared_price") ? (Number(logisticsInfo.declared_price) || 0) : (Number(logisticsInfo.declared_price) || 0),
        take_date: logisticsInfo.take_date || new Date().toISOString().split("T")[0],
        period_id: isFieldMutable(mutable, "period_id") ? (Number(logisticsInfo.period_id) || 3) : (Number(logisticsInfo.period_id) || 3),
        places: isFieldMutable(mutable, "places") ? (Number(logisticsInfo.places) || 1) : (Number(logisticsInfo.places) || 1),
        weight: isFieldMutable(mutable, "weight") ? (Number(logisticsInfo.weight) || 0) : (Number(logisticsInfo.weight) || 0),
        width: isFieldMutable(mutable, "width") ? (Number(logisticsInfo.width) || 0) : (Number(logisticsInfo.width) || 0),
        height: isFieldMutable(mutable, "height") ? (Number(logisticsInfo.height) || 0) : (Number(logisticsInfo.height) || 0),
        depth: isFieldMutable(mutable, "depth") ? (Number(logisticsInfo.depth) || 0) : (Number(logisticsInfo.depth) || 0),
        volume: isFieldMutable(mutable, "volume") ? (Number(logisticsInfo.volume) || 0) : (Number(logisticsInfo.volume) || 0),
        cargo_name: logisticsInfo.cargo_name || null,
        should_return_document: Number(logisticsInfo.should_return_document) || 0,
        shipment_type: resolveShipmentType(logisticsInfo.shipment_type),
        verify: logisticsInfo.verify || null,
        is_dangerous: Number(logisticsInfo.is_dangerous) || 0,
        temperature_regime_type_id: logisticsInfo.temperature_regime_type_id || null,
        invoice_files: logisticsInfo.invoice_files || [],
        certificate_of_safety_files: logisticsInfo.certificate_of_safety_files || [],
        temperature_regime_safety_files: logisticsInfo.temperature_regime_safety_files || [],
      };

      // Determine if this is a cod_payment-only change (НП / наложка)
      const isCodOnly = (paymentData.cod_payment !== null && paymentData.cod_payment !== undefined)
        && (paymentData.payment_type === null || paymentData.payment_type === undefined)
        && (paymentData.payment_method === null || paymentData.payment_method === undefined)
        && (paymentData.cash_sum === null || paymentData.cash_sum === undefined);

      if (isCodOnly) {
        console.log(`[${VERSION}] update_payment ${invoice}: COD-only change detected, preserving payment_type/method/cash_sum`);
      }

      // cod_payment: only change if mutable AND this is a COD-specific change (isCodOnly)
      // OR if AI explicitly provided a positive cod_payment value
      // NEVER send 0 for cod_payment unless explicitly asked to remove НП (isCodOnly with cod_payment=0)
      if (isCodOnly && isFieldMutable(mutable, "cod_payment") && paymentData.cod_payment !== null && paymentData.cod_payment !== undefined) {
        // Explicit COD change (add/remove НП)
        updatePayload.cod_payment = Number(paymentData.cod_payment);
      } else if (!isCodOnly && isFieldMutable(mutable, "cod_payment") && paymentData.cod_payment !== null && paymentData.cod_payment !== undefined && Number(paymentData.cod_payment) > 0) {
        // Non-COD change but AI provided a positive cod_payment — apply it
        updatePayload.cod_payment = Number(paymentData.cod_payment);
      } else {
        // Preserve original cod_payment
        updatePayload.cod_payment = Number(logisticsInfo.cod_payment) || 0;
      }

      // payment_type: only change if mutable AND AI provided a non-null value AND this is NOT a cod-only change
      if (!isCodOnly && isFieldMutable(mutable, "payment_type") && paymentData.payment_type !== null && paymentData.payment_type !== undefined) {
        updatePayload.payment_type = Number(paymentData.payment_type);
      } else {
        updatePayload.payment_type = Number(logisticsInfo.payment_type ?? 2);
      }

      // payment_method: only change if mutable AND AI provided a non-null value AND this is NOT a cod-only change
      if (!isCodOnly && isFieldMutable(mutable, "payment_method") && paymentData.payment_method !== null && paymentData.payment_method !== undefined) {
        updatePayload.payment_method = Number(paymentData.payment_method);
      } else {
        updatePayload.payment_method = Number(logisticsInfo.payment_method ?? 4);
      }

      // cash_sum: only change if mutable AND AI provided a non-null value AND this is NOT a cod-only change
      if (!isCodOnly && isFieldMutable(mutable, "cash_sum") && paymentData.cash_sum !== null && paymentData.cash_sum !== undefined) {
        updatePayload.cash_sum = paymentData.cash_sum;
      } else {
        updatePayload.cash_sum = logisticsInfo.cash_sum || 0;
      }

      const beforeState = {
        payment_type: logisticsInfo.payment_type,
        payment_method: logisticsInfo.payment_method,
        cash_sum: logisticsInfo.cash_sum,
        cod_payment: logisticsInfo.cod_payment,
      };
      const afterState = {
        payment_type: updatePayload.payment_type,
        payment_method: updatePayload.payment_method,
        cash_sum: updatePayload.cash_sum,
        cod_payment: updatePayload.cod_payment,
      };

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_payment", step: "before_after",
        request_data: { before: beforeState, mutable_fields: [...mutable] },
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
        request_data: { endpoint: `PUT ${sparkUrl}/logistics-info/${item.id}`, body: updatePayload },
        response_data: { status: updateResp.status }, success: true,
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
