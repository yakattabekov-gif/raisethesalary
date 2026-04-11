import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/helpers.ts";
import { getBuiltInPrompt } from "../_shared/ai-parser.ts";

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

  // Empty/ignore checks
  if (ex.includes("ignore") || ex.includes("empty actions") || ex.includes("rejected")) {
    return actions.length === 0 || result.rejected === true;
  }

  // Action type checks — support "NOT" prefix
  const actionChecks: [string, string][] = [
    ["cancel", "cancel"],
    ["update_receiver", "update_receiver"],
    ["update_sender", "update_sender"],
    ["update_payment", "update_payment"],
    ["change_direction", "change_direction"],
    ["change_sender_direction", "change_sender_direction"],
    ["self_delivery", "self_delivery"],
    ["self_pickup", "self_pickup"],
    ["set_declared_price", "set_declared_price"],
    ["change_shipment_type", "change_shipment_type"],
    ["restore_order", "restore_order"],
    ["change_act_number", "change_act_number"],
  ];

  for (const [keyword, actionType] of actionChecks) {
    if (ex.includes(`not ${keyword}`)) {
      if (types.includes(actionType)) return false;
    } else if (ex.includes(keyword)) {
      if (!types.includes(actionType)) return false;
    }
  }

  // Invoice count checks
  const invoiceCountMatch = ex.match(/(\d+)\s*invoices?/);
  if (invoiceCountMatch) {
    const expected = parseInt(invoiceCountMatch[1]);
    const allInvoices = actions.flatMap((a: any) => a.invoices || []);
    if (allInvoices.length < expected) return false;
  }

  // Multiple action checks (2x, 3x)
  const multiMatch = ex.match(/(\d+)x\s*(\w+)/);
  if (multiMatch) {
    const count = parseInt(multiMatch[1]);
    const type = multiMatch[2];
    if (types.filter((t: string) => t === type).length < count) return false;
  }

  // Payment field checks
  const methodMatch = ex.match(/method=(\d+)/);
  if (methodMatch) {
    const expected = parseInt(methodMatch[1]);
    const payment = actions.find((a: any) => a.action === "update_payment")?.payment;
    if (!payment || payment.payment_method !== expected) return false;
  }
  const typeMatch = ex.match(/type=(\d+)/);
  if (typeMatch) {
    const expected = parseInt(typeMatch[1]);
    const payment = actions.find((a: any) => a.action === "update_payment")?.payment;
    if (!payment || payment.payment_type !== expected) return false;
  }
  const codMatch = ex.match(/cod=(\d+)/);
  if (codMatch) {
    const expected = parseInt(codMatch[1]);
    const payment = actions.find((a: any) => a.action === "update_payment")?.payment;
    if (!payment || payment.cod_payment !== expected) return false;
  }
  const cashMatch = ex.match(/cash=(\d+)/);
  if (cashMatch) {
    const expected = parseInt(cashMatch[1]);
    const payment = actions.find((a: any) => a.action === "update_payment")?.payment;
    if (!payment || payment.cash_sum !== expected) return false;
  }

  // City checks
  const cityMatch = ex.match(/city="([^"]+)"/);
  if (cityMatch) {
    const expectedCity = cityMatch[1].toLowerCase();
    const hasCity = actions.some((a: any) => 
      (a.city && a.city.toLowerCase().includes(expectedCity)) ||
      (a.to_city && a.to_city.toLowerCase().includes(expectedCity))
    );
    if (!hasCity) return false;
  }

  // from_city check
  const fromCityMatch = ex.match(/from_city="([^"]+)"/);
  if (fromCityMatch) {
    const expectedFrom = fromCityMatch[1].toLowerCase();
    const hasFrom = actions.some((a: any) => 
      a.from_city && a.from_city.toLowerCase().includes(expectedFrom)
    );
    if (!hasFrom) return false;
  }

  // declared_price check
  const priceMatch = ex.match(/price=(\d+)/);
  if (priceMatch) {
    const expected = parseInt(priceMatch[1]);
    const hasPrice = actions.some((a: any) => a.declared_price === expected);
    if (!hasPrice) return false;
  }

  return actions.length > 0 || ex.includes("ignore");
}

function getPrompt(customPrompt?: string): string {
  const base = getBuiltInPrompt();
  if (customPrompt && customPrompt.trim().length > 10) {
    return `${base}\n\n# 📌 ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:\n${customPrompt.trim()}`;
  }
  return base;
}
