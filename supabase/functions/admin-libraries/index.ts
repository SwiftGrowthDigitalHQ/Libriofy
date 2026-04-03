import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const maintenanceBlocked = await blockIfMaintenanceMode(corsHeaders);
  if (maintenanceBlocked) return maintenanceBlocked;

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) throw new Error("Missing auth token");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) throw new Error("Unauthorized");

    const { data: adminRole, error: roleError } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("role", "super_admin")
      .maybeSingle();
    if (roleError) throw roleError;
    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("libraries")
        .select("*, library_subscriptions(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    if (req.method === "POST") {
      const { name, owner_id, city, address, total_seats = 30, plan_name = "starter", price = 999, seats_limit = 50, expires_at } = body;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

      const { data: library, error: libError } = await supabase
        .from("libraries")
        .insert({ name, owner_id, city, address, total_seats, slug })
        .select("id")
        .single();
      if (libError) throw libError;

      const { error: roleAssignError } = await supabase
        .from("user_roles")
        .insert({ user_id: owner_id, role: "library_owner", library_id: library.id });
      if (roleAssignError) throw roleAssignError;

      const { error: subError } = await supabase
        .from("library_subscriptions")
        .upsert({
          library_id: library.id,
          plan_name,
          price,
          seats_limit,
          status: "active",
          expires_at: expires_at ?? null,
        });
      if (subError) throw subError;

      return new Response(JSON.stringify({ success: true, library_id: library.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "PATCH") {
      const { library_id, library, subscription } = body;
      if (!library_id) throw new Error("library_id is required");

      if (library) {
        const { error } = await supabase.from("libraries").update(library).eq("id", library_id);
        if (error) throw error;
      }

      if (subscription) {
        const { error } = await supabase
          .from("library_subscriptions")
          .update(subscription)
          .eq("library_id", library_id);
        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "DELETE") {
      const { library_id } = body;
      if (!library_id) throw new Error("library_id is required");
      const { error } = await supabase.from("libraries").delete().eq("id", library_id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
