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
      .in("key", ["spark_login_url", "spark_login_email", "spark_login_password"]);

    const settingsMap: Record<string, string> = {};
    settings?.forEach((s: any) => (settingsMap[s.key] = s.value));

    const loginUrl = settingsMap.spark_login_url || "https://bpms.spark.kz/api/login";
    const email = settingsMap.spark_login_email;
    const password = settingsMap.spark_login_password;

    if (!email || !password) {
      throw new Error("Spark login credentials not configured in settings");
    }

    // Decrypt password (base64 obfuscation layer)
    let decryptedPassword = password;
    try {
      decryptedPassword = atob(password);
    } catch {
      // If not base64, use as-is
    }

    console.log(`Attempting Spark login for: ${email}`);

    // Login to Spark BPMS
    const loginResponse = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ email, password: decryptedPassword }),
    });

    if (!loginResponse.ok) {
      const errorText = await loginResponse.text();
      throw new Error(`Spark login failed (${loginResponse.status}): ${errorText}`);
    }

    const loginData = await loginResponse.json();
    
    // Extract token - try common response structures
    const token = loginData.token || loginData.access_token || loginData.data?.token || loginData.data?.access_token;
    
    if (!token) {
      console.error("Login response:", JSON.stringify(loginData));
      throw new Error("No token found in Spark login response");
    }

    // Encode token for storage (base64 obfuscation)
    const encodedToken = btoa(token);

    // Update the bearer token in settings
    await supabaseAdmin
      .from("settings")
      .upsert(
        { key: "spark_bearer_token", value: encodedToken, category: "general" },
        { onConflict: "key" }
      );

    // Log the refresh
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
