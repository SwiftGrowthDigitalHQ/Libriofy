import { resolveLogoutAllRequest } from "../../src/lib/otpAuth.server";
import { handleAuthApiRequest } from "./_shared";

export default async function handler(
  req: { body?: unknown; headers?: Record<string, string | string[] | undefined>; method?: string },
  res: { end: (body?: string) => void; setHeader: (name: string, value: string | string[]) => void; statusCode: number },
) {
  await handleAuthApiRequest(req, res, (body, context) => resolveLogoutAllRequest(process.env, body, context));
}
