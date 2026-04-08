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
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Verify caller via cryptographic JWT validation
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("No auth header");
    
    const token = authHeader.replace("Bearer ", "");
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData?.user) throw new Error("Invalid token");
    const callerId = callerData.user.id;

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin");

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, user_id } = body;

    if (action === "delete") {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id);
      if (error) throw error;

    } else if (action === "block") {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        ban_duration: "876000h",
      });
      if (error) throw error;
      await supabaseAdmin.from("profiles").update({ is_blocked: true }).eq("id", user_id);

    } else if (action === "unblock") {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        ban_duration: "none",
      });
      if (error) throw error;
      await supabaseAdmin.from("profiles").update({ is_blocked: false }).eq("id", user_id);

    } else if (action === "reset_password") {
      const { password } = body;
      if (!password || password.length < 6) throw new Error("Password must be at least 6 characters");
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, { password });
      if (error) throw error;

    } else if (action === "update_profile") {
      const { full_name, nickname, phone, avatar_url } = body;
      const profileUpdate: Record<string, any> = {};
      if (full_name !== undefined) profileUpdate.full_name = full_name;
      if (nickname !== undefined) profileUpdate.nickname = nickname;
      if (phone !== undefined) profileUpdate.phone = phone;
      if (avatar_url !== undefined) profileUpdate.avatar_url = avatar_url;
      
      if (Object.keys(profileUpdate).length > 0) {
        const { error } = await supabaseAdmin.from("profiles").update(profileUpdate).eq("id", user_id);
        if (error) throw error;
      }

    } else if (action === "update_email") {
      const { email } = body;
      if (!email) throw new Error("Email is required");
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, { email });
      if (error) throw error;

    } else if (action === "update_role") {
      const { role } = body;
      if (!role) throw new Error("Role is required");
      // Delete existing roles and insert new one
      await supabaseAdmin.from("user_roles").delete().eq("user_id", user_id);
      const { error } = await supabaseAdmin.from("user_roles").insert({ user_id, role });
      if (error) throw error;

    } else {
      throw new Error("Unknown action");
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[admin-manage-user] Error:", error);
    const userErrors = ["Password must be", "Email is required", "Role is required", "Unknown action"];
    const isUserError = userErrors.some((e) => error.message?.includes(e));
    return new Response(JSON.stringify({ error: isUserError ? error.message : "An internal error occurred" }), {
      status: isUserError ? 400 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
