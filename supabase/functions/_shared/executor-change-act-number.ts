import { VERSION } from "./helpers.ts";

export async function executeChangeActNumber(
  supabase: any, settings: Record<string, string>, actionItem: any, taskId: string, dryRun: boolean
) {
  const results: any[] = [];
  const sparkToken = settings.spark_bearer_token;
  const actNumber = actionItem.act_number;
  const ftlOrderIds: string[] = actionItem.ftl_order_ids || [];

  try {
    if (!actNumber) throw new Error("Номер АВР не указан");

    const validIds = ftlOrderIds.filter((id: string) => /^\d{4,5}$/.test(String(id)));
    if (validIds.length === 0) throw new Error("Нет валидных ФТЛ ID (каждый должен быть 4-5 цифр)");

    const invalidIds = ftlOrderIds.filter((id: string) => !/^\d{4,5}$/.test(String(id)));
    if (invalidIds.length > 0) {
      console.log(`[${VERSION}] Skipping invalid FTL IDs: ${invalidIds.join(", ")}`);
    }

    await supabase.from("execution_logs").insert({
      task_id: taskId, action: "change_act_number", step: "validate",
      request_data: { act_number: actNumber, ftl_order_ids: ftlOrderIds, valid_ids: validIds },
      response_data: { valid_count: validIds.length, invalid_ids: invalidIds }, success: true,
    });

    if (dryRun) {
      results.push({ success: true, dry_run: true, act_number: actNumber, ftl_order_ids: validIds });
      return results;
    }

    const payload = { actNumber, ftlOrderIds: validIds };
    console.log(`[${VERSION}] PUT mass-change-act-number: ${JSON.stringify(payload)}`);

    const resp = await fetch(
      `https://gateway.spark.kz/cabinet/api/v2/admin/ftl-orders/mass-change-act-number`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const respText = await resp.text();
    let respData: any;
    try { respData = JSON.parse(respText); } catch { respData = { raw: respText }; }

    await supabase.from("execution_logs").insert({
      task_id: taskId, action: "change_act_number", step: "api_call",
      request_data: { endpoint: `PUT https://gateway.spark.kz/cabinet/api/v2/admin/ftl-orders/mass-change-act-number`, body: payload },
      response_data: respData, success: resp.ok,
      error_message: resp.ok ? null : `HTTP ${resp.status}: ${respText.substring(0, 300)}`,
    });

    if (!resp.ok) throw new Error(`API error ${resp.status}: ${respText.substring(0, 300)}`);

    results.push({ success: true, act_number: actNumber, ftl_order_ids: validIds, response: respData });
  } catch (e: any) {
    await supabase.from("execution_logs").insert({
      task_id: taskId, action: "change_act_number", step: "error",
      success: false, error_message: e.message,
      request_data: { act_number: actNumber, ftl_order_ids: ftlOrderIds },
    });
    results.push({ success: false, error: e.message });
  }

  return results;
}
