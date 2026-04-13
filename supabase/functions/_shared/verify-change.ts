import { VERSION, getLogisticsInfo, resolvePaymentType, resolvePaymentMethod, resolveShipmentType } from "./helpers.ts";

/**
 * After a PUT to /receivers/{id} or /senders/{id}, re-fetch logistics-info
 * and verify the changes actually took effect.
 */

export async function verifyReceiverChange(
  sparkUrl: string, sparkToken: string, logisticsInfoId: string | number,
  expectedFields: Record<string, any>, supabase: any, taskId: string, action: string
): Promise<{ verified: boolean; actual: Record<string, any>; mismatches: string[] }> {
  await new Promise(r => setTimeout(r, 1500)); // Wait for propagation
  
  const info = await getLogisticsInfo(sparkUrl, sparkToken, logisticsInfoId);
  const receiver = info.receiver || info;
  
  return compareFields(receiver, expectedFields, supabase, taskId, action, "verify_receiver");
}

export async function verifySenderChange(
  sparkUrl: string, sparkToken: string, logisticsInfoId: string | number,
  expectedFields: Record<string, any>, supabase: any, taskId: string, action: string
): Promise<{ verified: boolean; actual: Record<string, any>; mismatches: string[] }> {
  await new Promise(r => setTimeout(r, 1500));
  
  const info = await getLogisticsInfo(sparkUrl, sparkToken, logisticsInfoId);
  const sender = info.sender || {};
  
  return compareFields(sender, expectedFields, supabase, taskId, action, "verify_sender");
}

export async function verifyLogisticsInfoChange(
  sparkUrl: string, sparkToken: string, logisticsInfoId: string | number,
  expectedFields: Record<string, any>, supabase: any, taskId: string, action: string
): Promise<{ verified: boolean; actual: Record<string, any>; mismatches: string[] }> {
  await new Promise(r => setTimeout(r, 1500));
  
  const info = await getLogisticsInfo(sparkUrl, sparkToken, logisticsInfoId);
  
  return compareFields(info, expectedFields, supabase, taskId, action, "verify_logistics_info");
}

async function compareFields(
  actualData: any, expectedFields: Record<string, any>,
  supabase: any, taskId: string, action: string, step: string
): Promise<{ verified: boolean; actual: Record<string, any>; mismatches: string[] }> {
  const mismatches: string[] = [];
  const actual: Record<string, any> = {};

  for (const [key, expectedValue] of Object.entries(expectedFields)) {
    const actualValue = actualData[key];
    actual[key] = actualValue;

    // Normalize for comparison, passing field name for type-aware resolution
    const normalizedExpected = normalize(expectedValue, key);
    const normalizedActual = normalize(actualValue, key);

    if (normalizedExpected !== normalizedActual) {
      mismatches.push(`${key}: expected=${JSON.stringify(expectedValue)}, actual=${JSON.stringify(actualValue)}`);
    }
  }

  const verified = mismatches.length === 0;
  
  await supabase.from("execution_logs").insert({
    task_id: taskId, action, step,
    request_data: { expected: expectedFields },
    response_data: { actual, mismatches },
    success: verified,
    error_message: verified ? null : `Верификация не прошла: ${mismatches.join("; ")}`,
  });

  if (!verified) {
    console.error(`[${VERSION}] VERIFICATION FAILED for ${action}: ${mismatches.join("; ")}`);
  } else {
    console.log(`[${VERSION}] Verification passed for ${action}: all ${Object.keys(expectedFields).length} fields match`);
  }

  return { verified, actual, mismatches };
}

function normalize(val: any, fieldName?: string): string {
  if (val === null || val === undefined) return "";
  
  // For payment/shipment fields, resolve strings to numbers for consistent comparison
  if (fieldName === "payment_type") return String(resolvePaymentType(val));
  if (fieldName === "payment_method") return String(resolvePaymentMethod(val));
  if (fieldName === "shipment_type") return String(resolveShipmentType(val));
  
  if (typeof val === "number") return String(val);
  if (typeof val === "string") {
    // Try numeric comparison for numeric strings
    const num = Number(val);
    if (!isNaN(num)) return String(num);
    return val.trim().toLowerCase();
  }
  return JSON.stringify(val);
}
