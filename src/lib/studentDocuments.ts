export const STUDENT_DOCUMENTS_BUCKET = "student-documents";
export const STUDENT_AADHAAR_FILE_SIZE_LIMIT = 5 * 1024 * 1024;

const STUDENT_AADHAAR_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const sanitizeStudentDocumentFileName = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();

export const buildAadhaarDocumentPath = ({
  fileName,
  libraryId,
}: {
  fileName: string;
  libraryId: string;
}) => `${libraryId}/aadhaar/${Date.now()}-${sanitizeStudentDocumentFileName(fileName)}`;

export const getStudentAadhaarValidationError = (file: File) => {
  const normalizedType = file.type.toLowerCase();
  const normalizedName = file.name.toLowerCase();
  const hasAllowedType =
    STUDENT_AADHAAR_ALLOWED_TYPES.has(normalizedType) || /\.(jpe?g|png|webp)$/i.test(normalizedName);

  if (!hasAllowedType) {
    return "Please upload a JPG, PNG, or WEBP image for the Aadhaar card.";
  }

  if (file.size > STUDENT_AADHAAR_FILE_SIZE_LIMIT) {
    return "Aadhaar image must be 5 MB or smaller.";
  }

  return null;
};
