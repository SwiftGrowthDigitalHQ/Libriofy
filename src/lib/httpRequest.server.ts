type RequestWithBodyStream = {
  on: (event: "data" | "end" | "error", listener: (...args: unknown[]) => void) => void;
};

export const readRequestBody = async (req: RequestWithBodyStream) => {
  const chunks: string[] = [];

  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: unknown) => {
      if (typeof chunk === "string") {
        chunks.push(chunk);
        return;
      }

      if (chunk instanceof Uint8Array) {
        chunks.push(new TextDecoder().decode(chunk));
      }
    });

    req.on("end", () => resolve());
    req.on("error", (error: unknown) => reject(error));
  });

  return chunks.join("");
};

export const parseRequestBody = (rawBody: string, contentType?: string) => {
  const normalizedContentType = String(contentType || "").toLowerCase();
  if (!rawBody.trim()) {
    return {};
  }

  if (normalizedContentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }

  return JSON.parse(rawBody) as Record<string, unknown>;
};

export const normalizeParsedRequestBody = (body: unknown, contentType?: string) => {
  if (typeof body === "string") {
    return parseRequestBody(body, contentType);
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }

  return {};
};

export const extractClientIp = (headers: Record<string, string | string[] | undefined>) => {
  const forwardedFor = headers["x-forwarded-for"];
  const directValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return String(directValue || "").split(",")[0]?.trim() || "";
};

export const extractUserAgent = (headers: Record<string, string | string[] | undefined>) => {
  const userAgent = headers["user-agent"];
  return Array.isArray(userAgent) ? userAgent[0] || "" : userAgent || "";
};
