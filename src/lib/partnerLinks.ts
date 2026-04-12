export const getPublicAppBaseUrl = () => {
  const envUrl = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");

  return "https://libriofy.com";
};

export const getReferralLink = (code: string) => {
  if (!code) return "";
  return `${getPublicAppBaseUrl()}/ref/${encodeURIComponent(code)}`;
};
