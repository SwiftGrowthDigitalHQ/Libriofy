import { extractClientIp, extractUserAgent, normalizeParsedRequestBody } from "../../src/lib/httpRequest.server";

type ApiRequest = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
};

type ApiResponse = {
  end: (body?: string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

type ResolverResult = {
  body: unknown;
  cookies?: string[];
  statusCode: number;
};

type Resolver = (
  body: Record<string, unknown>,
  context: {
    authorization?: string;
    cookieHeader?: string;
    deviceFingerprint?: string;
    deviceLabel?: string;
    ip?: string;
    userAgent?: string;
  },
) => Promise<ResolverResult>;

const sendJson = (res: ApiResponse, statusCode: number, body: unknown, cookies?: string[]) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  if (cookies?.length) {
    res.setHeader("Set-Cookie", cookies);
  }
  res.end(JSON.stringify(body));
};

export const handleAuthApiRequest = async (
  req: ApiRequest,
  res: ApiResponse,
  resolver: Resolver,
  allowedMethod = "POST",
) => {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if ((req.method || "").toUpperCase() !== allowedMethod) {
    sendJson(res, 405, { success: false, message: "Method not allowed" });
    return;
  }

  try {
    const headers = req.headers ?? {};
    const result = await resolver(
      normalizeParsedRequestBody(req.body, Array.isArray(headers["content-type"]) ? headers["content-type"][0] : headers["content-type"]),
      {
        authorization: Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization,
        cookieHeader: Array.isArray(headers.cookie) ? headers.cookie[0] : headers.cookie,
        deviceFingerprint: Array.isArray(headers["x-device-fingerprint"])
          ? headers["x-device-fingerprint"][0]
          : headers["x-device-fingerprint"],
        deviceLabel: Array.isArray(headers["x-device-label"]) ? headers["x-device-label"][0] : headers["x-device-label"],
        ip: extractClientIp(headers),
        userAgent: extractUserAgent(headers),
      },
    );

    sendJson(res, result.statusCode, result.body, result.cookies);
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Unexpected auth failure",
    });
  }
};
