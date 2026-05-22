import imageCompression from "browser-image-compression";

import { supabase } from "@/integrations/supabase/client";

export const STUDENT_PHOTOS_BUCKET = "student-photos";
export const STUDENT_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const STUDENT_PHOTO_CACHE_CONTROL = "31536000";

const supportedMimeTypes = new Set(["image/jpeg", "image/png"]);
const supportedFileNamePattern = /\.(jpe?g|png)$/i;
const shouldBypassLocalStudentPhotoPipeline =
  typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);

type FinalizeStudentPhotoUploadResponse = {
  error?: string;
  originalUrl?: string;
  photoStoragePath?: string;
  photoThumbnailPath?: string;
  photoUrl?: string;
  success?: boolean;
  thumbnailUrl?: string;
  version?: number;
};

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

type UpdateStudentPhotoUrlResponse = {
  error?: string;
  photoUrl?: string;
  photoVersion?: number;
  previousPhotoStoragePath?: string | null;
  previousPhotoThumbnailPath?: string | null;
  success?: boolean;
};

type StudentPhotoUploadDiagnostics = {
  authRole?: string | null;
  bucket?: Record<string, unknown> | null;
  grants?: Record<string, unknown> | null;
  libraryAccess?: boolean | null;
  libraryId?: string | null;
  pathCategory?: string | null;
  policies?: Record<string, unknown> | null;
  rpcs?: Record<string, unknown> | null;
  storagePath?: string | null;
  studentId?: string | null;
  suspectedFailingPolicy?: string | null;
  userId?: string | null;
};

type StudentPhotoUploadLogContext = {
  error?: unknown;
  extra?: Record<string, unknown>;
  libraryId?: string | null;
  stage: string;
  storagePath?: string | null;
  studentId?: string;
  userId?: string | null;
};

const compressPhoto = async ({
  file,
  maxSizeMB,
  maxWidthOrHeight,
}: {
  file: File;
  maxSizeMB: number;
  maxWidthOrHeight: number;
}) =>
  imageCompression(file, {
    fileType: "image/jpeg",
    maxSizeMB,
    maxWidthOrHeight,
    useWebWorker: true,
  });

const trimPath = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const cleanupTempStudentPhotoAssets = async (paths: Array<string | null | undefined>) => {
  const validPaths = Array.from(new Set(paths.map(trimPath).filter(Boolean)));

  if (validPaths.length === 0) return;

  const { error } = await supabase.storage.from(STUDENT_PHOTOS_BUCKET).remove(validPaths);

  if (error) {
    throw error;
  }
};

const getFunctionErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "object" && error && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return "Unable to finalize the student photo upload.";
};

const isStudentPhotoPermissionError = (error: unknown) => {
  const message = getFunctionErrorMessage(error).toLowerCase();
  return /row-level security|forbidden|not allowed|permission/.test(message);
};

const getStudentPhotoPublicUrl = (path: string, version?: number | null) => {
  const { data } = supabase.storage.from(STUDENT_PHOTOS_BUCKET).getPublicUrl(path);
  return version ? `${data.publicUrl}?v=${version}` : data.publicUrl;
};

const shouldUseClientFinalizationFallback = (error: unknown) => {
  const name = String((error as { name?: unknown } | null)?.name ?? "").toLowerCase();
  const message = getFunctionErrorMessage(error).toLowerCase();

  return (
    name.includes("functionsfetcherror") ||
    /failed to send a request to the edge function|failed to fetch|networkerror|load failed|cors|preflight/.test(message)
  );
};

const serializeSupabaseError = (error: unknown) => {
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
    message: getFunctionErrorMessage(error),
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

const fetchStudentPhotoUploadDiagnostics = async ({
  libraryId,
  storagePath,
  studentId,
}: {
  libraryId?: string | null;
  storagePath?: string | null;
  studentId?: string;
}) => {
  try {
    const { data, error } = await supabase.rpc("get_student_photo_upload_diagnostics" as never, {
      p_library_id: libraryId ?? null,
      p_storage_path: storagePath ?? null,
      p_student_id: studentId ?? null,
    } as never);

    if (error) {
      return {
        diagnosticsRpcError: serializeSupabaseError(error),
      };
    }

    return ((data ?? null) as StudentPhotoUploadDiagnostics | null) ?? null;
  } catch (error) {
    return {
      diagnosticsRpcError: serializeSupabaseError(error),
    };
  }
};

const logStudentPhotoUploadFailure = async ({
  error,
  extra,
  libraryId,
  stage,
  storagePath,
  studentId,
  userId,
}: StudentPhotoUploadLogContext) => {
  const diagnostics = await fetchStudentPhotoUploadDiagnostics({
    libraryId,
    storagePath,
    studentId,
  });

  const suspectedFailingPolicy =
    diagnostics && typeof diagnostics === "object" && "suspectedFailingPolicy" in diagnostics
      ? diagnostics.suspectedFailingPolicy
      : null;

  logStudentPhotoEvent("error", stage, {
    bucket: STUDENT_PHOTOS_BUCKET,
    diagnostics,
    error: serializeSupabaseError(error),
    libraryId: libraryId ?? null,
    storagePath: storagePath ?? null,
    studentId: studentId ?? null,
    suspectedFailingPolicy,
    userId: userId ?? null,
    ...(extra ?? {}),
  });
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to process the selected photo."));
    image.src = src;
  });

const createSquareThumbnailBlob = async (source: Blob) => {
  if (typeof document === "undefined") {
    throw new Error("Unable to process the selected photo.");
  }

  const objectUrl = URL.createObjectURL(source);

  try {
    const image = await loadImage(objectUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const cropSize = Math.min(width, height);
    const cropX = Math.max(0, Math.floor((width - cropSize) / 2));
    const cropY = Math.max(0, Math.floor((height - cropSize) / 2));
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to process the selected photo.");
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, cropX, cropY, cropSize, cropSize, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.82);
    });

    if (!blob) {
      throw new Error("Unable to process the selected photo.");
    }

    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const uploadFinalStudentPhotoAsset = async ({
  blob,
  path,
}: {
  blob: Blob;
  path: string;
}) => {
  const { data, error } = await supabase.storage.from(STUDENT_PHOTOS_BUCKET).upload(path, blob, {
    cacheControl: STUDENT_PHOTO_CACHE_CONTROL,
    contentType: "image/jpeg",
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return data;
};

const finalizeStudentPhotoUploadFromClient = async ({
  file,
  libraryId,
  studentId,
  tempOriginalPath,
  userId,
}: {
  file: File;
  libraryId?: string | null;
  studentId: string;
  tempOriginalPath: string;
  userId?: string | null;
}) => {
  logStudentPhotoEvent("info", "client-finalization-start", {
    bucket: STUDENT_PHOTOS_BUCKET,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    libraryId: libraryId ?? null,
    storagePath: tempOriginalPath,
    studentId,
    userId: userId ?? null,
  });

  const compressedFile = await compressPhoto({ file, maxSizeMB: 0.5, maxWidthOrHeight: 800 });
  const thumbnailBlob = await createSquareThumbnailBlob(compressedFile);
  const { data: prepareData, error: prepareError } = await supabase.rpc("prepare_student_photo_upload" as never, {
    p_student_id: studentId,
    p_temp_original_path: tempOriginalPath,
  } as never);

  if (prepareError) {
    await logStudentPhotoUploadFailure({
      error: prepareError,
      libraryId,
      stage: "prepare-student-photo-upload",
      storagePath: tempOriginalPath,
      studentId,
      userId,
    });
    throw prepareError;
  }

  const prepared = (prepareData ?? {}) as PrepareStudentPhotoUploadResponse;

  if (prepared.success === false || !prepared.finalOriginalPath || !prepared.finalThumbnailPath || !prepared.version) {
    const responseError = new Error(prepared.error || "Unable to prepare the student photo upload.");
    await logStudentPhotoUploadFailure({
      error: responseError,
      extra: {
        prepareResponse: prepared,
      },
      libraryId: libraryId ?? prepared.libraryId ?? null,
      stage: "prepare-student-photo-upload-response",
      storagePath: tempOriginalPath,
      studentId,
      userId,
    });
    throw responseError;
  }

  logStudentPhotoEvent("info", "prepare-student-photo-upload-success", {
    bucket: STUDENT_PHOTOS_BUCKET,
    currentPhotoStoragePath: prepared.currentPhotoStoragePath ?? null,
    currentPhotoThumbnailPath: prepared.currentPhotoThumbnailPath ?? null,
    finalOriginalPath: prepared.finalOriginalPath,
    finalThumbnailPath: prepared.finalThumbnailPath,
    libraryId: prepared.libraryId ?? libraryId ?? null,
    studentId,
    tempOriginalPath,
    userId: userId ?? null,
    version: prepared.version,
  });

  const originalUrl = getStudentPhotoPublicUrl(prepared.finalOriginalPath, prepared.version);
  const thumbnailUrl = getStudentPhotoPublicUrl(prepared.finalThumbnailPath, prepared.version);

  try {
    const [originalUploadData, thumbnailUploadData] = await Promise.all([
      uploadFinalStudentPhotoAsset({
        blob: compressedFile,
        path: prepared.finalOriginalPath,
      }),
      uploadFinalStudentPhotoAsset({
        blob: thumbnailBlob,
        path: prepared.finalThumbnailPath,
      }),
    ]);

    logStudentPhotoEvent("info", "client-final-storage-upload-response", {
      bucket: STUDENT_PHOTOS_BUCKET,
      finalOriginalPath: prepared.finalOriginalPath,
      finalThumbnailPath: prepared.finalThumbnailPath,
      libraryId: prepared.libraryId ?? libraryId ?? null,
      originalUploadData,
      studentId,
      thumbnailUploadData,
      userId: userId ?? null,
      version: prepared.version,
    });

    const { data: updateData, error: updateError } = await supabase.rpc("update_student_photo_url" as never, {
      p_student_id: studentId,
      p_photo_url: originalUrl,
      p_final_photo_storage_path: prepared.finalOriginalPath,
      p_final_photo_thumbnail_path: prepared.finalThumbnailPath,
      p_photo_version: prepared.version,
      p_expected_photo_storage_path: prepared.currentPhotoStoragePath ?? null,
      p_expected_photo_thumbnail_path: prepared.currentPhotoThumbnailPath ?? null,
      p_temp_original_path: tempOriginalPath,
    } as never);

    if (updateError) {
      await logStudentPhotoUploadFailure({
        error: updateError,
        extra: {
          finalOriginalPath: prepared.finalOriginalPath,
          finalThumbnailPath: prepared.finalThumbnailPath,
          originalUrl,
          thumbnailUrl,
          version: prepared.version,
        },
        libraryId: prepared.libraryId ?? libraryId ?? null,
        stage: "update-student-photo-url",
        storagePath: prepared.finalOriginalPath,
        studentId,
        userId,
      });
      throw updateError;
    }

    const finalized = (updateData ?? {}) as UpdateStudentPhotoUrlResponse;
    if (finalized.success === false) {
      const finalizeError = new Error(finalized.error || "Unable to finalize the student photo upload.");
      await logStudentPhotoUploadFailure({
        error: finalizeError,
        extra: {
          finalizedResponse: finalized,
          finalOriginalPath: prepared.finalOriginalPath,
          finalThumbnailPath: prepared.finalThumbnailPath,
          version: prepared.version,
        },
        libraryId: prepared.libraryId ?? libraryId ?? null,
        stage: "update-student-photo-url-response",
        storagePath: prepared.finalOriginalPath,
        studentId,
        userId,
      });
      throw finalizeError;
    }

    logStudentPhotoEvent("info", "update-student-photo-url-success", {
      bucket: STUDENT_PHOTOS_BUCKET,
      finalOriginalPath: prepared.finalOriginalPath,
      finalThumbnailPath: prepared.finalThumbnailPath,
      finalized,
      libraryId: prepared.libraryId ?? libraryId ?? null,
      studentId,
      userId: userId ?? null,
      version: prepared.version,
    });

    await cleanupTempStudentPhotoAssets([
      tempOriginalPath,
      finalized.previousPhotoStoragePath ?? null,
      finalized.previousPhotoThumbnailPath ?? null,
    ]).catch((cleanupError) => {
      logStudentPhotoEvent("warn", "cleanup-student-photo-assets-after-success-failed", {
        bucket: STUDENT_PHOTOS_BUCKET,
        error: serializeSupabaseError(cleanupError),
        finalOriginalPath: prepared.finalOriginalPath,
        finalThumbnailPath: prepared.finalThumbnailPath,
        libraryId: prepared.libraryId ?? libraryId ?? null,
        previousPhotoStoragePath: finalized.previousPhotoStoragePath ?? null,
        previousPhotoThumbnailPath: finalized.previousPhotoThumbnailPath ?? null,
        studentId,
        tempOriginalPath,
        userId: userId ?? null,
      });
    });

    return {
      originalUrl,
      photoStoragePath: prepared.finalOriginalPath,
      photoThumbnailPath: prepared.finalThumbnailPath,
      thumbnailUrl,
      version: prepared.version,
    };
  } catch (error) {
    await logStudentPhotoUploadFailure({
      error,
      extra: {
        finalOriginalPath: prepared.finalOriginalPath,
        finalThumbnailPath: prepared.finalThumbnailPath,
        originalUrl,
        thumbnailUrl,
        version: prepared.version,
      },
      libraryId: prepared.libraryId ?? libraryId ?? null,
      stage: "client-finalization",
      storagePath: prepared.finalOriginalPath ?? tempOriginalPath,
      studentId,
      userId,
    });

    await cleanupTempStudentPhotoAssets([
      prepared.finalOriginalPath,
      prepared.finalThumbnailPath,
      tempOriginalPath,
    ]).catch((cleanupError) => {
      logStudentPhotoEvent("warn", "cleanup-student-photo-assets-after-failure-failed", {
        bucket: STUDENT_PHOTOS_BUCKET,
        error: serializeSupabaseError(cleanupError),
        finalOriginalPath: prepared.finalOriginalPath,
        finalThumbnailPath: prepared.finalThumbnailPath,
        libraryId: prepared.libraryId ?? libraryId ?? null,
        studentId,
        tempOriginalPath,
        userId: userId ?? null,
      });
    });

    throw error;
  }
};

const parseUploadErrorMessage = (xhr: XMLHttpRequest) => {
  try {
    const payload = JSON.parse(xhr.responseText) as { error?: string; message?: string };
    if (payload?.error) return payload.error;
    if (payload?.message) return payload.message;
  } catch {
    // Ignore malformed JSON and fall back to the status text.
  }

  return xhr.statusText || "Unable to upload the selected photo.";
};

const uploadToSignedUrlWithProgress = ({
  file,
  onProgress,
  signedUrl,
}: {
  file: Blob;
  onProgress?: (progress: number) => void;
  signedUrl: string;
}) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("cache-control", `max-age=${STUDENT_PHOTO_CACHE_CONTROL}`);
    xhr.setRequestHeader("content-type", "image/jpeg");
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress?.(progress);
    };

    xhr.onerror = () => reject(new Error(parseUploadErrorMessage(xhr)));
    xhr.onabort = () => reject(new Error("Photo upload was cancelled."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }

      reject(new Error(parseUploadErrorMessage(xhr)));
    };

    xhr.send(file);
  });

export const getStudentPhotoValidationError = (file: File) => {
  const isSupportedType = supportedMimeTypes.has(file.type) || supportedFileNamePattern.test(file.name);

  if (!isSupportedType) {
    return "Only JPG and PNG images are allowed.";
  }

  if (file.size > STUDENT_PHOTO_MAX_BYTES) {
    return "Photo size must be smaller than 2MB.";
  }

  return null;
};

export const buildStudentPhotoTempPaths = ({
  uploadId,
  userId,
}: {
  uploadId: string;
  userId: string;
}) => ({
  tempOriginalPath: `temp/${userId}/${uploadId}.jpg`,
});

export const uploadStudentPhotoDraftAssets = async ({
  file,
  libraryId,
  onProgress,
  studentId,
  userId,
}: {
  file: File;
  libraryId?: string | null;
  onProgress?: (progress: number) => void;
  studentId?: string;
  userId: string;
}) => {
  const uploadId = crypto.randomUUID();
  const { tempOriginalPath } = buildStudentPhotoTempPaths({
    uploadId,
    userId,
  });

  logStudentPhotoEvent("info", "draft-upload-start", {
    bucket: STUDENT_PHOTOS_BUCKET,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    libraryId: libraryId ?? null,
    storagePath: tempOriginalPath,
    studentId: studentId ?? null,
    userId,
  });

  if (shouldBypassLocalStudentPhotoPipeline) {
    logStudentPhotoEvent("info", "draft-upload-local-bypass", {
      bucket: STUDENT_PHOTOS_BUCKET,
      libraryId: libraryId ?? null,
      storagePath: tempOriginalPath,
      studentId: studentId ?? null,
      userId,
    });
    onProgress?.(100);
    return {
      bypassedTempUpload: true,
      tempOriginalPath,
    };
  }

  const compressedFile = await compressPhoto({ file, maxSizeMB: 0.5, maxWidthOrHeight: 800 });
  const { data: signedUploadData, error: signedUploadError } = await supabase.storage
    .from(STUDENT_PHOTOS_BUCKET)
    .createSignedUploadUrl(tempOriginalPath);

  logStudentPhotoEvent(signedUploadError || !signedUploadData?.signedUrl ? "warn" : "info", "create-signed-upload-url-response", {
    bucket: STUDENT_PHOTOS_BUCKET,
    error: signedUploadError ? serializeSupabaseError(signedUploadError) : null,
    hasSignedUrl: Boolean(signedUploadData?.signedUrl),
    libraryId: libraryId ?? null,
    storagePath: tempOriginalPath,
    studentId: studentId ?? null,
    userId,
  });

  if (signedUploadError || !signedUploadData?.signedUrl) {
    const uploadPreparationError = signedUploadError ?? new Error("Signed upload URL was not returned by Supabase storage.");
    await logStudentPhotoUploadFailure({
      error: uploadPreparationError,
      extra: {
        hasSignedUrl: Boolean(signedUploadData?.signedUrl),
      },
      libraryId,
      stage: "create-signed-upload-url",
      storagePath: tempOriginalPath,
      studentId,
      userId,
    });

    if (isStudentPhotoPermissionError(signedUploadError)) {
      logStudentPhotoEvent("warn", "create-signed-upload-url-permission-blocked-bypassing", {
        bucket: STUDENT_PHOTOS_BUCKET,
        libraryId: libraryId ?? null,
        storagePath: tempOriginalPath,
        studentId: studentId ?? null,
        userId,
      });
      onProgress?.(100);
      return {
        bypassedTempUpload: true,
        tempOriginalPath,
      };
    }

    throw signedUploadError || new Error("Unable to prepare the photo upload.");
  }

  try {
    await uploadToSignedUrlWithProgress({
      file: compressedFile,
      onProgress,
      signedUrl: signedUploadData.signedUrl,
    });

    logStudentPhotoEvent("info", "draft-upload-signed-url-success", {
      bucket: STUDENT_PHOTOS_BUCKET,
      libraryId: libraryId ?? null,
      storagePath: tempOriginalPath,
      studentId: studentId ?? null,
      userId,
    });

    return {
      bypassedTempUpload: false,
      tempOriginalPath,
    };
  } catch (error) {
    await logStudentPhotoUploadFailure({
      error,
      libraryId,
      stage: "upload-draft-via-signed-url",
      storagePath: tempOriginalPath,
      studentId,
      userId,
    });

    await cleanupTempStudentPhotoAssets([tempOriginalPath]).catch((cleanupError) => {
      logStudentPhotoEvent("warn", "cleanup-temp-draft-upload-failed", {
        bucket: STUDENT_PHOTOS_BUCKET,
        error: serializeSupabaseError(cleanupError),
        libraryId: libraryId ?? null,
        storagePath: tempOriginalPath,
        studentId: studentId ?? null,
        userId,
      });
    });
    throw error;
  }
};

export const finalizeStudentPhotoUpload = async ({
  file,
  libraryId,
  preferClientFinalization,
  studentId,
  tempOriginalPath,
  userId,
}: {
  file?: File;
  libraryId?: string | null;
  preferClientFinalization?: boolean;
  studentId: string;
  tempOriginalPath: string;
  userId?: string | null;
}) => {
  if (file && (preferClientFinalization || shouldBypassLocalStudentPhotoPipeline)) {
    logStudentPhotoEvent("info", "finalization-using-client-path", {
      bucket: STUDENT_PHOTOS_BUCKET,
      libraryId: libraryId ?? null,
      reason: preferClientFinalization ? "signed-upload-permission-bypass" : "local-environment-bypass",
      storagePath: tempOriginalPath,
      studentId,
      userId: userId ?? null,
    });

    return finalizeStudentPhotoUploadFromClient({
      file,
      libraryId,
      studentId,
      tempOriginalPath,
      userId,
    });
  }

  try {
    logStudentPhotoEvent("info", "invoke-finalize-edge-function", {
      bucket: STUDENT_PHOTOS_BUCKET,
      libraryId: libraryId ?? null,
      storagePath: tempOriginalPath,
      studentId,
      userId: userId ?? null,
    });

    const { data, error } = await supabase.functions.invoke<FinalizeStudentPhotoUploadResponse>("finalize-student-photo-upload", {
      body: {
        studentId,
        tempOriginalPath,
      },
    });

    logStudentPhotoEvent(error || !data?.success ? "warn" : "info", "finalize-edge-function-response", {
      bucket: STUDENT_PHOTOS_BUCKET,
      error: error ? serializeSupabaseError(error) : null,
      libraryId: libraryId ?? null,
      response: data ?? null,
      storagePath: tempOriginalPath,
      studentId,
      userId: userId ?? null,
    });

    if (error) {
      throw error;
    }

    if (!data?.success || !data.photoStoragePath || !data.photoThumbnailPath || !data.thumbnailUrl) {
      throw new Error(data?.error || "Unable to finalize the student photo upload.");
    }

    return {
      originalUrl: data.originalUrl ?? data.photoUrl ?? data.thumbnailUrl,
      photoStoragePath: data.photoStoragePath,
      photoThumbnailPath: data.photoThumbnailPath,
      thumbnailUrl: data.thumbnailUrl,
      version: data.version ?? Date.now(),
    };
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(getFunctionErrorMessage(error));

    if (!file || !shouldUseClientFinalizationFallback(normalizedError)) {
      await logStudentPhotoUploadFailure({
        error: normalizedError,
        libraryId,
        stage: "invoke-finalize-edge-function",
        storagePath: tempOriginalPath,
        studentId,
        userId,
      });
      throw normalizedError;
    }

    logStudentPhotoEvent("warn", "finalize-edge-function-fallback-to-client", {
      bucket: STUDENT_PHOTOS_BUCKET,
      error: serializeSupabaseError(normalizedError),
      libraryId: libraryId ?? null,
      storagePath: tempOriginalPath,
      studentId,
      userId: userId ?? null,
    });

    return finalizeStudentPhotoUploadFromClient({
      file,
      libraryId,
      studentId,
      tempOriginalPath,
      userId,
    });
  }
};
