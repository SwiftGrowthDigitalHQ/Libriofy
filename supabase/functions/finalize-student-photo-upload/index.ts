import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Image } from "npm:imagescript@1.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STUDENT_PHOTOS_BUCKET = "student-photos";
const PHOTO_CACHE_CONTROL = "31536000";
const THUMBNAIL_SIZE = 100;

type PrepareStudentPhotoUploadResponse = {
  currentPhotoStoragePath?: string | null;
  currentPhotoThumbnailPath?: string | null;
  error?: string;
  finalOriginalPath?: string;
  finalThumbnailPath?: string;
  libraryId?: string | null;
  success?: boolean;
  version?: number;
};

type UpdateStudentPhotoResponse = {
  error?: string;
  photoUrl?: string;
  photoVersion?: number;
  previousPhotoStoragePath?: string | null;
  previousPhotoThumbnailPath?: string | null;
  success?: boolean;
};

type StudentPhotoBucketRow = {
  allowed_mime_types: string[] | null;
  file_size_limit: number | null;
  id: string;
  name: string;
  public: boolean | null;
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "object" && error && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return "Unable to finalize the student photo upload.";
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

const serializeError = (error: unknown) => {
  const record = typeof error === "object" && error ? (error as Record<string, unknown>) : null;
  const status =
    typeof record?.status === "number"
      ? record.status
      : typeof record?.statusCode === "number"
        ? record.statusCode
        : null;

  return {
    code: typeof record?.code === "string" ? record.code : null,
    details: record?.details ?? null,
    error: record?.error ?? null,
    hint: record?.hint ?? null,
    message: toErrorMessage(error),
    name:
      typeof record?.name === "string"
        ? record.name
        : error instanceof Error
          ? error.name
          : null,
    status,
  };
};

const logStudentPhotoEvent = (level: "error" | "info" | "warn", stage: string, payload: Record<string, unknown>) => {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger(`[student-photo-upload] ${stage}`, payload);
};

const getPublicPhotoUrl = ({
  path,
  supabaseUrl,
  version,
}: {
  path: string;
  supabaseUrl: string;
  version: number;
}) => `${supabaseUrl}/storage/v1/object/public/${STUDENT_PHOTOS_BUCKET}/${path}?v=${version}`;

const buildSquareThumbnail = async (bytes: Uint8Array) => {
  const image = await Image.decode(bytes);
  const cropSize = Math.min(image.width, image.height);
  const cropX = Math.max(0, Math.floor((image.width - cropSize) / 2));
  const cropY = Math.max(0, Math.floor((image.height - cropSize) / 2));
  const square = image.crop(cropX, cropY, cropSize, cropSize);
  const thumbnail = square.resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE);

  return thumbnail.encodeJPEG(80);
};

const lookupStudentPhotoBucket = async (adminSupabase: ReturnType<typeof createClient>) => {
  const { data, error } = await adminSupabase
    .schema("storage")
    .from("buckets")
    .select("id, name, public, file_size_limit, allowed_mime_types")
    .eq("id", STUDENT_PHOTOS_BUCKET)
    .maybeSingle();

  return {
    bucket: (data ?? null) as StudentPhotoBucketRow | null,
    error: error ? serializeError(error) : null,
  };
};

const fetchStudentPhotoUploadDiagnostics = async ({
  libraryId,
  storagePath,
  studentId,
  userSupabase,
}: {
  libraryId?: string | null;
  storagePath?: string | null;
  studentId?: string;
  userSupabase: ReturnType<typeof createClient>;
}) => {
  try {
    const { data, error } = await userSupabase.rpc("get_student_photo_upload_diagnostics" as never, {
      p_library_id: libraryId ?? null,
      p_storage_path: storagePath ?? null,
      p_student_id: studentId ?? null,
    } as never);

    if (error) {
      return {
        diagnosticsRpcError: serializeError(error),
      };
    }

    return (data ?? null) as Record<string, unknown> | null;
  } catch (error) {
    return {
      diagnosticsRpcError: serializeError(error),
    };
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const maintenanceBlocked = await blockIfMaintenanceMode(corsHeaders);
  if (maintenanceBlocked) return maintenanceBlocked;

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ success: false, error: "Missing auth token" }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ success: false, error: "Supabase environment variables are not configured." }, { status: 500 });
  }

  const adminSupabase = createClient(supabaseUrl, serviceRoleKey);
  const userSupabase = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

  let tempOriginalPath = "";
  let finalOriginalPath = "";
  let finalThumbnailPath = "";
  let libraryId: string | null = null;
  let studentId = "";
  let userId = "";
  let databaseCommitted = false;

  const cleanupPaths = async (paths: Array<string | null | undefined>) => {
    const uniquePaths = Array.from(
      new Set(paths.map((path) => (typeof path === "string" ? path.trim() : "")).filter(Boolean)),
    );

    if (uniquePaths.length === 0) return;

    const { error } = await adminSupabase.storage.from(STUDENT_PHOTOS_BUCKET).remove(uniquePaths);

    if (error) {
      throw error;
    }
  };

  try {
    const { studentId: inputStudentId, tempOriginalPath: inputOriginalPath } = await req.json();

    if (typeof inputStudentId !== "string" || !inputStudentId.trim()) {
      return jsonResponse({ success: false, error: "studentId is required" }, { status: 400 });
    }

    if (typeof inputOriginalPath !== "string" || !inputOriginalPath.trim()) {
      return jsonResponse({ success: false, error: "tempOriginalPath is required" }, { status: 400 });
    }

    studentId = inputStudentId.trim();
    tempOriginalPath = inputOriginalPath.trim();

    const {
      data: { user },
      error: authError,
    } = await userSupabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    userId = user.id;

    const bucketLookup = await lookupStudentPhotoBucket(adminSupabase);
    logStudentPhotoEvent(bucketLookup.error ? "warn" : "info", "bucket-lookup", {
      bucket: STUDENT_PHOTOS_BUCKET,
      bucketLookup,
      storagePath: tempOriginalPath,
      studentId,
      userId,
    });

    const { data: prepareData, error: prepareError } = await userSupabase.rpc("prepare_student_photo_upload" as never, {
      p_student_id: studentId,
      p_temp_original_path: tempOriginalPath,
    } as never);

    logStudentPhotoEvent(prepareError ? "warn" : "info", "prepare-student-photo-upload-response", {
      bucket: STUDENT_PHOTOS_BUCKET,
      error: prepareError ? serializeError(prepareError) : null,
      prepareResponse: prepareData ?? null,
      storagePath: tempOriginalPath,
      studentId,
      userId,
    });

    if (prepareError) {
      throw prepareError;
    }

    const prepared = (prepareData ?? {}) as PrepareStudentPhotoUploadResponse;
    if (prepared.success === false || !prepared.finalOriginalPath || !prepared.finalThumbnailPath || !prepared.version) {
      logStudentPhotoEvent("warn", "prepare-student-photo-upload-invalid-response", {
        bucket: STUDENT_PHOTOS_BUCKET,
        prepareResponse: prepared,
        storagePath: tempOriginalPath,
        studentId,
        userId,
      });
      return jsonResponse({
        success: false,
        error: prepared.error || "Student photo upload could not be prepared.",
      });
    }

    libraryId = prepared.libraryId ?? null;
    finalOriginalPath = prepared.finalOriginalPath;
    finalThumbnailPath = prepared.finalThumbnailPath;

    const { data: downloadedPhoto, error: downloadError } = await adminSupabase.storage
      .from(STUDENT_PHOTOS_BUCKET)
      .download(tempOriginalPath);

    logStudentPhotoEvent(downloadError || !downloadedPhoto ? "warn" : "info", "download-temp-photo-response", {
      bucket: STUDENT_PHOTOS_BUCKET,
      error: downloadError ? serializeError(downloadError) : null,
      finalOriginalPath,
      finalThumbnailPath,
      libraryId,
      storagePath: tempOriginalPath,
      studentId,
      userId,
    });

    if (downloadError || !downloadedPhoto) {
      throw downloadError || new Error("Unable to read the uploaded photo draft.");
    }

    const originalBuffer = await downloadedPhoto.arrayBuffer();
    const originalBytes = new Uint8Array(originalBuffer);
    const thumbnailBytes = await buildSquareThumbnail(originalBytes);

    const [originalUpload, thumbnailUpload] = await Promise.all([
      adminSupabase.storage.from(STUDENT_PHOTOS_BUCKET).upload(finalOriginalPath, new Blob([originalBytes], { type: "image/jpeg" }), {
        cacheControl: PHOTO_CACHE_CONTROL,
        contentType: "image/jpeg",
        upsert: false,
      }),
      adminSupabase.storage.from(STUDENT_PHOTOS_BUCKET).upload(finalThumbnailPath, new Blob([thumbnailBytes], { type: "image/jpeg" }), {
        cacheControl: PHOTO_CACHE_CONTROL,
        contentType: "image/jpeg",
        upsert: false,
      }),
    ]);

    logStudentPhotoEvent(originalUpload.error || thumbnailUpload.error ? "warn" : "info", "service-role-upload-response", {
      bucket: STUDENT_PHOTOS_BUCKET,
      finalOriginalPath,
      finalThumbnailPath,
      libraryId,
      originalUpload: {
        data: originalUpload.data ?? null,
        error: originalUpload.error ? serializeError(originalUpload.error) : null,
      },
      studentId,
      thumbnailUpload: {
        data: thumbnailUpload.data ?? null,
        error: thumbnailUpload.error ? serializeError(thumbnailUpload.error) : null,
      },
      userId,
      version: prepared.version,
    });

    if (originalUpload.error) {
      throw originalUpload.error;
    }

    if (thumbnailUpload.error) {
      throw thumbnailUpload.error;
    }

    const originalUrl = getPublicPhotoUrl({
      path: finalOriginalPath,
      supabaseUrl,
      version: prepared.version,
    });
    const thumbnailUrl = getPublicPhotoUrl({
      path: finalThumbnailPath,
      supabaseUrl,
      version: prepared.version,
    });

    const { data: updateData, error: updateError } = await userSupabase.rpc("update_student_photo_url" as never, {
      p_student_id: studentId,
      p_photo_url: originalUrl,
      p_final_photo_storage_path: finalOriginalPath,
      p_final_photo_thumbnail_path: finalThumbnailPath,
      p_photo_version: prepared.version,
      p_expected_photo_storage_path: prepared.currentPhotoStoragePath ?? null,
      p_expected_photo_thumbnail_path: prepared.currentPhotoThumbnailPath ?? null,
      p_temp_original_path: tempOriginalPath,
    } as never);

    logStudentPhotoEvent(updateError ? "warn" : "info", "update-student-photo-url-response", {
      bucket: STUDENT_PHOTOS_BUCKET,
      error: updateError ? serializeError(updateError) : null,
      finalOriginalPath,
      finalThumbnailPath,
      libraryId,
      originalUrl,
      storagePath: finalOriginalPath,
      studentId,
      updateResponse: updateData ?? null,
      userId,
      version: prepared.version,
    });

    if (updateError) {
      throw updateError;
    }

    const finalized = (updateData ?? {}) as UpdateStudentPhotoResponse;

    if (finalized.success === false) {
      await cleanupPaths([finalOriginalPath, finalThumbnailPath, tempOriginalPath]).catch((cleanupError) => {
        logStudentPhotoEvent("warn", "cleanup-after-invalid-finalization-response-failed", {
          bucket: STUDENT_PHOTOS_BUCKET,
          error: serializeError(cleanupError),
          finalOriginalPath,
          finalThumbnailPath,
          libraryId,
          storagePath: tempOriginalPath,
          studentId,
          userId,
        });
      });

      logStudentPhotoEvent("warn", "finalize-student-photo-upload-invalid-response", {
        bucket: STUDENT_PHOTOS_BUCKET,
        finalOriginalPath,
        finalThumbnailPath,
        finalized,
        libraryId,
        storagePath: tempOriginalPath,
        studentId,
        userId,
      });

      return jsonResponse({
        success: false,
        error: finalized.error || "Student photo upload could not be finalized.",
      });
    }

    databaseCommitted = true;

    await cleanupPaths([
      tempOriginalPath,
      finalized.previousPhotoStoragePath ?? null,
      finalized.previousPhotoThumbnailPath ?? null,
    ]).catch((cleanupError) => {
      logStudentPhotoEvent("warn", "cleanup-after-success-failed", {
        bucket: STUDENT_PHOTOS_BUCKET,
        error: serializeError(cleanupError),
        finalOriginalPath,
        finalThumbnailPath,
        libraryId,
        previousPhotoStoragePath: finalized.previousPhotoStoragePath ?? null,
        previousPhotoThumbnailPath: finalized.previousPhotoThumbnailPath ?? null,
        studentId,
        tempOriginalPath,
        userId,
      });
    });

    logStudentPhotoEvent("info", "finalize-student-photo-upload-success", {
      bucket: STUDENT_PHOTOS_BUCKET,
      finalOriginalPath,
      finalThumbnailPath,
      finalized,
      libraryId,
      studentId,
      tempOriginalPath,
      userId,
      version: prepared.version,
    });

    return jsonResponse({
      success: true,
      originalUrl,
      photoStoragePath: finalOriginalPath,
      photoThumbnailPath: finalThumbnailPath,
      photoUrl: originalUrl,
      thumbnailUrl,
      version: prepared.version,
    });
  } catch (error) {
    const message = toErrorMessage(error);
    const diagnostics = await fetchStudentPhotoUploadDiagnostics({
      libraryId,
      storagePath: finalOriginalPath || tempOriginalPath || null,
      studentId: studentId || undefined,
      userSupabase,
    });

    if (!databaseCommitted) {
      await cleanupPaths([finalOriginalPath, finalThumbnailPath, tempOriginalPath]).catch((cleanupError) => {
        logStudentPhotoEvent("warn", "cleanup-after-failure-failed", {
          bucket: STUDENT_PHOTOS_BUCKET,
          error: serializeError(cleanupError),
          finalOriginalPath: finalOriginalPath || null,
          finalThumbnailPath: finalThumbnailPath || null,
          libraryId,
          storagePath: tempOriginalPath || null,
          studentId: studentId || null,
          userId: userId || null,
        });
      });
    }

    if (studentId && !databaseCommitted) {
      await userSupabase
        .rpc("log_student_photo_upload_failure" as never, {
          p_student_id: studentId,
          p_error_message: message,
          p_temp_original_path: tempOriginalPath || null,
          p_final_photo_storage_path: finalOriginalPath || null,
          p_final_photo_thumbnail_path: finalThumbnailPath || null,
        } as never)
        .catch((logFailureError) => {
          logStudentPhotoEvent("warn", "log-student-photo-upload-failure-rpc-failed", {
            bucket: STUDENT_PHOTOS_BUCKET,
            error: serializeError(logFailureError),
            finalOriginalPath: finalOriginalPath || null,
            finalThumbnailPath: finalThumbnailPath || null,
            libraryId,
            storagePath: tempOriginalPath || null,
            studentId,
            userId: userId || null,
          });
        });
    }

    logStudentPhotoEvent("error", "finalize-student-photo-upload-failed", {
      bucket: STUDENT_PHOTOS_BUCKET,
      databaseCommitted,
      diagnostics,
      error: serializeError(error),
      finalOriginalPath: finalOriginalPath || null,
      finalThumbnailPath: finalThumbnailPath || null,
      libraryId,
      storagePath: tempOriginalPath || null,
      studentId: studentId || null,
      userId: userId || null,
    });

    return jsonResponse({ success: false, error: message }, { status: 500 });
  }
});
