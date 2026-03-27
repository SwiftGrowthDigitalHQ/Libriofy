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

  await supabase.storage.from(STUDENT_PHOTOS_BUCKET).remove(validPaths);
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
  const { error } = await supabase.storage.from(STUDENT_PHOTOS_BUCKET).upload(path, blob, {
    cacheControl: STUDENT_PHOTO_CACHE_CONTROL,
    contentType: "image/jpeg",
    upsert: false,
  });

  if (error) {
    throw error;
  }
};

const finalizeStudentPhotoUploadFromClient = async ({
  file,
  studentId,
  tempOriginalPath,
}: {
  file: File;
  studentId: string;
  tempOriginalPath: string;
}) => {
  const compressedFile = await compressPhoto({ file, maxSizeMB: 0.5, maxWidthOrHeight: 800 });
  const thumbnailBlob = await createSquareThumbnailBlob(compressedFile);
  const { data: prepareData, error: prepareError } = await supabase.rpc("prepare_student_photo_upload" as never, {
    p_student_id: studentId,
    p_temp_original_path: tempOriginalPath,
  } as never);

  if (prepareError) {
    throw prepareError;
  }

  const prepared = (prepareData ?? {}) as PrepareStudentPhotoUploadResponse;

  if (prepared.success === false || !prepared.finalOriginalPath || !prepared.finalThumbnailPath || !prepared.version) {
    throw new Error(prepared.error || "Unable to prepare the student photo upload.");
  }

  const originalUrl = getStudentPhotoPublicUrl(prepared.finalOriginalPath, prepared.version);
  const thumbnailUrl = getStudentPhotoPublicUrl(prepared.finalThumbnailPath, prepared.version);

  try {
    await Promise.all([
      uploadFinalStudentPhotoAsset({
        blob: compressedFile,
        path: prepared.finalOriginalPath,
      }),
      uploadFinalStudentPhotoAsset({
        blob: thumbnailBlob,
        path: prepared.finalThumbnailPath,
      }),
    ]);

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
      throw updateError;
    }

    const finalized = (updateData ?? {}) as UpdateStudentPhotoUrlResponse;
    if (finalized.success === false) {
      throw new Error(finalized.error || "Unable to finalize the student photo upload.");
    }

    await cleanupTempStudentPhotoAssets([
      tempOriginalPath,
      finalized.previousPhotoStoragePath ?? null,
      finalized.previousPhotoThumbnailPath ?? null,
    ]).catch(() => undefined);

    return {
      originalUrl,
      photoStoragePath: prepared.finalOriginalPath,
      photoThumbnailPath: prepared.finalThumbnailPath,
      thumbnailUrl,
      version: prepared.version,
    };
  } catch (error) {
    await cleanupTempStudentPhotoAssets([
      prepared.finalOriginalPath,
      prepared.finalThumbnailPath,
      tempOriginalPath,
    ]).catch(() => undefined);

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
  onProgress,
  userId,
}: {
  file: File;
  onProgress?: (progress: number) => void;
  userId: string;
}) => {
  const uploadId = crypto.randomUUID();
  const { tempOriginalPath } = buildStudentPhotoTempPaths({
    uploadId,
    userId,
  });

  if (shouldBypassLocalStudentPhotoPipeline) {
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

  if (signedUploadError || !signedUploadData?.signedUrl) {
    if (isStudentPhotoPermissionError(signedUploadError)) {
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

    return {
      bypassedTempUpload: false,
      tempOriginalPath,
    };
  } catch (error) {
    await cleanupTempStudentPhotoAssets([tempOriginalPath]).catch(() => undefined);
    throw error;
  }
};

export const finalizeStudentPhotoUpload = async ({
  file,
  preferClientFinalization,
  studentId,
  tempOriginalPath,
}: {
  file?: File;
  preferClientFinalization?: boolean;
  studentId: string;
  tempOriginalPath: string;
}) => {
  if (file && (preferClientFinalization || shouldBypassLocalStudentPhotoPipeline)) {
    return finalizeStudentPhotoUploadFromClient({
      file,
      studentId,
      tempOriginalPath,
    });
  }

  try {
    const { data, error } = await supabase.functions.invoke<FinalizeStudentPhotoUploadResponse>("finalize-student-photo-upload", {
      body: {
        studentId,
        tempOriginalPath,
      },
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
      throw normalizedError;
    }

    return finalizeStudentPhotoUploadFromClient({
      file,
      studentId,
      tempOriginalPath,
    });
  }
};
