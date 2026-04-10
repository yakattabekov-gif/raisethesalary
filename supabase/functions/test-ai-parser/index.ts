import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Inline minimal AI call for testing (no DB logging)
async function testParseWithAI(
  provider: string, apiKey: string, systemPrompt: string, summary: string, description: string
): Promise<any> {
  let url: string, headers: Record<string, string>, body: any;

  if (provider === "claude") {
    url = "https://api.anthropic.com/v1/messages";
    headers = { "x-api-key": apiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" };
    body = { model: "claude-sonnet-4-20250514", max_tokens: 4096, system: systemPrompt, messages: [{ role: "user", content: `Тема: ${summary}\n\nОписание: ${description}` }], temperature: 0 };
  } else if (provider === "lovable") {
    url = "https://ai.gateway.lovable.dev/v1/chat/completions";
    headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    body = { model: "google/gemini-2.5-flash", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Тема: ${summary}\n\nОписание: ${description}` }], temperature: 0 };
  } else {
    url = "https://api.openai.com/v1/chat/completions";
    headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    body = { model: "gpt-4o-mini", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Тема: ${summary}\n\nОписание: ${description}` }], temperature: 0 };
  }

  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!resp.ok) { const t = await resp.text(); throw new Error(`${provider} API error ${resp.status}: ${t}`); }
  const data = await resp.json();
  const content = provider === "claude" ? data.content?.[0]?.text || "" : data.choices?.[0]?.message?.content || "";

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { return { raw: content, parse_error: true }; }
  }
  return { raw: content, no_json: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Get settings
    const { data: settingsData } = await supabase.from("settings").select("key, value");
    const settings: Record<string, string> = {};
    for (const s of settingsData || []) settings[s.key] = s.value;

    const provider = (settings.ai_provider || "openai").toLowerCase();
    let apiKey: string;
    if (provider === "claude") apiKey = settings.claude_api_key;
    else if (provider === "lovable") apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    else apiKey = settings.openai_api_key;

    if (!apiKey) throw new Error(`No API key for provider: ${provider}`);

    // Get the system prompt (same as ai-parser.ts)
    const { parseWithAI } = await import("../_shared/ai-parser.ts");
    // We can't import getBuiltInPrompt directly, so we'll just use a simpler approach
    // We'll read the custom prompt from settings
    const customPrompt = settings.ai_system_prompt;

    const body = await req.json();
    const tests: Array<{ id: number; summary: string; desc: string; expect: string }> = body.tests || [];

    if (tests.length === 0) {
      return new Response(JSON.stringify({ error: "No tests provided" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Process tests sequentially to avoid rate limiting
    const results: any[] = [];
    for (const test of tests) {
      try {
        // Use full parseWithAI pipeline (stage 1 only for speed - create a dummy task id)
        const dummyTaskId = `test-${test.id}`;
        // Just call stage 1 directly for speed
        const result = await testParseWithAI(provider, apiKey, getPrompt(customPrompt), test.summary, test.desc);
        
        const actions = result.actions || [];
        const actionTypes = actions.map((a: any) => a.action).join(", ") || "EMPTY";
        const pass = checkExpectation(test.expect, result);

        results.push({
          id: test.id,
          summary: test.summary,
          desc: test.desc.substring(0, 100),
          expect: test.expect,
          got: actionTypes,
          pass,
          details: result,
        });
        console.log(`Test ${test.id}: ${pass ? "✅" : "❌"} expect="${test.expect}" got="${actionTypes}"`);
      } catch (e: any) {
        results.push({ id: test.id, error: e.message, pass: false });
        console.log(`Test ${test.id}: ❌ ERROR: ${e.message}`);
      }
    }

    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    const summary = { total: results.length, passed, failed, rate: `${Math.round(passed / results.length * 100)}%` };

    return new Response(JSON.stringify({ summary, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function checkExpectation(expect: string, result: any): boolean {
  const actions = result.actions || [];
  const types = actions.map((a: any) => a.action);
  const ex = expect.toLowerCase();

  if (ex.includes("ignore") || ex.includes("empty actions")) return actions.length === 0;
  if (ex.includes("cancel") && !types.includes("cancel")) return false;
  if (ex.includes("update_receiver") && !types.includes("update_receiver")) return false;
  if (ex.includes("update_sender") && !types.includes("update_sender")) return false;
  if (ex.includes("update_payment") && !types.includes("update_payment")) return false;
  if (ex.includes("change_direction") && !types.includes("change_direction")) return false;
  if (ex.includes("self_delivery") && !types.includes("self_delivery")) return false;
  if (ex.includes("self_pickup") && !types.includes("self_pickup")) return false;
  if (ex.includes("set_declared_price") && !types.includes("set_declared_price")) return false;
  if (ex.includes("change_shipment_type") && !types.includes("change_shipment_type")) return false;
  if (ex.includes("restore_order") && !types.includes("restore_order")) return false;
  if (ex.includes("3 invoices")) {
    const allInvoices = actions.flatMap((a: any) => a.invoices || []);
    if (allInvoices.length < 3) return false;
  }
  if (ex.includes("2x")) {
    const relevantType = ex.includes("payment") ? "update_payment" : null;
    if (relevantType && types.filter((t: string) => t === relevantType).length < 2) return false;
  }
  if (ex.includes("method=2")) {
    const payment = actions.find((a: any) => a.action === "update_payment")?.payment;
    if (!payment || payment.payment_method !== 2) return false;
  }
  if (ex.includes("method=4")) {
    const payment = actions.find((a: any) => a.action === "update_payment")?.payment;
    if (!payment || payment.payment_method !== 4) return false;
  }
  if (ex.includes("cod=0")) {
    const payment = actions.find((a: any) => a.action === "update_payment")?.payment;
    if (!payment || payment.cod_payment !== 0) return false;
  }
  if (ex.includes("cod=50000")) {
    const payment = actions.find((a: any) => a.action === "update_payment")?.payment;
    if (!payment || payment.cod_payment !== 50000) return false;
  }

  // Basic: at least has the expected action type
  return actions.length > 0 || ex.includes("ignore");
}

function getPrompt(customPrompt?: string): string {
  // Duplicated from ai-parser.ts getBuiltInPrompt for independence
  const base = `Ты — отказоустойчивый AI-парсер заявок Spark уровня senior + QA.
Твоя задача: понять → извлечь → проверить → перепроверить → вернуть JSON.

# 🔴 ГЛАВНОЕ ПРАВИЛО
Ты НЕ доверяешь своему первому ответу.

# ⚙️ ОБЯЗАТЕЛЬНЫЙ АЛГОРИТМ (внутренние шаги, НЕ выводить):
## ШАГ 1 — Найди действия (только текстом, не JSON)
## ШАГ 2 — Создай JSON
## ШАГ 3 — СОЗДАЙ JSON ЕЩЁ РАЗ С НУЛЯ
## ШАГ 4 — СРАВНИ оба JSON. Если отличаются → выбери более логичный.
## ШАГ 5 — SELF-CHECK

# 🚫 АНТИ-ГАЛЛЮЦИНАЦИЯ
ЗАПРЕЩЕНО: придумывать данные, додумывать контекст, интерпретировать неоднозначно.
Если не уверен → null

# 📋 ПРАВИЛО: НЕ МЕНЯЛ = null

# 📊 CONFIDENCE
Начни с 1.0: -0.2 нет накладной, -0.2 неоднозначность, -0.2 несколько действий, -0.3 конфликт
Если < 0.7 → needs_review: true

# 🚨 HARD REJECT
Если нет накладной или конфликт: {"actions": [], "rejected": true}

# 🔴 ОБЯЗАТЕЛЬНЫЕ ПОЛЯ
Каждый action ОБЯЗАН содержать "invoices"!

═══════════════════════════════════════
Поддерживаемые действия:
═══════════════════════════════════════
1. ОТМЕНА (action: "cancel") — "отменить", "отмена", "аннулировать"
2. СМЕНА АДРЕСА ДОСТАВКИ (action: "update_receiver") — адрес/телефон/ФИО получателя
3. СМЕНА ДАННЫХ ПОЛУЧАТЕЛЯ (action: "update_receiver") — телефон, доп номер
4. СМЕНА ОПЛАТЫ (action: "update_payment") — способ/тип оплаты, сумма, НП
5. СМЕНА НАПРАВЛЕНИЯ (action: "change_direction") — город назначения
6. СМЕНА ТИПА ПЕРЕВОЗКИ (action: "change_shipment_type") — авто/авиа
7. СМЕНА АДРЕСА ОТПРАВИТЕЛЯ (action: "update_sender") — ЭТО ПОДДЕРЖИВАЕТСЯ!
8. СМЕНА НАПРАВЛЕНИЯ ОТПРАВИТЕЛЯ (action: "change_sender_direction")
9. СМЕНА НОМЕРА АВР (action: "change_act_number")
10. ВОССТАНОВЛЕНИЕ (action: "restore_order")
11. САМОПРИВОЗ (action: "self_delivery") — клиент привозит на склад ОТПРАВИТЕЛЯ
12. САМОВЫВОЗ (action: "self_pickup") — клиент забирает со склада ПОЛУЧАТЕЛЯ
13. ОБЪЯВЛЕННАЯ СТОИМОСТЬ / СТРАХОВКА (action: "set_declared_price") — установить объявленную стоимость (страховку). Фразы: "объявленная стоимость", "страховка", "застраховать", "стоимость груза". Поля: declared_price (число), cargo_name (название товара или "-")
    ⚠️ "объявленная стоимость" — это НЕ оплата! Это страховка! НЕ путать с update_payment!

РАЗЛИЧАЙ:
- "Закрыть ДК" / "Удалить ДК" / "Верификация" → ИГНОРИРУЙ!
- "Филиал доставки сделать {город}" = change_direction
- "Самопривоз" → self_delivery
- "Самовывоз" → self_pickup
- "объявленная стоимость" / "страховка" → set_declared_price (НЕ update_payment!)

💰 ОПЛАТА:
- "каспи/каспий" → payment_method: 2, payment_type: 2
- "наличка/наличные" → payment_method: 4
- "перевод" → payment_method: 3
- "убрать НП" → cod_payment: 0
- "наложка XXXX" → cod_payment: XXXX

📦 ОБЪЯВЛЕННАЯ СТОИМОСТЬ (СТРАХОВКА):
- "объявленная стоимость 315000" → {"action": "set_declared_price", "declared_price": 315000, "cargo_name": "-"}
- "страховка 50000 товар электроника" → {"action": "set_declared_price", "declared_price": 50000, "cargo_name": "электроника"}

📞 ТЕЛЕФОНЫ: 8XXXXXXXXXX → +7XXXXXXXXXX

📤 Верни ТОЛЬКО JSON:
{"actions": [...], "confidence": 0-1, "needs_review": boolean}`;

  if (customPrompt && customPrompt.trim().length > 10) {
    return `${base}\n\n# 📌 ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:\n${customPrompt.trim()}`;
  }
  return base;
}
