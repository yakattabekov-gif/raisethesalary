import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  // Verify caller is admin
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: roles } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin");
  if (!roles?.length) {
    return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { schedule } = await req.json();
    if (!schedule) throw new Error("schedule is required (cron expression, e.g. '*/2 * * * *')");

    // Unschedule existing job if any
    await supabaseAdmin.rpc("unschedule_cron_job", { job_name: "process-jira-tasks-cron" }).catch(() => {});

    // Use raw SQL via pg function to schedule new cron
    const functionUrl = `${supabaseUrl}/functions/v1/process-jira-tasks`;
    
    const { error } = await supabaseAdmin.rpc("schedule_cron_job", {
      job_name: "process-jira-tasks-cron",
      cron_schedule: schedule,
      function_url: functionUrl,
      anon_key: serviceKey,
    });

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, schedule }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
