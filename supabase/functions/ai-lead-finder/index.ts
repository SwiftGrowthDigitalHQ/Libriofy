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

type Lead = {
  name: string;
  address: string | null;
  phone: string | null;
  maps_url: string;
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
};

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = [];
  let index = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await fn(items[currentIndex]!);
    }
  });

  await Promise.all(workers);
  return results;
};

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

    const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? Deno.env.get("GOOGLE_PLACES_API_KEY");
    if (!googleKey) {
      return json(
        {
          error: "Google Places API not configured",
          hint: "Set GOOGLE_MAPS_API_KEY (or GOOGLE_PLACES_API_KEY) in Supabase Function secrets.",
        },
        501,
      );
    }

    const body = (await req.json().catch(() => ({}))) as { city?: string; maxResults?: number; query?: string };
    const city = String(body?.city ?? "").trim();
    if (!city) return json({ error: "city is required" }, 400);
    if (city.length > 80) return json({ error: "city is too long" }, 400);

    const maxResults = clampInt(body?.maxResults, 1, 40, 20);
    const query = String(body?.query ?? `study library in ${city}, India`).trim();

    const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("region", "in");
    searchUrl.searchParams.set("key", googleKey);

    const searchRes = await fetch(searchUrl.toString());
    if (!searchRes.ok) return json({ error: "Google Places search failed" }, 502);
    const searchJson = await searchRes.json();

    const status = String(searchJson?.status ?? "");
    if (status !== "OK" && status !== "ZERO_RESULTS") {
      return json({ error: "Google Places search error", status, detail: searchJson?.error_message ?? null }, 502);
    }

    const placeResults = Array.isArray(searchJson?.results) ? searchJson.results : [];
    const placeIds: string[] = [];
    for (const place of placeResults) {
      const placeId = String(place?.place_id ?? "").trim();
      if (!placeId) continue;
      placeIds.push(placeId);
      if (placeIds.length >= maxResults) break;
    }

    const uniquePlaceIds = Array.from(new Set(placeIds));

    const leads = await mapLimit(uniquePlaceIds, 6, async (placeId): Promise<Lead> => {
      const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      detailsUrl.searchParams.set("place_id", placeId);
      detailsUrl.searchParams.set("fields", "name,formatted_address,formatted_phone_number,international_phone_number,url");
      detailsUrl.searchParams.set("key", googleKey);

      const detailsRes = await fetch(detailsUrl.toString());
      if (!detailsRes.ok) {
        return {
          name: "Unknown",
          address: null,
          phone: null,
          maps_url: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`,
        };
      }

      const detailsJson = await detailsRes.json();
      const result = detailsJson?.result ?? {};

      const name = String(result?.name ?? "Unknown");
      const address = result?.formatted_address ? String(result.formatted_address) : null;
      const phone = result?.formatted_phone_number
        ? String(result.formatted_phone_number)
        : result?.international_phone_number
          ? String(result.international_phone_number)
          : null;
      const mapsUrl = result?.url
        ? String(result.url)
        : `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;

      return { name, address, phone, maps_url: mapsUrl };
    });

    const normalizedLeads = leads
      .filter((lead) => Boolean(lead.name))
      .map((lead) => ({
        ...lead,
        phone: lead.phone && lead.phone.trim() ? lead.phone.trim() : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const phonesFound = normalizedLeads.filter((lead) => Boolean(lead.phone)).length;

    return json({
      city,
      query,
      places_found: uniquePlaceIds.length,
      phones_found: phonesFound,
      leads: normalizedLeads,
      note: `Results are limited to ${maxResults} places per request.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});

