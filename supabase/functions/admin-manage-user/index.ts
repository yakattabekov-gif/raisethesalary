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

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No auth header");
    
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await supabaseAdmin.auth.getUser(token);
    if (!caller) throw new Error("Invalid token");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin");

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, user_id } = await req.json();

    if (action === "delete") {
      // Delete from auth (cascades to profiles, roles)
      const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id);
      if (error) throw error;
    } else if (action === "block") {
      // Ban user
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        ban_duration: "876000h", // ~100 years
      });
      if (error) throw error;
      // Also mark in profiles
      await supabaseAdmin.from("profiles").update({ is_blocked: true }).eq("id", user_id);
    } else if (action === "unblock") {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        ban_duration: "none",
      });
      if (error) throw error;
      await supabaseAdmin.from("profiles").update({ is_blocked: false }).eq("id", user_id);
    } else {
      throw new Error("Unknown action");
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
