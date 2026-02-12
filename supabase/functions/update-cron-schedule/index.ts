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
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { schedule } = await req.json();
    if (!schedule) throw new Error("schedule is required (cron expression, e.g. '*/2 * * * *')");

    // Unschedule existing job if any
    await supabase.rpc("unschedule_cron_job", { job_name: "process-jira-tasks-cron" }).catch(() => {});

    // Use raw SQL via pg function to schedule new cron
    const functionUrl = `${supabaseUrl}/functions/v1/process-jira-tasks`;
    
    const { error } = await supabase.rpc("schedule_cron_job", {
      job_name: "process-jira-tasks-cron",
      cron_schedule: schedule,
      function_url: functionUrl,
      anon_key: anonKey,
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
