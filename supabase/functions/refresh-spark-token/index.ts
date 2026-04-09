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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Auth: allow service-role (cron) or admin user
    const authHeader = req.headers.get("Authorization") || "";
    const bearerToken = authHeader.replace("Bearer ", "");
    const isServiceRole = bearerToken === serviceRoleKey;

    if (!isServiceRole) {
      if (!bearerToken) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: claimsData, error: claimsError } = await supabaseAdmin.auth.getUser(bearerToken);
      if (claimsError || !claimsData?.user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roles } = await supabaseAdmin
        .from("user_roles").select("role")
        .eq("user_id", claimsData.user.id).eq("role", "admin");
      if (!roles?.length) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Get Spark login credentials from settings
    const { data: settings } = await supabaseAdmin
      .from("settings").select("key, value")
      .in("key", ["spark_login_url", "spark_login_email", "spark_login_password", "spark_client_id", "spark_client_secret"]);

    const s: Record<string, string> = {};
    settings?.forEach((r: any) => (s[r.key] = r.value));

    const loginUrl = s.spark_login_url || "https://gateway.spark.kz/oauth/token";
    const username = s.spark_login_email;
    const password = s.spark_login_password;
    const clientId = s.spark_client_id || "1";
    const clientSecret = s.spark_client_secret;

    if (!username || !password || !clientSecret) {
      throw new Error("Spark login credentials not configured in settings");
    }

    console.log(`[refresh-spark-token] Attempting login for: ${username}`);

    const loginResponse = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
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
    const accessToken = loginData.access_token;

    if (!accessToken) {
      console.error("Login response:", JSON.stringify(loginData));
      throw new Error("No access_token found in Spark login response");
    }

    // Store token and refresh timestamp
    await supabaseAdmin.from("settings").upsert(
      { key: "spark_bearer_token", value: accessToken, category: "general" },
      { onConflict: "key" }
    );
    await supabaseAdmin.from("settings").upsert(
      { key: "spark_token_last_refresh", value: new Date().toISOString(), category: "general" },
      { onConflict: "key" }
    );

    // Store expires_in for reference
    if (loginData.expires_in) {
      const expiresAt = new Date(Date.now() + loginData.expires_in * 1000).toISOString();
      await supabaseAdmin.from("settings").upsert(
        { key: "spark_token_expires_at", value: expiresAt, category: "general" },
        { onConflict: "key" }
      );
    }

    console.log("[refresh-spark-token] Token refreshed successfully");

    return new Response(
      JSON.stringify({ success: true, message: "Token refreshed", expires_in: loginData.expires_in }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[refresh-spark-token] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message?.includes("not configured") ? error.message : "Token refresh failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
