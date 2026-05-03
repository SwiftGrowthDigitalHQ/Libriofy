import { getPublicAppBaseUrl } from "@/lib/publicAppUrl";

export { getPublicAppBaseUrl };

export const getReferralLink = (code: string) => {
  if (!code) return "";
  return `${getPublicAppBaseUrl()}/ref/${encodeURIComponent(code)}`;
};
