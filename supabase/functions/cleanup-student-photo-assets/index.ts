import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STUDENT_PHOTOS_BUCKET = "student-photos";
const QUERY_BATCH_SIZE = 500;
const STORAGE_DELETE_BATCH_SIZE = 100;
const TEMP_RETENTION_MS = 24 * 60 * 60 * 1000;

type RangedQuery = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

type StorageObjectRow = {
  created_at: string;
  name: string;
};

type StudentPhotoReferenceRow = {
  photo_storage_path: string | null;
  photo_thumbnail_path: string | null;
};

const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

const chunk = <T>(items: T[], size: number) => {
  const result: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
};

const trimPath = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: "Supabase environment variables are not configured." }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const cutoffIso = new Date(Date.now() - TEMP_RETENTION_MS).toISOString();

  const fetchAll = async <T>(factory: () => RangedQuery): Promise<T[]> => {
    const rows: T[] = [];

    for (let offset = 0; ; offset += QUERY_BATCH_SIZE) {
      const { data, error } = await factory().range(offset, offset + QUERY_BATCH_SIZE - 1);

      if (error) throw error;

      const batch = (data ?? []) as T[];
      if (batch.length === 0) break;

      rows.push(...batch);

      if (batch.length < QUERY_BATCH_SIZE) {
        break;
      }
    }

    return rows;
  };

  try {
    const tempRows = await fetchAll<StorageObjectRow>(() =>
      supabase
        .schema("storage")
        .from("objects")
        .select("name, created_at")
        .eq("bucket_id", STUDENT_PHOTOS_BUCKET)
        .like("name", "temp/%")
        .lt("created_at", cutoffIso)
        .order("created_at", { ascending: true }),
    );

    const studentPhotoReferences = await fetchAll<StudentPhotoReferenceRow>(() =>
      supabase
        .from("students")
        .select("photo_storage_path, photo_thumbnail_path")
        .or("photo_storage_path.not.is.null,photo_thumbnail_path.not.is.null")
        .order("id", { ascending: true }),
    );

    const livePhotoPaths = new Set<string>();
    for (const row of studentPhotoReferences) {
      const originalPath = trimPath(row.photo_storage_path);
      const thumbnailPath = trimPath(row.photo_thumbnail_path);

      if (originalPath) livePhotoPaths.add(originalPath);
      if (thumbnailPath) livePhotoPaths.add(thumbnailPath);
    }

    const finalRows = await fetchAll<StorageObjectRow>(() =>
      supabase
        .schema("storage")
        .from("objects")
        .select("name, created_at")
        .eq("bucket_id", STUDENT_PHOTOS_BUCKET)
        .like("name", "%/students/%")
        .lt("created_at", cutoffIso)
        .order("created_at", { ascending: true }),
    );

    const tempPaths = tempRows.map((row) => row.name);
    const orphanedFinalPaths = finalRows
      .map((row) => row.name)
      .filter((path) => !livePhotoPaths.has(path));

    for (const pathBatch of chunk([...tempPaths, ...orphanedFinalPaths], STORAGE_DELETE_BATCH_SIZE)) {
      const { error } = await supabase.storage.from(STUDENT_PHOTOS_BUCKET).remove(pathBatch);
      if (error) throw error;
    }

    return jsonResponse({
      success: true,
      deletedOrphanedFinalFiles: orphanedFinalPaths.length,
      deletedTempFiles: tempPaths.length,
      scannedLiveReferences: livePhotoPaths.size,
      scannedFinalFiles: finalRows.length,
      scannedTempFiles: tempRows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to clean up student photo assets.";

    return jsonResponse({ success: false, error: message }, { status: 500 });
  }
});
