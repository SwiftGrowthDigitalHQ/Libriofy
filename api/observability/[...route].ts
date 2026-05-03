import { handleObservabilityRoute } from "../../src/lib/observability/observabilityApi.server.js";

export default async function handler(req: {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
}, res: {
  end: (body?: string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
}) {
  await handleObservabilityRoute(req, res);
}
