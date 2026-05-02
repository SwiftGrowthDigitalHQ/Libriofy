export const SUPABASE_OBSERVABILITY_SKIP_HEADER = "x-libriofy-observability";
export const SUPABASE_OBSERVABILITY_SKIP_VALUE = "skip";

export type SupabaseRequestDetails = {
  method: string;
  path: string;
  queryName: string | null;
  queryType: "other" | "rest" | "rpc";
  skipLogging: boolean;
  url: string;
};

type ParsedSupabaseError = {
  code: string | null;
  message: string | null;
  raw: string;
};

const readRequestUrl = (input: RequestInfo | URL) => {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
};

const readRequestMethod = (input: RequestInfo | URL, init?: RequestInit) => {
  if (init?.method) {
    return init.method.toUpperCase();
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }

  return "GET";
};

const buildRequestHeaders = (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers ?? undefined);

  if (typeof Request !== "undefined" && input instanceof Request) {
    input.headers.forEach((value, key) => {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    });
  }

  return headers;
};

const normalizePathname = (pathname: string) => pathname.replace(/\/+$/, "");

export const getSupabaseRequestDetails = (input: RequestInfo | URL, init?: RequestInit): SupabaseRequestDetails => {
  const rawUrl = readRequestUrl(input);
  const headers = buildRequestHeaders(input, init);

  try {
    const parsedUrl = new URL(rawUrl, "http://localhost");
    const pathname = normalizePathname(parsedUrl.pathname);
    const skipHeader = headers.get(SUPABASE_OBSERVABILITY_SKIP_HEADER);

    if (pathname.includes("/rest/v1/rpc/")) {
      const queryName = decodeURIComponent(pathname.split("/rest/v1/rpc/")[1] ?? "").trim() || null;
      return {
        method: readRequestMethod(input, init),
        path: pathname,
        queryName,
        queryType: "rpc",
        skipLogging: skipHeader === SUPABASE_OBSERVABILITY_SKIP_VALUE || queryName === "app_error_logs",
        url: parsedUrl.toString(),
      };
    }

    if (pathname.includes("/rest/v1/")) {
      const queryName = decodeURIComponent(pathname.split("/rest/v1/")[1] ?? "")
        .split("/")[0]
        ?.trim() || null;

      return {
        method: readRequestMethod(input, init),
        path: pathname,
        queryName,
        queryType: "rest",
        skipLogging: skipHeader === SUPABASE_OBSERVABILITY_SKIP_VALUE || queryName === "app_error_logs",
        url: parsedUrl.toString(),
      };
    }

    return {
      method: readRequestMethod(input, init),
      path: pathname,
      queryName: null,
      queryType: "other",
      skipLogging: true,
      url: parsedUrl.toString(),
    };
  } catch {
    return {
      method: readRequestMethod(input, init),
      path: rawUrl,
      queryName: null,
      queryType: "other",
      skipLogging: true,
      url: rawUrl,
    };
  }
};

export const parseSupabaseErrorResponse = async (response: Response): Promise<ParsedSupabaseError> => {
  const raw = (await response.clone().text()).slice(0, 800);

  try {
    const parsed = JSON.parse(raw) as { code?: unknown; message?: unknown };
    return {
      code: typeof parsed.code === "string" ? parsed.code : null,
      message: typeof parsed.message === "string" ? parsed.message : null,
      raw,
    };
  } catch {
    return {
      code: null,
      message: raw || null,
      raw,
    };
  }
};
