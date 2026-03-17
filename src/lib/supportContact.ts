const DEFAULT_SUPPORT_WHATSAPP = "919709783056";

export const getSupportWhatsAppNumber = () =>
  ((import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined) || DEFAULT_SUPPORT_WHATSAPP).replace(/\D/g, "");

export const getSupportWhatsAppUrl = (message?: string) => {
  const base = `https://wa.me/${getSupportWhatsAppNumber()}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
};
