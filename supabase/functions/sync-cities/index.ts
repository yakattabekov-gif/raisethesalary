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

    // Get Spark token
    const { data: settingsData } = await supabaseAdmin.from("settings").select("key, value").in("key", ["spark_bearer_token"]);
    const settings: Record<string, string> = {};
    settingsData?.forEach((s: any) => (settings[s.key] = s.value));
    const sparkToken = settings.spark_bearer_token;
    if (!sparkToken) throw new Error("Spark bearer token not configured");

    // Parse request body for optional params
    let body: any = {};
    try { body = await req.json(); } catch {}
    const mode = body.mode || "sync"; // "sync" | "regions" | "directions_by_region"

    // Fetch all cities from Spark API
    console.log(`[sync-cities] Fetching cities from Spark API...`);
    const resp = await fetch(
      `https://gateway.spark.kz/location/api/cities?page=1&limit=5000`,
      {
        headers: {
          Authorization: `Bearer ${sparkToken}`,
          Accept: "application/json",
        },
      }
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Spark cities API error ${resp.status}: ${errText.substring(0, 300)}`);
    }

    const data = await resp.json();
    const allCities = data.data || data || [];
    console.log(`[sync-cities] Fetched ${allCities.length} cities`);

    if (mode === "regions") {
      // Return unique regions with their cities
      const regionMap: Record<string, { id: number; name: string; region: string }[]> = {};
      for (const c of allCities) {
        const region = c.region || "Без области";
        if (!regionMap[region]) regionMap[region] = [];
        regionMap[region].push({ id: c.id, name: c.name, region });
      }
      return new Response(
        JSON.stringify({ regions: Object.keys(regionMap).sort(), regionMap }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (mode === "directions_by_region") {
      // Auto-create allowed_directions for a region
      const parentCity = body.parent_city;
      const region = body.region;
      if (!parentCity || !region) throw new Error("parent_city and region are required");

      const regionCities = allCities
        .filter((c: any) => c.region === region)
        .map((c: any) => c.name);

      // Get existing directions for this parent
      const { data: existing } = await supabaseAdmin
        .from("allowed_directions")
        .select("child_city")
        .eq("parent_city", parentCity);
      const existingSet = new Set((existing || []).map((d: any) => d.child_city.toLowerCase()));

      const toInsert = regionCities
        .filter((name: string) => !existingSet.has(name.toLowerCase()))
        .map((name: string) => ({ parent_city: parentCity, child_city: name }));

      if (toInsert.length > 0) {
        for (let i = 0; i < toInsert.length; i += 500) {
          const batch = toInsert.slice(i, i + 500);
          const { error } = await supabaseAdmin.from("allowed_directions").insert(batch);
          if (error) console.error(`[sync-cities] Insert directions error:`, error);
        }
      }

      return new Response(
        JSON.stringify({ success: true, added: toInsert.length, total_in_region: regionCities.length, skipped: regionCities.length - toInsert.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default: sync cities to spark_cities table
    let synced = 0;
    for (let i = 0; i < allCities.length; i += 500) {
      const batch = allCities.slice(i, i + 500).map((c: any) => ({
        id: c.id,
        name: c.name,
      }));

      const { error } = await supabaseAdmin.from("spark_cities").upsert(batch, { onConflict: "id" });
      if (error) {
        console.error(`[sync-cities] Upsert batch error:`, error);
      } else {
        synced += batch.length;
      }
    }

    return new Response(
      JSON.stringify({ success: true, synced, total_fetched: allCities.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[sync-cities] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Sync failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
