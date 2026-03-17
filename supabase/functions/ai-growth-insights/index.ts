import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type InsightContext = {
  totalLibraries?: number;
  activeCities?: number;
  statesCovered?: number;
  topStates?: Array<{ state: string; libraries: number }>;
  topCities?: Array<{ city: string; state?: string; libraries: number }>;
  libraryGrowth?: Array<{ month: string; libraries: number }>;
};

const safeNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

const safeArray = <T>(value: unknown) => (Array.isArray(value) ? (value as T[]) : []);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return json({ error: "Missing auth token" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

    const { data: adminRole, error: roleError } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("role", "super_admin")
      .maybeSingle();
    if (roleError) throw roleError;
    if (!adminRole) return json({ error: "Forbidden" }, 403);

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) {
      return json(
        {
          error: "AI not configured",
          hint: "Set OPENAI_API_KEY (and optionally OPENAI_MODEL) in Supabase Function secrets.",
        },
        501,
      );
    }

    const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

    const body = (await req.json().catch(() => ({}))) as { context?: InsightContext; prompt?: string };
    const context = (body?.context ?? {}) as InsightContext;

    const totalLibraries = safeNumber(context.totalLibraries);
    const activeCities = safeNumber(context.activeCities);
    const statesCovered = safeNumber(context.statesCovered);
    const topStates = safeArray<{ state: string; libraries: number }>(context.topStates).slice(0, 10);
    const topCities = safeArray<{ city: string; state?: string; libraries: number }>(context.topCities).slice(0, 10);
    const growth = safeArray<{ month: string; libraries: number }>(context.libraryGrowth).slice(0, 12);

    const systemPrompt =
      "You are a SaaS growth intelligence analyst for an Indian education platform. " +
      "Write concise, actionable insights for a super admin. " +
      "Output 3-6 bullets (no markdown headers), focusing on geography concentration, whitespace expansion, and quick wins. " +
      "Do not invent metrics; only reason from provided numbers.";

    const userPromptParts: string[] = [];
    if (totalLibraries !== null) userPromptParts.push(`Total libraries: ${totalLibraries}`);
    if (activeCities !== null) userPromptParts.push(`Active cities: ${activeCities}`);
    if (statesCovered !== null) userPromptParts.push(`States covered: ${statesCovered} (out of 28)`);
    if (topStates.length > 0) {
      userPromptParts.push(
        `Top states by libraries: ${topStates.map((s) => `${s.state} (${s.libraries})`).join(", ")}`,
      );
    }
    if (topCities.length > 0) {
      userPromptParts.push(
        `Top cities by libraries: ${topCities.map((c) => `${c.city}${c.state ? `, ${c.state}` : ""} (${c.libraries})`).join(", ")}`,
      );
    }
    if (growth.length > 0) {
      userPromptParts.push(`Recent monthly library signups: ${growth.map((g) => `${g.month}: ${g.libraries}`).join(", ")}`);
    }

    const userPrompt =
      (body?.prompt ? `${body.prompt}\n\n` : "") +
      `Here is the latest dashboard context:\n- ${userPromptParts.join("\n- ")}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 240,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return json({ error: "OpenAI request failed", detail }, 502);
    }

    const data = await response.json();
    const insight = String(data?.choices?.[0]?.message?.content ?? "").trim();

    return json({
      insight,
      generated_at: new Date().toISOString(),
      model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});

