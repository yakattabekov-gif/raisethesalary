import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get Spark login credentials from settings
    const { data: settings } = await supabaseAdmin
      .from("settings")
      .select("key, value")
      .in("key", [
        "spark_login_url",
        "spark_login_email",
        "spark_login_password",
        "spark_client_id",
        "spark_client_secret",
      ]);

    const s: Record<string, string> = {};
    settings?.forEach((r: any) => (s[r.key] = r.value));

    const loginUrl = s.spark_login_url || "https://gateway.spark.kz/oauth/token";
    const username = s.spark_login_email;
    const password = s.spark_login_password;
    const clientId = s.spark_client_id || "1";
    const clientSecret = s.spark_client_secret || "trnKSu6l3IIGH9IheQAgkdlB6ZJP2CtQXIPzPAjQ";

    if (!username || !password) {
      throw new Error("Spark login credentials not configured in settings");
    }

    console.log(`Attempting Spark OAuth login for: ${username}`);

    const loginResponse = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        username,
        password,
        client_id: Number(clientId),
        client_secret: clientSecret,
        grant_type: "password",
      }),
    });

    if (!loginResponse.ok) {
      const errorText = await loginResponse.text();
      throw new Error(`Spark login failed (${loginResponse.status}): ${errorText}`);
    }

    const loginData = await loginResponse.json();
    const token = loginData.access_token || loginData.token;

    if (!token) {
      console.error("Login response:", JSON.stringify(loginData));
      throw new Error("No access_token found in Spark login response");
    }

    // Store token as-is (no encoding)
    const encodedToken = token;

    await supabaseAdmin
      .from("settings")
      .upsert(
        { key: "spark_bearer_token", value: encodedToken, category: "general" },
        { onConflict: "key" }
      );

    await supabaseAdmin
      .from("settings")
      .upsert(
        { key: "spark_token_last_refresh", value: new Date().toISOString(), category: "general" },
        { onConflict: "key" }
      );

    console.log("Spark token refreshed successfully");

    return new Response(
      JSON.stringify({ success: true, message: "Token refreshed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Token refresh error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
