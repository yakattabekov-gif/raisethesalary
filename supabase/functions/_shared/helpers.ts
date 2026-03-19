export const VERSION = "v2.14.0";
export const TELEGRAM_CHAT_ID = "6645078966";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Normalize phone: 8XXXXXXXXXX → +7XXXXXXXXXX, also handle 7XXXXXXXXXX → +7XXXXXXXXXX
// Also fix AI hallucination: +777... (12 digits after +) → +7... (drop extra 7)
export function normalizePhone(phone: string): string {
  if (!phone) return phone;
  let digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("77")) {
    console.log(`[normalizePhone] Fixing AI hallucination: ${digits} → ${digits.slice(1)}`);
    digits = digits.slice(1);
  }
  if (/^8\d{10}$/.test(digits)) return `+7${digits.slice(1)}`;
  if (/^7\d{10}$/.test(digits)) return `+${digits}`;
  return `+${digits}`;
}

export function extractTextFromADF(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text || "";
  if (node.content && Array.isArray(node.content)) {
    const separator = node.type === "tableRow" ? "\n"
      : node.type === "tableCell" || node.type === "tableHeader" ? " "
      : node.type === "table" ? "\n"
      : node.type === "paragraph" ? "\n"
      : "";
    return node.content.map(extractTextFromADF).join(separator);
  }
  return "";
}

export function parseStatusHistory(statusData: any): any[] {
  if (Array.isArray(statusData)) return statusData;
  if (statusData && typeof statusData === "object") {
    if (Array.isArray(statusData.data?.status_history)) return statusData.data.status_history;
    if (Array.isArray(statusData.data)) return statusData.data;
    if (Array.isArray(statusData.statuses)) return statusData.statuses;
    if (Array.isArray(statusData.status_history)) return statusData.status_history;
    if (Array.isArray(statusData.result)) return statusData.result;
    return [statusData];
  }
  return [];
}

export async function checkOrderRestored(invoiceNumber: string, sparkToken: string): Promise<boolean> {
  try {
    const historyResp = await fetch(
      `https://gateway.spark.kz/cabinet/api/order-statuses/${encodeURIComponent(invoiceNumber)}/history`,
      { headers: { Authorization: `Bearer ${sparkToken}`, Accept: "application/json" } }
    );
    if (!historyResp.ok) {
      console.log(`[${VERSION}] order-statuses history failed for ${invoiceNumber}: ${historyResp.status}`);
      return false;
    }
    const historyData = await historyResp.json();
    console.log(`[${VERSION}] Order ${invoiceNumber} raw history sample:`, JSON.stringify(historyData).substring(0, 1500));
    const statuses = Array.isArray(historyData) ? historyData : (historyData.data || historyData.statuses || historyData.result || []);
    const statusCodes = statuses.map((s: any) => ({ code: s.status?.code || s.status_code || s.code, name: s.status?.name || s.status_name || s.name }));
    console.log(`[${VERSION}] Order ${invoiceNumber} history codes:`, JSON.stringify(statusCodes).substring(0, 1000));
    const hasRestoration = statuses.some((s: any) => (s.status?.code === 233) || (s.status_code === 233) || (s.code === 233));
    console.log(`[${VERSION}] Order ${invoiceNumber} history: ${statuses.length} statuses, restored=${hasRestoration}`);
    return hasRestoration;
  } catch (e: any) {
    console.warn(`[${VERSION}] Failed to check order restoration for ${invoiceNumber}: ${e.message}`);
    return false;
  }
}

export async function checkSenderStatusAllowed(
  invoice: string, sparkToken: string, supabase: any, taskId: string, actionName: string
): Promise<{ allowed: boolean; error?: string }> {
  const statusResp = await fetch(
    `https://gateway.spark.kz/cabinet/api/invoice-status/${encodeURIComponent(invoice)}`
  );
  if (!statusResp.ok) {
    return { allowed: false, error: `Status check failed: ${statusResp.status}` };
  }
  const statusData = await statusResp.json();
  console.log(`[${VERSION}] Invoice ${invoice} status for ${actionName}:`, JSON.stringify(statusData).substring(0, 500));
  const statuses = parseStatusHistory(statusData);
  const processingStatus = statuses.find((s: any) => s.status_code === 225 || s.status_name === "Обработка груза на складе");
  if (processingStatus && processingStatus.state === "completed") {
    const errorMsg = `Статус "Обработка груза на складе" (225) уже завершён — изменение отправителя невозможно`;
    console.log(`[${VERSION}] Invoice ${invoice}: ${errorMsg}`);
    await supabase.from("execution_logs").insert({
      task_id: taskId, action: actionName, step: "status_check",
      request_data: { invoice }, response_data: { status: processingStatus },
      success: false, error_message: errorMsg,
    });
    return { allowed: false, error: errorMsg };
  }
  await supabase.from("execution_logs").insert({
    task_id: taskId, action: actionName, step: "status_check",
    request_data: { invoice },
    response_data: { processing_status: processingStatus || "not_found", passed: true }, success: true,
  });
  return { allowed: true };
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return dp[m][n];
}

export function normalizeCityName(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[\s-]+/g, " ").trim();
}

export function findCity(name: string, allCities: any[]): { id: number; name: string } | null {
  const normalizedTarget = normalizeCityName(name);
  let bestMatch: any = null;
  let bestScore = Infinity;
  for (const city of allCities) {
    const normalizedName = normalizeCityName(city.name);
    if (normalizedName === normalizedTarget) return city;
    const dist = levenshtein(normalizedTarget, normalizedName);
    const maxLen = Math.max(normalizedTarget.length, normalizedName.length);
    const similarity = 1 - dist / maxLen;
    if (similarity > 0.6 && dist < bestScore) { bestScore = dist; bestMatch = city; }
  }
  return bestMatch;
}

export function stripCityFromAddress(addr: string, allCities?: any[]): string {
  if (!addr) return addr;
  const cityPattern = /^(?:г\.?\s*)?[А-Яа-яЁёA-Za-z\-]+\s*,\s*/;
  const match = addr.match(cityPattern);
  if (match) {
    const extracted = match[0].replace(/^г\.?\s*/, "").replace(/\s*,\s*$/, "").trim();
    const normalizedExtracted = extracted.toLowerCase().replace(/ё/g, "е");
    if (allCities) {
      const isCity = allCities.some((c: any) => {
        const norm = c.name.toLowerCase().replace(/ё/g, "е");
        return norm === normalizedExtracted || normalizedExtracted.includes(norm) || norm.includes(normalizedExtracted);
      });
      if (isCity) return addr.slice(match[0].length).trim();
    } else {
      // Without city list, assume it's a city
      return addr.slice(match[0].length).trim();
    }
  }
  return addr;
}

export function normalizeInvoiceNumber(invoice: string): string {
  if (!invoice) return invoice;
  // Strip trailing non-alphanumeric suffixes like "V", "v", etc.
  // Keep prefixes like KXT, SP, SLQ, AR
  return invoice.replace(/[A-Za-zА-Яа-яЁё]+$/g, "").trim();
}

export async function searchInvoice(sparkUrl: string, sparkToken: string, invoice: string) {
  const normalized = normalizeInvoiceNumber(invoice);
  if (normalized !== invoice) {
    console.log(`[${VERSION}] Normalized invoice: "${invoice}" → "${normalized}"`);
  }
  const searchResp = await fetch(
    `${sparkUrl}/admin/logistics-info?page=1&limit=50&search=${encodeURIComponent(normalized)}`,
    { headers: { Authorization: `Bearer ${sparkToken}` } }
  );
  if (!searchResp.ok) throw new Error(`Search failed: ${searchResp.status}`);
  const searchData = await searchResp.json();
  const items = searchData.data || searchData.items || searchData || [];
  const item = Array.isArray(items) ? items[0] : items;
  if (!item?.id) throw new Error("Invoice not found");
  return item;
}

export async function getLogisticsInfo(sparkUrl: string, sparkToken: string, itemId: string) {
  const fullResp = await fetch(
    `${sparkUrl}/logistics-info/${itemId}`,
    { headers: { Authorization: `Bearer ${sparkToken}`, Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; spark-bot/1.0)" } }
  );
  if (!fullResp.ok) {
    const errBody = await fullResp.text().catch(() => "");
    throw new Error(`GET logistics-info/${itemId} failed: ${fullResp.status} - ${errBody}`);
  }
  const fullData = await fullResp.json();
  return fullData.data || fullData;
}

// Resolve payment_type: API may return string ("Отправителем", "Получателем") or number
export function resolvePaymentType(val: any): number {
  if (val == null) return 2; // default: Получателем
  const num = Number(val);
  if (!isNaN(num) && num > 0) return num;
  const map: Record<string, number> = {
    "отправителем": 1, "sender": 1, "отправитель": 1,
    "получателем": 2, "receiver": 2, "получатель": 2,
  };
  const key = String(val).toLowerCase().trim();
  return map[key] ?? 2;
}

// Resolve payment_method: API may return string ("Наличными", "Kaspi", etc.) or number
export function resolvePaymentMethod(val: any): number {
  if (val == null) return 4; // default: Наличные
  const num = Number(val);
  if (!isNaN(num) && num > 0) return num;
  const map: Record<string, number> = {
    "накладная": 1, "накладной": 1, "invoice": 1,
    "kaspi": 2, "каспи": 2,
    "перевод": 3, "перечисление": 3, "перечислением": 3, "перечислением на счет": 3, "transfer": 3,
    "наличные": 4, "наличными": 4, "cash": 4, "наличка": 4,
  };
  const key = String(val).toLowerCase().trim();
  return map[key] ?? 4;
}

// Resolve shipment_type: API may return string ("Стандарт", "Экспресс", "Авиа") or number
export function resolveShipmentType(val: any): number {
  if (val == null) return 1;
  const num = Number(val);
  if (!isNaN(num) && num > 0) return num;
  const map: Record<string, number> = {
    "стандарт": 1, "standard": 1,
    "экспресс": 2, "express": 2,
    "авиа": 3, "avia": 3, "air": 3,
  };
  const key = String(val).toLowerCase().trim();
  return map[key] ?? 1;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fetch field config for an action — returns Set of mutable field names
export async function getMutableFields(supabase: any, action: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("endpoint_field_config")
    .select("field_name, is_mutable")
    .eq("action", action);
  if (!data || data.length === 0) {
    // No config = all fields mutable (backward compat)
    return new Set(["__all__"]);
  }
  const mutable = new Set<string>();
  for (const row of data) {
    if (row.is_mutable) mutable.add(row.field_name);
  }
  return mutable;
}

// Check if field is mutable based on config
export function isFieldMutable(mutableFields: Set<string>, fieldName: string): boolean {
  if (mutableFields.has("__all__")) return true;
  return mutableFields.has(fieldName);
}
