import { handleAuthApiRequest, type ApiRequest, type ApiResponse } from "../../src/lib/authApiRoute.server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  await handleAuthApiRequest(req, res, process.env);
}
