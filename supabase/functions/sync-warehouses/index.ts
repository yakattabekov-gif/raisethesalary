import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Auth check
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!isServiceRole) {
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: claimsData, error: claimsError } = await supabaseAdmin.auth.getUser(token);
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

    // Get Spark token from settings
    const { data: settingsData } = await supabaseAdmin.from("settings").select("key, value").in("key", ["spark_bearer_token"]);
    const settings: Record<string, string> = {};
    settingsData?.forEach((s: any) => (settings[s.key] = s.value));
    const sparkToken = settings.spark_bearer_token;
    if (!sparkToken) throw new Error("Spark bearer token not configured");

    // Fetch all pages of warehouses from Spark API
    const allWarehouses: any[] = [];
    let page = 1;
    const maxPages = 50;

    while (page <= maxPages) {
      console.log(`[sync-warehouses] Fetching page ${page}...`);
      const resp = await fetch(
        `https://gateway.spark.kz/location/api/warehouses?page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${sparkToken}`,
            Accept: "application/json",
          },
        }
      );

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`Spark warehouses API error ${resp.status}: ${errText.substring(0, 300)}`);
      }

      const data = await resp.json();
      const items = data.data || data.items || data || [];
      const whList = Array.isArray(items) ? items : [];

      if (whList.length === 0) break;
      allWarehouses.push(...whList);

      // Check if there are more pages
      const lastPage = data.meta?.last_page || data.last_page || 1;
      if (page >= lastPage) break;
      page++;
    }

    console.log(`[sync-warehouses] Total warehouses fetched: ${allWarehouses.length}`);

    // Upsert into warehouses table
    let synced = 0;
    for (let i = 0; i < allWarehouses.length; i += 100) {
      const batch = allWarehouses.slice(i, i + 100).map((w: any) => ({
        id: w.id,
        city_id: w.city_id || w.city?.id || 0,
        city_name: w.city?.name || w.city_name || "",
        address: w.address || w.full_address || "",
        latitude: w.latitude ? Number(w.latitude) : 0,
        longitude: w.longitude ? Number(w.longitude) : 0,
        name: w.name || w.title || null,
      }));

      const { error } = await supabaseAdmin.from("warehouses").upsert(batch, { onConflict: "id" });
      if (error) {
        console.error(`[sync-warehouses] Upsert batch error:`, error);
      } else {
        synced += batch.length;
      }
    }

    return new Response(
      JSON.stringify({ success: true, synced, total_fetched: allWarehouses.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[sync-warehouses] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Sync failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
